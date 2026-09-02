"""
Клиент ForgetAPI (https://forgetapi.ru).

В отличие от ProxyAPI, ForgetAPI — ОДИН унифицированный OpenAI-совместимый эндпоинт
на все текстовые модели сразу (Claude, GPT, Gemini и т.д.):

    POST https://api.forgetapi.ru/v1/chat/completions
    Authorization: Bearer <ключ>
    Content-Type: application/json
    {"model": "claude-opus-5", "messages": [...]}

Генерация изображений (nano-banana и т.п.) идёт через отдельный, тоже
OpenAI-совместимый эндпоинт images/generations (как DALL-E у OpenAI):

    POST https://api.forgetapi.ru/v1/images/generations
    {"model": "nano-banana", "prompt": "...", "n": 1, "response_format": "b64_json"}

Секретный ключ ForgetAPI один на всё — вводится один раз в .env (FORGETAPI_KEY) или
через Админ-панель → Настройки ForgetAPI.

Если генерация картинок вернёт 400/404 — смотри в логи бота: generate_image() логирует
полный текст ошибки ForgetAPI (log.error перед raise), там будет видно, что именно не
понравилось API (неверное поле, неподдерживаемая модель на этом эндпоинте и т.п.).
"""
import asyncio
import base64
import json
import logging

import httpx

from config import cfg
from database import db

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Системный промт, который отправляется первым сообщением (role: system) в
# каждый запрос /chat/completions. Задаёт общий стиль ответов модели.
# Не хранится в БД — правится прямо здесь.
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = (
    "Ты — универсальный ИИ-ассистент в Telegram-боте. Отвечай полезно, точно и по делу.\n\n"
    "Правила:\n"
    "- Отвечай на языке пользователя (по умолчанию — русский).\n"
    "- Если вопрос неоднозначный — сначала дай лучший возможный ответ, при необходимости уточни один момент.\n"
    "- Форматируй ответ для Telegram: используй *жирный*, _курсив_, `код`, списки — без сложной markdown-разметки "
    "(без таблиц, без заголовков #).\n"
    "- Код оформляй в блоках ```язык ... ```.\n"
    "- НИКОГДА не используй LaTeX (никаких \\[ \\], \\( \\), \\frac{}{}, \\cdot, \\boxed{}, ^{}, _{}, \\text{} "
    "и т.п.) — Telegram не умеет это рендерить, и пользователь увидит нечитаемую кашу из бэкслэшей и скобок "
    "вместо формулы. Все формулы и математику пиши обычным текстом с привычными символами: ×, ÷, °, ², ³, √, "
    "≤, ≥, ≈, π и т.д. (например: a^2 + b^2 = c^2, не \\(a^2+b^2=c^2\\); дробь пиши как (a+b)/c, не \\frac{a+b}{c}).\n"
    "- Если не знаешь ответ или не уверен — так и скажи, не выдумывай факты.\n"
    "- Будь краток, если пользователь не просил подробный разбор; давай развёрнутый ответ, если тема сложная "
    "или прямо просят детали.\n"
    "- Не упоминай, что ты работаешь через какой-либо промежуточный сервис или API — просто отвечай как ассистент."
)

# 502/503/504 — типичные "временные" ошибки шлюза/апстрима (сам провайдер модели
# ненадолго недоступен), а не ошибка в нашем запросе. Их имеет смысл ретраить —
# в отличие, например, от 400/401/404, где повтор ничего не изменит.
_RETRY_STATUS_CODES = {502, 503, 504}
_RETRY_ATTEMPTS = 3
_RETRY_BASE_DELAY = 1.5  # секунды; растёт линейно: 1.5с, 3с


async def _post_with_retry(client: httpx.AsyncClient, path: str, **kwargs) -> httpx.Response:
    """POST с ретраями на временные 502/503/504 и сетевые обрывы. Остальные ошибки
    (400/401/404 и т.п.) пробрасываются сразу — повтор их не исправит."""
    last_exc: Exception | None = None
    for attempt in range(1, _RETRY_ATTEMPTS + 1):
        try:
            resp = await client.post(path, **kwargs)
            resp.raise_for_status()
            return resp
        except httpx.HTTPStatusError as e:
            last_exc = e
            if e.response.status_code not in _RETRY_STATUS_CODES or attempt == _RETRY_ATTEMPTS:
                raise
        except httpx.TimeoutException as e:
            # Таймаут (обычно ReadTimeout) означает, что мы уже прождали полный
            # read-timeout (см. timeout= у AsyncClient) и модель за это время не
            # ответила — как правило, это долгая "думающая" генерация на сложный
            # запрос, а не разовый сетевой сбой. Повторять такой запрос с нуля
            # бессмысленно: он с высокой вероятностью снова упрётся в тот же
            # лимит, и пользователь будет ждать ещё N таймаутов подряд, прежде чем
            # получить ошибку. Поэтому таймаут не ретраим — пробрасываем сразу,
            # а решать проблему нужно увеличением read-timeout ниже.
            raise
        except httpx.TransportError as e:
            last_exc = e
            if attempt == _RETRY_ATTEMPTS:
                raise
        delay = _RETRY_BASE_DELAY * attempt
        log.warning(
            "ForgetAPI %s: попытка %s/%s неудачна (%s), повтор через %.1fс",
            path, attempt, _RETRY_ATTEMPTS, last_exc, delay,
        )
        await asyncio.sleep(delay)
    raise last_exc  # недостижимо практически, но для полноты типов


async def _get_key() -> str:
    key = await db.get_setting("forgetapi_key")
    return key or cfg.forgetapi_key


def _require_key(key: str):
    if not key:
        raise RuntimeError("FORGETAPI_KEY не задан. Укажите его в .env или в Админ-панели → Настройки ForgetAPI.")


# ---------------------------------------------------------------------------
# Вложения (фото/документы) в истории диалога — единый OpenAI-совместимый формат,
# подходит сразу для всех моделей (Claude/GPT/Gemini и др.), т.к. ForgetAPI сам
# приводит его к нужному вендору под капотом.
#
# В базе (см. db.get_dialog) каждое сообщение — это {"role", "content", "attachments"},
# где attachments — JSON-строка (или None) со списком словарей вида:
#   {"kind": "image" | "document" | "text_file",
#    "mime_type": "...", "filename": "...",
#    "data_b64": "..."}   # для image/document
#    "text": "..."}        # для text_file (уже извлечённый текст)
# ---------------------------------------------------------------------------

def _load_attachments(attachments) -> list[dict]:
    if not attachments:
        return []
    if isinstance(attachments, str):
        try:
            return json.loads(attachments)
        except Exception:
            log.exception("failed to parse attachments JSON")
            return []
    return attachments


def _openai_content(text: str, attachments) -> str | list[dict]:
    atts = _load_attachments(attachments)
    if not atts:
        return text or ""
    blocks = []
    if text:
        blocks.append({"type": "text", "text": text})
    for a in atts:
        kind = a.get("kind")
        if kind == "image":
            blocks.append({
                "type": "image_url",
                "image_url": {"url": f"data:{a.get('mime_type', 'image/jpeg')};base64,{a.get('data_b64', '')}"},
            })
        elif kind == "document":
            # Универсальный способ отдать ЛЮБОЙ файл (в т.ч. неизвестного/бинарного формата) —
            # часть моделей (например Claude/GPT с включённым file-инструментом) реально его
            # прочитают, часть — просто проигнорирует необработанные байты. Раз бот обязан
            # "принимать любые файлы", а не только заведомо поддерживаемые форматы, шлём как есть.
            blocks.append({
                "type": "file",
                "file": {
                    "filename": a.get("filename") or "file",
                    "file_data": f"data:{a.get('mime_type', 'application/octet-stream')};base64,{a.get('data_b64', '')}",
                },
            })
        elif kind == "text_file":
            blocks.append({"type": "text", "text": f"[Файл {a.get('filename', '')}]:\n{a.get('text', '')}"})
    return blocks


# ---------------------------------------------------------------------------
# Текстовый чат — один эндпоинт на все текстовые модели (Claude/GPT/Gemini и др.).
# ---------------------------------------------------------------------------

async def chat(model_info, history: list[dict]) -> tuple[str, int]:
    key = await _get_key()
    _require_key(key)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + [
        {"role": h["role"], "content": _openai_content(h.get("content") or "", h.get("attachments"))}
        for h in history
    ]
    # read=900 — до 15 минут ждём ответ модели (сложные/длинные задачи могут "думать"
    # значительно дольше стандартных 3 минут); connect=15 — а вот на установку самого
    # соединения даём мало времени, чтобы при реально недоступном апстриме не ждать
    # напрасно и уйти в retry по TransportError быстро.
    chat_timeout = httpx.Timeout(connect=15.0, read=900.0, write=30.0, pool=15.0)
    async with httpx.AsyncClient(base_url=cfg.forgetapi_base_url, timeout=chat_timeout) as client:
        try:
            resp = await _post_with_retry(
                client,
                "/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                # max_tokens указываем явно и с большим запасом: без этого поля ForgetAPI/модель
                # подставляет свой дефолт (похоже, около 4096), и на больших ответах (например,
                # "напиши мне бота с базой данных") модель успевает потратить весь лимit на
                # размышление/код и обрывается, не дойдя до финального текстового блока — в
                # логах при этом токены и деньги списываются, а пользователю прилетает пустой
                # ответ. С большим лимитом такого обрыва быть не должно.
                json={"model": model_info.api_model, "messages": messages, "max_tokens": 16000},
            )
        except httpx.HTTPStatusError as e:
            # Раньше здесь ничего не логировалось — при ошибке (например, модель/агрегатор не
            # поддерживает конкретный тип вложения) в логах была видна только generic exception
            # без единой зацепки, что именно не понравилось ForgetAPI. Печатаем тело ответа —
            # так же, как уже сделано в generate_image() ниже — чтобы реальную причину было
            # видно в логах бота.
            log.error(
                "ForgetAPI /chat/completions (model=%s) вернул %s: %s",
                model_info.api_model, e.response.status_code, e.response.text[:2000],
            )
            raise
        data = resp.json()

    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        log.error("ForgetAPI /chat/completions вернул неожиданный формат ответа: %r", data)
        raise RuntimeError(f"Неожиданный формат ответа ForgetAPI /chat/completions: {data!r}")
    text = message.get("content") or ""
    if isinstance(text, list):  # некоторые модели могут вернуть контент блоками, а не строкой
        text = "".join(b.get("text", "") for b in text if isinstance(b, dict) and b.get("type") == "text")
    usage = data.get("usage", {})
    total_tokens = usage.get("total_tokens") or (usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0))
    if not text.strip() and total_tokens:
        # Токены потрачены (и деньги списаны), а текста нет — значит модель либо упёрлась в
        # max_tokens, не дойдя до финального текстового блока, либо ForgetAPI вернул контент в
        # непривычном формате. Печатаем сырой ответ целиком, чтобы в следующий раз сразу было
        # видно, что реально пришло, а не гадать по логам "пустой ответ".
        log.error(
            "ForgetAPI /chat/completions (model=%s) списал %s токенов, но текст пуст. Сырой ответ: %r",
            model_info.api_model, total_tokens, data,
        )
    return text, total_tokens


# ---------------------------------------------------------------------------
# Генерация изображений (nano-banana, nano-banana-pro, nano-banana-2) — тот же
# унифицированный /v1/chat/completions эндпоинт, отличается только разбор ответа:
# картинка приходит как часть assistant-сообщения (image_url с data:base64 либо
# отдельным полем images[]) вместо обычного текста.
# ---------------------------------------------------------------------------

async def generate_image(
    model_info,
    prompt: str,
    ref_image: bytes | None = None,
    ref_mime: str = "image/jpeg",
) -> tuple[bytes, str]:
    """Генерация изображения. Без референса — обычный текст-в-картинку через стандартный
    OpenAI-style эндпоинт /v1/images/generations (так работает подавляющее большинство
    агрегаторов, включая ForgetAPI, судя по их позиционированию "полностью
    OpenAI-совместимый роутер").

    С референсом (ref_image, например пользователь прислал фото боту с nano-banana в
    качестве "описания") — идём в /v1/images/edits (multipart/form-data: image+prompt),
    как у OpenAI-совместимого image-edit эндпоинта — так nano-banana* умеет
    генерировать/редактировать "по образцу" присланной картинки, а не только по тексту.
    Если у ForgetAPI это поле/эндпоинт называется иначе — смотри лог ошибки ниже (там
    будет полный текст ответа) и поправь путь/имя поля под их формат."""
    key = await _get_key()
    _require_key(key)
    endpoint = "/images/edits" if ref_image is not None else "/images/generations"
    image_timeout = httpx.Timeout(connect=15.0, read=300.0, write=60.0, pool=15.0)
    async with httpx.AsyncClient(base_url=cfg.forgetapi_base_url, timeout=image_timeout) as client:
        try:
            if ref_image is not None:
                ext = "png" if "png" in ref_mime else "jpg"
                resp = await _post_with_retry(
                    client,
                    endpoint,
                    headers={"Authorization": f"Bearer {key}"},  # Content-Type проставит httpx сам (multipart)
                    data={"model": model_info.api_model, "prompt": prompt, "n": "1", "response_format": "b64_json"},
                    files={"image": (f"reference.{ext}", ref_image, ref_mime)},
                )
            else:
                resp = await _post_with_retry(
                    client,
                    endpoint,
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "model": model_info.api_model,
                        "prompt": prompt,
                        "n": 1,
                        "response_format": "b64_json",
                    },
                )
        except httpx.HTTPStatusError as e:
            # Печатаем реальный текст ошибки ForgetAPI в лог — иначе видно только "502 Bad
            # Gateway"/"400 Bad Request" без единой зацепки, почему именно. Если тут окажется
            # что-то вроде "unknown field n" или "model does not support this endpoint" —
            # правь запрос выше по тексту конкретной ошибки. 502/503/504 к этому моменту уже
            # были отретраены _post_with_retry() — если ошибка дошла досюда, значит апстрим
            # не восстановился за несколько попыток (или это не временная ошибка вовсе).
            log.error("ForgetAPI %s вернул %s: %s", endpoint, e.response.status_code, e.response.text[:2000])
            raise
        data = resp.json()

    items = data.get("data") or []
    if not items:
        raise RuntimeError("ForgetAPI не вернул ни одной картинки (пустой data[]).")
    item = items[0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"]), "image/png"
    if item.get("url"):
        # некоторые агрегаторы возвращают готовую ссылку на картинку вместо base64
        async with httpx.AsyncClient(timeout=60) as client:
            img_resp = await client.get(item["url"])
            img_resp.raise_for_status()
            mime = img_resp.headers.get("content-type", "image/png").split(";")[0]
            return img_resp.content, mime
    raise RuntimeError(f"Неожиданный формат ответа /images/generations от ForgetAPI: {item!r}")
