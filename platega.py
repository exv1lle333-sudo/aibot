"""
Интеграция с Platega (https://platega.io).

Сверено с официальной документацией (platega-io.gitbook.io/platega.io-api-dokumentaciya,
02.09.2026):
  - создание платежа: POST {base_url}/transaction/process
  - заголовки (и для создания платежа, и в самом webhook-колбэке): X-MerchantId, X-Secret
  - НИКАКОЙ отдельной HMAC-подписи (X-Signature) Platega не присылает — колбэк
    аутентифицируется теми же X-MerchantId/X-Secret, что и создание платежа (это видно и
    по официальному примеру callback'а). verify_webhook_signature() ниже оставлена только
    как задел на случай, если Platega когда-нибудь добавит подпись, и в webhook.py сейчас
    не используется.
  - тело запроса на создание платежа: поле называется "id" (UUID, его же генерируем сами
    и используем как tx_id в нашей БД — так же и колбэк потом присылает обратно именно
    этот id), и "return" (НЕ "returnUrl" — это была ошибка, из-за которой Platega могла
    просто игнорировать редирект). Поля "merchantTransactionId" в их API нет вообще —
    раньше оно отправлялось, но Platega его не читает, поэтому убрано.
  - статус после успешной оплаты в колбэке — "CONFIRMED" (не "PAID"), при неуспехе —
    "CANCELED"
  - проверка статуса (для сверки, если колбэк не дошёл): GET {base_url}/transaction/{id}
"""
import hashlib
import hmac
import logging
import os
import uuid

import httpx

from config import cfg

log = logging.getLogger(__name__)

HEADER_MERCHANT = os.getenv("PLATEGA_HEADER_MERCHANT", "X-MerchantId")
HEADER_SECRET = os.getenv("PLATEGA_HEADER_SECRET", "X-Secret")
SIGNATURE_HEADER = os.getenv("PLATEGA_SIGNATURE_HEADER", "X-Signature")


class PlategaError(Exception):
    """Ошибка при обращении к Platega. Сообщение уже содержит статус и тело ответа."""


async def create_payment(amount_rub: float, tx_id: str, description: str) -> str:
    """Создаёт платёжную ссылку в Platega и возвращает URL для оплаты.

    Бросает PlategaError с понятным текстом (статус-код + тело ответа Platega),
    если запрос не удался — это видно в логах бота (log.exception в вызывающем коде).
    """
    if not cfg.platega_merchant_id or not cfg.platega_secret:
        raise PlategaError(
            "PLATEGA_MERCHANT_ID или PLATEGA_SECRET не заданы в .env — "
            "заполни их значениями из личного кабинета Platega."
        )

    endpoint = "/v2/transaction/process" if cfg.platega_api_version == "v2" else "/transaction/process"
    payload = {
        "paymentMethod": cfg.platega_active_methods[0] if cfg.platega_active_methods else 2,
        # КЛЮЧЕВОЙ МОМЕНТ: сюда идёт именно tx_id из нашей БД (не случайный новый uuid4()),
        # потому что Platega вернёт этот же "id" и в ответе на создание, и в webhook-колбэке,
        # и в GET /transaction/{id}. Если бы здесь генерировался отдельный случайный id (как
        # было раньше), то по колбэку было бы невозможно найти транзакцию в базе — платёж
        # приходил бы, но баланс никогда не зачислялся.
        "id": tx_id,
        "paymentDetails": {
            "amount": round(amount_rub, 2),
            "currency": "RUB",
        },
        "description": description,
        # именно "return", а не "returnUrl" — так называется поле в API Platega
        "return": cfg.platega_return_url or None,
        "failedUrl": cfg.platega_failed_url or None,
    }
    headers = {
        HEADER_MERCHANT: cfg.platega_merchant_id,
        HEADER_SECRET: cfg.platega_secret,
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(base_url=cfg.platega_base_url, timeout=30) as client:
            resp = await client.post(endpoint, json=payload, headers=headers)
    except httpx.RequestError as e:
        # сеть недоступна / таймаут / неверный PLATEGA_BASE_URL
        log.error("Platega: сетевая ошибка при обращении к %s%s: %s", cfg.platega_base_url, endpoint, e)
        raise PlategaError(f"Не удалось подключиться к Platega ({cfg.platega_base_url}{endpoint}): {e}") from e

    if resp.status_code >= 400:
        # самое важное: показываем реальный ответ Platega, а не просто "400 Bad Request"
        body_preview = resp.text[:1000]
        log.error(
            "Platega ответила ошибкой %s на %s%s. Заголовки запроса: %s=%s, %s=***. Тело ответа: %s",
            resp.status_code, cfg.platega_base_url, endpoint,
            HEADER_MERCHANT, cfg.platega_merchant_id, HEADER_SECRET, body_preview,
        )
        raise PlategaError(f"Platega вернула {resp.status_code}: {body_preview}")

    data = resp.json()

    # у Platega ссылка на оплату приходит в поле "redirect" (проверено по реальному ответу
    # твоего аккаунта), но на всякий случай проверяем и другие варианты названия поля,
    # которые встречаются в разных версиях их API
    url = data.get("redirect") or data.get("redirectUrl") or data.get("paymentUrl") or data.get("url") or ""
    if not url:
        log.error("Platega вернула 200, но без ссылки на оплату. Тело ответа: %s", data)
        raise PlategaError(f"Platega не вернула ссылку на оплату. Ответ: {data}")

    return url


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    if not cfg.platega_secret:
        return False
    computed = hmac.new(cfg.platega_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, signature or "")


async def get_transaction_status(tx_id: str) -> dict | None:
    """GET /transaction/{id} — статус конкретного платежа в Platega.

    Используется фоновой сверкой (см. webhook.py: reconcile_pending_transactions) на
    случай, если сам webhook-колбэк не дошёл до нашего сервера — например, если домен
    ещё не до конца настроен (DNS/порт-форвардинг/HTTPS) или Platega не смогла достучаться
    с первых 3 попыток. Возвращает None, если Platega ответила ошибкой или транзакция не
    найдена — вызывающий код должен считать это временной проблемой, а не финалом.
    """
    if not cfg.platega_merchant_id or not cfg.platega_secret:
        return None
    headers = {
        HEADER_MERCHANT: cfg.platega_merchant_id,
        HEADER_SECRET: cfg.platega_secret,
    }
    try:
        async with httpx.AsyncClient(base_url=cfg.platega_base_url, timeout=15) as client:
            resp = await client.get(f"/transaction/{tx_id}", headers=headers)
    except httpx.RequestError as e:
        log.warning("Platega: не удалось проверить статус транзакции %s: %s", tx_id, e)
        return None
    if resp.status_code >= 400:
        log.warning("Platega: GET /transaction/%s вернул %s: %s", tx_id, resp.status_code, resp.text[:500])
        return None
    return resp.json()
