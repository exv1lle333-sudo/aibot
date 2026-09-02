# -*- coding: utf-8 -*-
"""
Backend для Telegram Mini App — веб-версии главного меню бота.

Раздаётся тем же aiohttp-сервером, что и вебхук Platega (см. webhook.py), на портах/пути:
  GET  /app/                  -> статика мини-аппа (index.html/app.js/style.css)
  GET  /api/models            -> список моделей + пакеты (без авторизации, публичные цены)
  POST /api/profile           -> профиль + кошельки токенов
  POST /api/balance/topup     -> создать платёж в Platega, вернуть ссылку на оплату
  POST /api/balance/history   -> история платежей
  POST /api/buy               -> купить пакет токенов для модели
  POST /api/promo             -> активировать промокод
  POST /api/referral          -> реферальная ссылка + счётчик
  GET  /api/support           -> ссылки на документы
  POST /api/tickets           -> список тикетов пользователя
  POST /api/ticket/new        -> создать тикет
  POST /api/ticket/view       -> сообщения тикета
  POST /api/ticket/reply      -> ответить в тикете

Авторизация: каждый POST-запрос обязан прислать поле "initData" — это
Telegram.WebApp.initData, готовая подписанная строка, которую отдаёт сам Telegram
внутри мини-аппа. Мы проверяем её подпись (HMAC-SHA256 по алгоритму из документации
Telegram) секретным ключом, производным от BOT_TOKEN, — так что дополнительный
логин/пароль не нужен: если initData не подделана и не протухла, значит запрос
действительно пришёл из мини-аппа этого пользователя.
"""
import hashlib
import hmac
import json
import logging
import time
import urllib.parse
from pathlib import Path

from aiohttp import web
from aiogram import Bot

from database import db
import pricing
import platega
from config import cfg

log = logging.getLogger(__name__)

INIT_DATA_MAX_AGE_SECONDS = 24 * 3600  # initData Telegram обновляет при каждом открытии мини-аппа


def _validate_init_data(init_data: str, bot_token: str) -> dict | None:
    """Проверяет подпись initData по алгоритму Telegram WebApp и возвращает распарсенные
    поля (включая user) при успехе, либо None если подпись неверна/данные протухли."""
    if not init_data:
        return None
    try:
        pairs = urllib.parse.parse_qsl(init_data, strict_parsing=True, keep_blank_values=True)
    except ValueError:
        return None
    data = dict(pairs)
    received_hash = data.pop("hash", None)
    if not received_hash:
        return None

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed_hash, received_hash):
        return None

    auth_date = data.get("auth_date")
    if auth_date:
        try:
            if time.time() - int(auth_date) > INIT_DATA_MAX_AGE_SECONDS:
                return None
        except ValueError:
            pass

    user = None
    if "user" in data:
        try:
            user = json.loads(data["user"])
        except (ValueError, TypeError):
            user = None
    data["user"] = user
    return data


async def _auth_request(request: web.Request) -> tuple[dict | None, dict | None]:
    """Достаёт initData из тела JSON-запроса, проверяет подпись, возвращает (user, error_response)."""
    if not cfg.bot_token:
        return None, {"ok": False, "error": "bot not configured"}
    try:
        body = await request.json()
    except Exception:
        body = {}
    init_data = body.get("initData", "") if isinstance(body, dict) else ""
    parsed = _validate_init_data(init_data, cfg.bot_token)
    if not parsed or not parsed.get("user") or not parsed["user"].get("id"):
        return None, {"ok": False, "error": "unauthorized"}
    return {"tg_user": parsed["user"], "body": body}, None


async def _profile_payload(user_id: int, username: str | None) -> dict:
    user = await db.get_or_create_user(user_id, username)
    wallets = []
    for key, m in pricing.MODELS.items():
        remaining = await db.get_wallet(user_id, key)
        wallets.append({"model_key": key, "title": m.title, "remaining": remaining})
    return {
        "user_id": user["user_id"],
        "username": user["username"],
        "balance_rub": user["balance_rub"],
        "free_requests": user["free_requests"],
        "wallets": wallets,
    }


def _models_payload() -> list[dict]:
    out = []
    for key, m in pricing.MODELS.items():
        out.append({
            "key": key,
            "title": m.title,
            "provider": m.provider,
            "kind": m.kind,
            "category": m.category,
            "description": m.description,
            "sell_rub_per_1m": m.sell_rub_per_1m,
            "supports_files": m.supports_files,
            "packages": [{"amount": a, "price": p} for a, p in pricing.list_packages(key)],
        })
    return out


def setup_routes(app: web.Application, bot: Bot):

    # ---------------- public ----------------

    async def api_models(request: web.Request) -> web.Response:
        return web.json_response({"ok": True, "models": _models_payload(), "min_topup_rub": cfg.min_topup_rub})

    async def api_support(request: web.Request) -> web.Response:
        return web.json_response({
            "ok": True,
            "user_agreement_url": cfg.user_agreement_url,
            "privacy_policy_url": cfg.privacy_policy_url,
            "channel_url": cfg.channel_url,
        })

    # ---------------- authorized ----------------

    async def api_profile(request: web.Request) -> web.Response:
        auth, err = await _auth_request(request)
        if err:
            return web.json_response(err, status=401)
        tg_user = auth["tg_user"]
        payload = await _profile_payload(tg_user["id"], tg_user.get("username"))
        return web.json_response({"ok": True, **payload})

    async def api_balance_topup(request: web.Request) -> web.Response:
        auth, err = await _auth_request(request)
        if err:
            return web.json_response(err, status=401)
        tg_user = auth["tg_user"]
        body = auth["body"]
        try:
            amount = float(str(body.get("amount", "")).replace(",", "."))
        except (TypeError, ValueError):
            return web.json_response({"ok": False, "error": "bad amount"}, status=400)
        if amount < cfg.min_topup_rub:
            return web.json_response({"ok": False, "error": f"min_topup_{cfg.min_topup_rub}"}, status=400)

        await db.get_or_create_user(tg_user["id"], tg_user.get("username"))
        method = cfg.platega_active_methods[0] if cfg.platega_active_methods else 2
        tx_id = await db.create_transaction(tg_user["id"], amount, method)
        try:
            url = await platega.create_payment(amount, tx_id, description=f"Пополнение баланса, польз. {tg_user['id']}")
        except Exception:
            log.exception("platega create_payment failed (miniapp)")
            url = ""
        if not url:
            return web.json_response({"ok": False, "error": "payment_failed"}, status=502)
        return web.json_response({"ok": True, "url": url, "amount": amount})

    async def api_balance_history(request: web.Request) -> web.Response:
        auth, err = await _auth_request(request)
        if err:
            return web.json_response(err, status=401)
        history = await db.user_transaction_history(auth["tg_user"]["id"])
        return web.json_response({"ok": True, "history": history})

    async def api_buy(request: web.Request) -> web.Response:
        auth, err = await _auth_request(request)
        if err:
            return web.json_response(err, status=401)
        tg_user = auth["tg_user"]
        body = auth["body"]
        model_key = body.get("model_key")
        try:
            amount = int(body.get("amount"))
        except (TypeError, ValueError):
            return web.json_response({"ok": False, "error": "bad amount"}, status=400)
        if model_key not in pricing.MODELS:
            return web.json_response({"ok": False, "error": "unknown model"}, status=400)

        price = pricing.package_price(model_key, amount)
        user = await db.get_or_create_user(tg_user["id"], tg_user.get("username"))
        if user["balance_rub"] < price:
            return web.json_response({
                "ok": False, "error": "not_enough_balance",
                "missing": round(price - user["balance_rub"], 2),
            }, status=402)

        await db.add_balance(tg_user["id"], -price)
        await db.add_wallet(tg_user["id"], model_key, amount)
        m = pricing.MODELS[model_key]

        result = await db.credit_referral_commission(tg_user["id"], price, cfg.referral_commission_percent)
        if result:
            referrer_id, commission = result
            try:
                await bot.send_message(
                    referrer_id,
                    f"💸 Твой реферал купил пакет «{m.title}» — тебе начислено {commission:.2f} ₽ "
                    f"({cfg.referral_commission_percent:.0f}% от покупки) на баланс.",
                )
            except Exception:
                log.warning("failed to notify referrer %s about commission (miniapp)", referrer_id)

        payload = await _profile_payload(tg_user["id"], tg_user.get("username"))
        return web.json_response({"ok": True, "price": price, "title": m.title, **payload})

    async def api_promo(request: web.Request) -> web.Response:
        auth, err = await _auth_request(request)
        if err:
            return web.json_response(err, status=401)
        tg_user = auth["tg_user"]
        code = str(auth["body"].get("code", "")).strip()
        if not code:
            return web.json_response({"ok": False, "error": "empty code"}, status=400)
        ok, msg = await db.redeem_promo(code, tg_user["id"])
        return web.json_response({"ok": ok, "message": msg})

    async def api_referral(request: web.Request) -> web.Response:
        auth, err = await _auth_request(request)
        if err:
            return web.json_response(err, status=401)
        tg_user = auth["tg_user"]
        bot_user = await bot.get_me()
        link = f"https://t.me/{bot_user.username}?start=ref{tg_user['id']}"
        cur = await db.db().execute("SELECT COUNT(*) FROM users WHERE ref_by=?", (tg_user["id"],))
        row = await cur.fetchone()
        count = row[0] if row else 0
        return web.json_response({
            "ok": True, "link": link, "count": count,
            "free_requests_per_ref": cfg.referral_free_requests,
            "commission_percent": cfg.referral_commission_percent,
        })

    async def api_tickets_list(request: web.Request) -> web.Response:
        auth, err = await _auth_request(request)
        if err:
            return web.json_response(err, status=401)
        tickets = await db.user_open_tickets(auth["tg_user"]["id"])
        return web.json_response({"ok": True, "tickets": tickets})

    async def api_ticket_new(request: web.Request) -> web.Response:
        auth, err = await _auth_request(request)
        if err:
            return web.json_response(err, status=401)
        tg_user = auth["tg_user"]
        text = str(auth["body"].get("text", "")).strip()
        if not text:
            return web.json_response({"ok": False, "error": "empty text"}, status=400)
        await db.get_or_create_user(tg_user["id"], tg_user.get("username"))
        ticket_id = await db.create_ticket(tg_user["id"], text)
        for admin_id in cfg.admin_ids:
            try:
                await bot.send_message(
                    admin_id,
                    f"🎫 Новый тикет #{ticket_id} от {tg_user['id']} (@{tg_user.get('username')}) [мини-апп]:\n\n{text}",
                )
            except Exception:
                log.exception("failed to notify admin about new ticket (miniapp)")
        return web.json_response({"ok": True, "ticket_id": ticket_id})

    async def api_ticket_view(request: web.Request) -> web.Response:
        auth, err = await _auth_request(request)
        if err:
            return web.json_response(err, status=401)
        tg_user = auth["tg_user"]
        try:
            ticket_id = int(auth["body"].get("ticket_id"))
        except (TypeError, ValueError):
            return web.json_response({"ok": False, "error": "bad ticket_id"}, status=400)
        ticket = await db.get_ticket(ticket_id)
        if not ticket or ticket["user_id"] != tg_user["id"]:
            return web.json_response({"ok": False, "error": "not found"}, status=404)
        msgs = await db.ticket_messages(ticket_id)
        return web.json_response({"ok": True, "ticket": ticket, "messages": msgs})

    async def api_ticket_reply(request: web.Request) -> web.Response:
        auth, err = await _auth_request(request)
        if err:
            return web.json_response(err, status=401)
        tg_user = auth["tg_user"]
        body = auth["body"]
        try:
            ticket_id = int(body.get("ticket_id"))
        except (TypeError, ValueError):
            return web.json_response({"ok": False, "error": "bad ticket_id"}, status=400)
        text = str(body.get("text", "")).strip()
        ticket = await db.get_ticket(ticket_id)
        if not ticket or ticket["user_id"] != tg_user["id"]:
            return web.json_response({"ok": False, "error": "not found"}, status=404)
        if not text:
            return web.json_response({"ok": False, "error": "empty text"}, status=400)
        await db.add_ticket_message(ticket_id, "user", text)
        for admin_id in cfg.admin_ids:
            try:
                await bot.send_message(admin_id, f"✉️ Новое сообщение в тикете #{ticket_id} [мини-апп]:\n\n{text}")
            except Exception:
                log.exception("failed to notify admin about ticket reply (miniapp)")
        return web.json_response({"ok": True})

    app.router.add_get("/api/models", api_models)
    app.router.add_get("/api/support", api_support)
    app.router.add_post("/api/profile", api_profile)
    app.router.add_post("/api/balance/topup", api_balance_topup)
    app.router.add_post("/api/balance/history", api_balance_history)
    app.router.add_post("/api/buy", api_buy)
    app.router.add_post("/api/promo", api_promo)
    app.router.add_post("/api/referral", api_referral)
    app.router.add_post("/api/tickets", api_tickets_list)
    app.router.add_post("/api/ticket/new", api_ticket_new)
    app.router.add_post("/api/ticket/view", api_ticket_view)
    app.router.add_post("/api/ticket/reply", api_ticket_reply)

    # ---------------- static (сам мини-апп: index.html/app.js/style.css) ----------------

    static_dir = Path(cfg.miniapp_static_dir).resolve()
    if static_dir.is_dir():

        async def app_index(request: web.Request) -> web.Response:
            index_file = static_dir / "index.html"
            if not index_file.is_file():
                return web.Response(text="Mini App static files not found", status=404)
            return web.FileResponse(index_file)

        # Явные маршруты для "/app" и "/app/" регистрируются ДО add_static: у aiohttp
        # PlainResource с точным путём имеет приоритет только если добавлен раньше —
        # иначе запрос на "/app/" попадает в статический обработчик директории и
        # возвращает 403 (show_index=False), а не отдаёт index.html.
        app.router.add_get("/app", app_index)
        app.router.add_get("/app/", app_index)
        app.router.add_static("/app/", path=str(static_dir), show_index=False, name="miniapp_static")
    else:
        log.warning(
            "MINIAPP_STATIC_DIR (%s) не найдена — мини-апп не будет раздаваться. "
            "Проверь путь в .env или что папка webapp_static лежит рядом с bot.py.",
            static_dir,
        )
