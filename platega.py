"""
Интеграция с Platega (https://platega.io).

ВАЖНО: перед продакшеном сверь названия заголовков авторизации и точный формат
подписи webhook с личным кабинетом Platega — их точная менеджер-документация
(wiki.platega.io) закрыта для автоматического доступа, поэтому здесь используется
конфигурация по общедокументированной схеме:
  - создание платежа: POST {base_url}/transaction/process (или /v2/transaction/process)
  - заголовки: X-MerchantId, X-Secret
  - webhook: подпись HMAC-SHA256 в заголовке X-Signature, сверяется по PLATEGA_SECRET

Если твой менеджер Platega выдаст другие названия заголовков — поменяй их
в PLATEGA_HEADER_MERCHANT / PLATEGA_HEADER_SECRET ниже или сразу в .env.
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
        "id": str(uuid.uuid4()),
        "paymentDetails": {
            "amount": round(amount_rub, 2),
            "currency": "RUB",
        },
        "description": description,
        "merchantTransactionId": tx_id,
        "returnUrl": cfg.platega_return_url or None,
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

    # у Platega ссылка на оплату обычно приходит в поле "redirectUrl" / "paymentUrl" / "url"
    url = data.get("redirectUrl") or data.get("paymentUrl") or data.get("url") or ""
    if not url:
        log.error("Platega вернула 200, но без ссылки на оплату. Тело ответа: %s", data)
        raise PlategaError(f"Platega не вернула ссылку на оплату. Ответ: {data}")

    return url


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    if not cfg.platega_secret:
        return False
    computed = hmac.new(cfg.platega_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, signature or "")
