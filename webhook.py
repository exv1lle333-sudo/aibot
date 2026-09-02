# -*- coding: utf-8 -*-
"""
Небольшой aiohttp-сервер, который принимает webhook от Platega о статусе оплаты
и зачисляет деньги на баланс пользователя.

Открой в кабинете Platega webhook на:  {PUBLIC_BASE_URL}{PLATEGA_WEBHOOK_PATH}
(например: https://hooks.example.com/platega-webhook)
"""
import asyncio
import hmac
import logging

from aiohttp import web
from aiogram import Bot

from database import db
import platega
import texts
from config import cfg

log = logging.getLogger(__name__)

# Статусы из документации Platega: CONFIRMED = оплачено, CANCELED = отменено/неуспешно.
# PAID/SUCCESS оставлены на случай, если для какого-то метода оплаты придёт другое название.
PAID_STATUSES = ("CONFIRMED", "PAID", "SUCCESS")
FAILED_STATUSES = ("CANCELED", "CANCELLED", "EXPIRED", "FAILED")

# Сколько времени после создания транзакции ждём оплату, прежде чем сверка (reconciliation)
# перестанет её опрашивать. Совпадает с "expiresIn" по умолчанию у Platega (15 минут) плюс запас.
RECONCILE_MAX_AGE_SECONDS = 60 * 60  # 1 час
RECONCILE_INTERVAL_SECONDS = 90


async def _credit_paid_transaction(bot: Bot, tx_id: str) -> None:
    """Помечает транзакцию оплаченной и идемпотентно начисляет баланс.
    Общая логика для самого webhook'а и для фоновой сверки (reconcile), чтобы оба пути
    гарантированно вели себя одинаково и не могли начислить деньги дважды."""
    tx = await db.get_transaction(tx_id)
    if not tx:
        log.warning("Platega: неизвестная транзакция %s (нет в нашей БД)", tx_id)
        return

    updated = await db.mark_transaction_paid(tx_id)
    if not updated or updated["status"] != "paid":
        return

    already_credited = await db.get_setting(f"tx_credited:{tx_id}")
    if already_credited:
        return

    await db.add_balance(tx["user_id"], tx["amount_rub"])
    await db.set_setting(f"tx_credited:{tx_id}", "1")
    try:
        await bot.send_message(tx["user_id"], texts.PAYMENT_SUCCESS_DM.format(amount=tx["amount_rub"]))
    except Exception:
        log.exception("failed to notify user about payment")


async def reconcile_pending_transactions(bot: Bot) -> None:
    """Фоновая задача: раз в RECONCILE_INTERVAL_SECONDS проверяет статус ещё не оплаченных
    транзакций напрямую через GET /transaction/{id} в Platega.

    Зачем это нужно: наш webhook работает только если Platega вообще смогла достучаться
    до PUBLIC_BASE_URL — а на собственном сервере (свой домен вроде DuckDNS, проброс портов,
    самоподписанный/не до конца настроенный HTTPS) колбэк иногда не доходит с первого раза,
    хотя сама оплата прошла успешно. Эта задача — подстраховка: даже если webhook так и не
    придёт, деньги всё равно зачислятся сами, максимум с задержкой в RECONCILE_INTERVAL_SECONDS.
    Полностью безопасна: использует тот же идемпотентный _credit_paid_transaction, что и сам
    webhook, так что задвоить зачисление не может.
    """
    while True:
        await asyncio.sleep(RECONCILE_INTERVAL_SECONDS)
        try:
            pending = await db.pending_transactions(RECONCILE_MAX_AGE_SECONDS)
            for tx in pending:
                info = await platega.get_transaction_status(tx["id"])
                if not info:
                    continue
                status = str(info.get("status", "")).upper()
                if status in PAID_STATUSES:
                    await _credit_paid_transaction(bot, tx["id"])
                elif status in FAILED_STATUSES:
                    await db.mark_transaction_failed(tx["id"])
        except Exception:
            log.exception("reconcile_pending_transactions: ошибка при сверке платежей")


def create_app(bot: Bot) -> web.Application:
    app = web.Application()

    async def handle_platega(request: web.Request) -> web.Response:
        raw = await request.read()

        # Согласно документации Platega, колбэк аутентифицируется теми же заголовками
        # X-MerchantId/X-Secret, что и создание платежа — отдельной HMAC-подписи Platega
        # не присылает (см. platega.py).
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
        # "id" — то самое поле, которое мы сами передали при создании платежа (см. platega.py:
        # create_payment) и которое совпадает с tx_id в нашей БД. merchantTransactionId
        # оставлен как фоллбэк на случай не задокументированных вариантов ответа Platega.
        tx_id = data.get("id") or data.get("merchantTransactionId")

        if status in FAILED_STATUSES:
            if tx_id:
                await db.mark_transaction_failed(tx_id)
            return web.json_response({"ok": True})

        if status not in PAID_STATUSES:
            return web.json_response({"ok": True})  # игнорируем промежуточные статусы (PENDING и т.п.)

        if not tx_id:
            log.warning("Platega webhook: в теле запроса нет id транзакции: %s", data)
            return web.json_response({"ok": False, "error": "missing transaction id"}, status=400)

        tx = await db.get_transaction(tx_id)
        if not tx:
            log.warning("Platega webhook: unknown transaction %s", tx_id)
            return web.json_response({"ok": False, "error": "unknown transaction"}, status=404)

        await _credit_paid_transaction(bot, tx_id)
        return web.json_response({"ok": True})

    app.router.add_post(cfg.webhook_path, handle_platega)

    async def health(request: web.Request) -> web.Response:
        return web.json_response({"status": "ok"})

    app.router.add_get("/health", health)

    return app


async def run_webhook_server(bot: Bot):
    app = create_app(bot)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, cfg.webhook_host, cfg.webhook_port)
    await site.start()
    log.info("Webhook server started on %s:%s%s", cfg.webhook_host, cfg.webhook_port, cfg.webhook_path)

    # Фоновая сверка платежей — подстраховка на случай, если сам webhook не дойдёт
    # (см. docstring reconcile_pending_transactions выше). Падение этой задачи не должно
    # ронять бота, поэтому она просто асинхронная задача на фоне, а не обязательный шаг запуска.
    asyncio.create_task(reconcile_pending_transactions(bot))
