# -*- coding: utf-8 -*-
"""
Небольшой aiohttp-сервер, который принимает webhook от Platega о статусе оплаты
и зачисляет деньги на баланс пользователя.

Открой в кабинете Platega webhook на:  {PUBLIC_BASE_URL}{PLATEGA_WEBHOOK_PATH}
(например: https://hooks.example.com/platega-webhook)
"""
import hmac
import logging

from aiohttp import web
from aiogram import Bot

from database import db
import platega
import texts
import webapp
from config import cfg

log = logging.getLogger(__name__)


def create_app(bot: Bot) -> web.Application:
    app = web.Application()

    async def handle_platega(request: web.Request) -> web.Response:
        raw = await request.read()

        # ВАЖНО: реальные вебхуки от Platega (проверено по логам) НЕ содержат HMAC-подписи
        # в отдельном заголовке — вместо этого они повторно присылают те же X-MerchantId/
        # X-Secret, что и при создании платежа. Поэтому проверяем именно их, а не подпись.
        got_merchant = request.headers.get(platega.HEADER_MERCHANT, "")
        got_secret = request.headers.get(platega.HEADER_SECRET, "")
        auth_ok = (
            bool(cfg.platega_merchant_id)
            and bool(cfg.platega_secret)
            and hmac.compare_digest(got_merchant, cfg.platega_merchant_id)
            and hmac.compare_digest(got_secret, cfg.platega_secret)
        )

        if not auth_ok:
            log.warning(
                "Platega webhook: неверные учётные данные. "
                "Получено %s='%s', %s='***%s' (последние 4 симв.). Ожидался merchant_id='%s'. "
                "Все заголовки запроса: %s. Тело запроса (raw): %s.",
                platega.HEADER_MERCHANT, got_merchant,
                platega.HEADER_SECRET, got_secret[-4:] if got_secret else "",
                cfg.platega_merchant_id,
                dict(request.headers),
                raw.decode(errors="replace")[:2000],
            )
            return web.json_response({"ok": False, "error": "unauthorized"}, status=403)

        data = await request.json()
        status = str(data.get("status", "")).upper()
        tx_id = data.get("merchantTransactionId") or data.get("id")

        if status not in ("PAID", "CONFIRMED", "SUCCESS"):
            return web.json_response({"ok": True})  # игнорируем промежуточные статусы

        tx = await db.get_transaction(tx_id) if tx_id else None
        if not tx:
            log.warning("Platega webhook: unknown transaction %s", tx_id)
            return web.json_response({"ok": False, "error": "unknown transaction"}, status=404)

        updated = await db.mark_transaction_paid(tx_id)
        if updated and updated["status"] == "paid":
            # идемпотентно: если это первый раз, когда мы помечаем оплаченным — начисляем баланс
            already_credited = await db.get_setting(f"tx_credited:{tx_id}")
            if not already_credited:
                await db.add_balance(tx["user_id"], tx["amount_rub"])
                await db.set_setting(f"tx_credited:{tx_id}", "1")
                try:
                    await bot.send_message(
                        tx["user_id"], texts.PAYMENT_SUCCESS_DM.format(amount=tx["amount_rub"])
                    )
                except Exception:
                    log.exception("failed to notify user about payment")

        return web.json_response({"ok": True})

    app.router.add_post(cfg.webhook_path, handle_platega)

    async def health(request: web.Request) -> web.Response:
        return web.json_response({"status": "ok"})

    app.router.add_get("/health", health)

    # Mini App (веб-версия меню бота: профиль/баланс/покупки/промокоды/тикеты) — тот же
    # сервер и порт, что и вебхук Platega, просто другие пути (/app/*, /api/*).
    webapp.setup_routes(app, bot)

    return app


async def run_webhook_server(bot: Bot):
    app = create_app(bot)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, cfg.webhook_host, cfg.webhook_port)
    await site.start()
    log.info("Webhook server started on %s:%s%s", cfg.webhook_host, cfg.webhook_port, cfg.webhook_path)
