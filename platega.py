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
import os
import uuid

import httpx

from config import cfg

HEADER_MERCHANT = os.getenv("PLATEGA_HEADER_MERCHANT", "X-MerchantId")
HEADER_SECRET = os.getenv("PLATEGA_HEADER_SECRET", "X-Secret")
SIGNATURE_HEADER = os.getenv("PLATEGA_SIGNATURE_HEADER", "X-Signature")


async def create_payment(amount_rub: float, tx_id: str, description: str) -> str:
    """Создаёт платёжную ссылку в Platega и возвращает URL для оплаты."""
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
    async with httpx.AsyncClient(base_url=cfg.platega_base_url, timeout=30) as client:
        resp = await client.post(endpoint, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    # у Platega ссылка на оплату обычно приходит в поле "redirectUrl" / "paymentUrl" / "url"
    return data.get("redirectUrl") or data.get("paymentUrl") or data.get("url") or ""


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    if not cfg.platega_secret:
        return False
    computed = hmac.new(cfg.platega_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, signature or "")
