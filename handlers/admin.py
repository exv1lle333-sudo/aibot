# -*- coding: utf-8 -*-
import asyncio
import logging

from aiogram import Router, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message, CallbackQuery

from database import db
import texts
import keyboards as kb
import pricing
from config import cfg

router = Router(name="admin")
log = logging.getLogger(__name__)


def is_admin(user_id: int) -> bool:
    return user_id in cfg.admin_ids


class AdminGiveBalance(StatesGroup):
    waiting_user_id = State()
    waiting_amount = State()


class AdminFindUser(StatesGroup):
    waiting_query = State()


class AdminWriteOne(StatesGroup):
    waiting_user_id = State()
    waiting_text = State()


class AdminBroadcast(StatesGroup):
    waiting_text = State()


class AdminPromo(StatesGroup):
    waiting_data = State()


class AdminForgetApi(StatesGroup):
    waiting_key = State()


class AdminTicketReply(StatesGroup):
    waiting_text = State()


@router.message(Command("admin"))
async def cmd_admin(message: Message):
    if not is_admin(message.from_user.id):
        await message.answer(texts.ADMIN_NOT_ALLOWED)
        return
    await message.answer(texts.ADMIN_MENU, reply_markup=kb.admin_menu())


@router.callback_query(F.data == "menu:admin")
async def cb_admin_menu(call: CallbackQuery, state: FSMContext):
    if not is_admin(call.from_user.id):
        await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
        return
    await state.clear()
    await call.message.edit_text(texts.ADMIN_MENU, reply_markup=kb.admin_menu())
    await call.answer()


def _guard(call: CallbackQuery) -> bool:
    return is_admin(call.from_user.id)


# ---------------- give balance ----------------

@router.callback_query(F.data == "admin:give_balance")
async def cb_give_balance(call: CallbackQuery, state: FSMContext):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    await state.set_state(AdminGiveBalance.waiting_user_id)
    await call.message.edit_text(texts.ADMIN_GIVE_BALANCE_ASK_ID, reply_markup=kb.admin_back_kb())
    await call.answer()


@router.message(AdminGiveBalance.waiting_user_id)
async def on_give_balance_id(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    try:
        uid = int(message.text.strip())
    except ValueError:
        await message.answer("ID должен быть числом. Попробуйте снова.")
        return
    await state.update_data(user_id=uid)
    await state.set_state(AdminGiveBalance.waiting_amount)
    await message.answer(texts.ADMIN_GIVE_BALANCE_ASK_AMOUNT)


@router.message(AdminGiveBalance.waiting_amount)
async def on_give_balance_amount(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    data = await state.get_data()
    try:
        amount = float(message.text.replace(",", "."))
    except ValueError:
        await message.answer("Сумма должна быть числом. Попробуйте снова.")
        return
    await state.clear()
    await db.get_or_create_user(data["user_id"], None)
    await db.add_balance(data["user_id"], amount)
    await message.answer(
        texts.ADMIN_GIVE_BALANCE_DONE.format(user_id=data["user_id"], amount=amount), reply_markup=kb.admin_back_kb()
    )
    try:
        await message.bot.send_message(data["user_id"], f"💸 Вам начислено {amount:.2f} ₽ администратором.")
    except Exception:
        log.exception("failed to notify user about balance grant")


# ---------------- find user ----------------

@router.callback_query(F.data == "admin:find_user")
async def cb_find_user(call: CallbackQuery, state: FSMContext):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    await state.set_state(AdminFindUser.waiting_query)
    await call.message.edit_text(texts.ADMIN_FIND_USER_ASK, reply_markup=kb.admin_back_kb())
    await call.answer()


@router.message(AdminFindUser.waiting_query)
async def on_find_user(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    await state.clear()
    q = message.text.strip()
    user = None
    if q.startswith("@"):
        user = await db.find_user_by_username(q)
    else:
        try:
            user = await db.get_user(int(q))
        except ValueError:
            user = await db.find_user_by_username(q)
    if not user:
        await message.answer(texts.ADMIN_FIND_USER_NOT_FOUND, reply_markup=kb.admin_back_kb())
        return
    wallet_lines = []
    for key, m in pricing.MODELS.items():
        remaining = await db.get_wallet(user["user_id"], key)
        wallet_lines.append(f"• {m.title}: {remaining:.0f} токенов")
    text = (
        f"ID: <code>{user['user_id']}</code>\n"
        f"Username: @{user['username']}\n"
        f"Баланс: {user['balance_rub']:.2f} ₽\n"
        f"Забанен: {'да' if user['banned'] else 'нет'}\n\n"
        f"Токены по моделям:\n" + "\n".join(wallet_lines)
    )
    await message.answer(text, reply_markup=kb.admin_back_kb())


# ---------------- write to one user ----------------

@router.callback_query(F.data == "admin:write_one")
async def cb_write_one(call: CallbackQuery, state: FSMContext):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    await state.set_state(AdminWriteOne.waiting_user_id)
    await call.message.edit_text(texts.ADMIN_WRITE_ONE_ASK_ID, reply_markup=kb.admin_back_kb())
    await call.answer()


@router.message(AdminWriteOne.waiting_user_id)
async def on_write_one_id(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    try:
        uid = int(message.text.strip())
    except ValueError:
        await message.answer("ID должен быть числом.")
        return
    await state.update_data(user_id=uid)
    await state.set_state(AdminWriteOne.waiting_text)
    await message.answer(texts.ADMIN_WRITE_ONE_ASK_TEXT)


@router.message(AdminWriteOne.waiting_text)
async def on_write_one_text(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    data = await state.get_data()
    await state.clear()
    try:
        await message.bot.send_message(data["user_id"], message.text)
        await message.answer(texts.ADMIN_WRITE_ONE_DONE.format(user_id=data["user_id"]), reply_markup=kb.admin_back_kb())
    except Exception:
        await message.answer("Не удалось отправить сообщение (пользователь мог заблокировать бота).", reply_markup=kb.admin_back_kb())


# ---------------- broadcast ----------------

@router.callback_query(F.data == "admin:broadcast")
async def cb_broadcast(call: CallbackQuery, state: FSMContext):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    await state.set_state(AdminBroadcast.waiting_text)
    await call.message.edit_text(texts.ADMIN_BROADCAST_ASK, reply_markup=kb.admin_back_kb())
    await call.answer()


@router.message(AdminBroadcast.waiting_text)
async def on_broadcast_text(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    await state.clear()
    ids = await db.all_user_ids()
    ok = fail = 0
    for uid in ids:
        try:
            await message.bot.send_message(uid, message.text)
            ok += 1
        except Exception:
            fail += 1
        await asyncio.sleep(0.05)  # не упираемся в лимиты Telegram
    await message.answer(texts.ADMIN_BROADCAST_DONE.format(ok=ok, fail=fail), reply_markup=kb.admin_back_kb())


# ---------------- tickets (admin side) ----------------

@router.callback_query(F.data == "admin:tickets")
async def cb_admin_tickets(call: CallbackQuery):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    tickets = await db.open_tickets()
    text = "Открытых тикетов нет." if not tickets else "🎫 Открытые тикеты:"
    await call.message.edit_text(text, reply_markup=kb.admin_tickets_kb(tickets))
    await call.answer()


@router.callback_query(F.data.startswith("admin:ticket:"))
async def cb_admin_ticket_view(call: CallbackQuery):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    ticket_id = int(call.data.split(":")[2])
    ticket = await db.get_ticket(ticket_id)
    msgs = await db.ticket_messages(ticket_id)
    lines = [f"{'Пользователь' if m['sender']=='user' else 'Админ'}: {m['text']}" for m in msgs]
    text = f"🎫 Тикет #{ticket_id} (user {ticket['user_id']}, {ticket['status']})\n\n" + "\n\n".join(lines)
    await call.message.edit_text(text, reply_markup=kb.admin_ticket_view_kb(ticket_id))
    await call.answer()


@router.callback_query(F.data.startswith("admin:ticket_reply:"))
async def cb_admin_ticket_reply_start(call: CallbackQuery, state: FSMContext):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    ticket_id = int(call.data.split(":")[2])
    await state.set_state(AdminTicketReply.waiting_text)
    await state.update_data(ticket_id=ticket_id)
    await call.message.edit_text("Введите ответ пользователю:", reply_markup=kb.admin_back_kb())
    await call.answer()


@router.message(AdminTicketReply.waiting_text)
async def on_admin_ticket_reply(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    data = await state.get_data()
    ticket_id = data["ticket_id"]
    await state.clear()
    ticket = await db.get_ticket(ticket_id)
    await db.add_ticket_message(ticket_id, "admin", message.text)
    try:
        await message.bot.send_message(ticket["user_id"], f"🛟 Ответ поддержки по тикету #{ticket_id}:\n\n{message.text}")
    except Exception:
        log.exception("failed to notify user about ticket reply")
    await message.answer("Ответ отправлен пользователю.", reply_markup=kb.admin_back_kb())


@router.callback_query(F.data.startswith("admin:ticket_close:"))
async def cb_admin_ticket_close(call: CallbackQuery):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    ticket_id = int(call.data.split(":")[2])
    ticket = await db.get_ticket(ticket_id)
    await db.close_ticket(ticket_id)
    try:
        await call.bot.send_message(ticket["user_id"], texts.TICKET_CLOSED_FOR_USER.format(ticket_id=ticket_id))
    except Exception:
        log.exception("failed to notify user about ticket close")
    await call.answer("Тикет закрыт.")
    tickets = await db.open_tickets()
    await call.message.edit_text("Открытых тикетов нет." if not tickets else "🎫 Открытые тикеты:", reply_markup=kb.admin_tickets_kb(tickets))


# ---------------- users / payments / stats ----------------

@router.callback_query(F.data == "admin:users")
async def cb_admin_users(call: CallbackQuery):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    count = await db.user_count()
    await call.message.edit_text(f"👥 Всего пользователей: {count}", reply_markup=kb.admin_back_kb())
    await call.answer()


@router.callback_query(F.data == "admin:payments")
async def cb_admin_payments(call: CallbackQuery):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    txs = await db.recent_transactions()
    if not txs:
        text = "Платежей пока нет."
    else:
        lines = [f"{tx['user_id']}: {tx['amount_rub']:.2f} ₽ — {tx['status']}" for tx in txs]
        text = "🧾 Последние платежи:\n\n" + "\n".join(lines)
    await call.message.edit_text(text, reply_markup=kb.admin_back_kb())
    await call.answer()


@router.callback_query(F.data == "admin:stats")
async def cb_admin_stats(call: CallbackQuery):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    users = await db.user_count()
    open_t = await db.open_tickets()
    txs = await db.recent_transactions(10_000)
    paid = [t for t in txs if t["status"] == "paid"]
    text = texts.ADMIN_STATS_TMPL.format(
        users=users, open_tickets=len(open_t), tx_count=len(paid), tx_sum=sum(t["amount_rub"] for t in paid)
    )
    await call.message.edit_text(text, reply_markup=kb.admin_back_kb())
    await call.answer()


# ---------------- promo codes ----------------

@router.callback_query(F.data == "admin:promo")
async def cb_admin_promo(call: CallbackQuery, state: FSMContext):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    await state.set_state(AdminPromo.waiting_data)
    await call.message.edit_text(texts.ADMIN_PROMO_ASK, reply_markup=kb.admin_back_kb())
    await call.answer()


@router.message(AdminPromo.waiting_data)
async def on_admin_promo(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    await state.clear()
    parts = message.text.split()
    if len(parts) != 3:
        await message.answer("Формат: КОД СУММА КОЛ_ВО_АКТИВАЦИЙ", reply_markup=kb.admin_back_kb())
        return
    code, bonus_s, max_uses_s = parts
    try:
        bonus = float(bonus_s)
        max_uses = int(max_uses_s)
    except ValueError:
        await message.answer("Сумма и количество активаций должны быть числами.", reply_markup=kb.admin_back_kb())
        return
    await db.create_promo(code.upper(), bonus, max_uses)
    await message.answer(
        texts.ADMIN_PROMO_DONE.format(code=code.upper(), bonus=bonus, max_uses=max_uses), reply_markup=kb.admin_back_kb()
    )


# ---------------- forgetapi settings ----------------

@router.callback_query(F.data == "admin:forgetapi")
async def cb_admin_forgetapi(call: CallbackQuery, state: FSMContext):
    if not _guard(call):
        return await call.answer(texts.ADMIN_NOT_ALLOWED, show_alert=True)
    await state.set_state(AdminForgetApi.waiting_key)
    await call.message.edit_text(texts.ADMIN_FORGETAPI_ASK, reply_markup=kb.admin_back_kb())
    await call.answer()


@router.message(AdminForgetApi.waiting_key)
async def on_admin_forgetapi_key(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    await state.clear()
    await db.set_setting("forgetapi_key", message.text.strip())
    await message.answer(texts.ADMIN_FORGETAPI_DONE, reply_markup=kb.admin_back_kb())
