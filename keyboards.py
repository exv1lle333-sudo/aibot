# -*- coding: utf-8 -*-
from aiogram.types import InlineKeyboardMarkup, ReplyKeyboardMarkup, WebAppInfo
from aiogram.utils.keyboard import InlineKeyboardBuilder, ReplyKeyboardBuilder

import pricing
from config import cfg


# ---------------- persistent bottom (reply) menu ----------------
# Текст этих кнопок = сами кнопки, поэтому вынесен в константы:
# и клавиатура, и обработчики в handlers/user.py ссылаются на одни и те же значения.

MAIN_BTN_CHAT = "💬 Начать чат"
MAIN_BTN_PURCHASE = "🛒 Покупка"
MAIN_BTN_PROFILE = "👤 Профиль"
MAIN_BTN_BALANCE = "💰 Баланс"
MAIN_BTN_PROMO = "🎁 Промокод"
MAIN_BTN_SUPPORT = "🛟 Поддержка"
MAIN_BTN_REFERRAL = "👥 Рефералы"
MAIN_BTN_CHANNEL = "📢 Наш канал"
MAIN_BTN_ADMIN = "🛠 Админ-панель"
MAIN_BTN_MODE = "⚙️ Режим"

CHAT_BTN_CLEAR = "🧹 Очистить диалог"
CHAT_BTN_BACK = "⬅️ В главное меню"

MAIN_BTN_MINIAPP = "🖥 Мини-апп"


def main_reply_kb(is_admin: bool = False) -> ReplyKeyboardMarkup:
    b = ReplyKeyboardBuilder()
    has_miniapp = bool(cfg.miniapp_url)
    if has_miniapp:
        # web_app-кнопка обязательно должна вести на https — иначе Telegram её не покажет/не откроет
        b.button(text=MAIN_BTN_MINIAPP, web_app=WebAppInfo(url=cfg.miniapp_url))
    b.button(text=MAIN_BTN_CHAT)
    b.button(text=MAIN_BTN_PURCHASE)
    b.button(text=MAIN_BTN_PROFILE)
    b.button(text=MAIN_BTN_BALANCE)
    b.button(text=MAIN_BTN_PROMO)
    b.button(text=MAIN_BTN_SUPPORT)
    b.button(text=MAIN_BTN_REFERRAL)
    b.button(text=MAIN_BTN_CHANNEL)
    b.button(text=MAIN_BTN_MODE)
    sizes = [1, 2, 2, 2, 2, 1] if has_miniapp else [2, 2, 2, 2, 1]
    if is_admin:
        b.button(text=MAIN_BTN_ADMIN)
        sizes.append(1)
    b.adjust(*sizes)
    return b.as_markup(resize_keyboard=True)


def mode_kb(current_mode: str) -> InlineKeyboardMarkup:
    """Инлайн-выбор режима диалога: обычный (с историей) / экономный (без истории —
    каждое сообщение как новый диалог, меньше токенов за счёт истории)."""
    b = InlineKeyboardBuilder()
    normal_mark = "✅ " if current_mode == "normal" else ""
    economy_mark = "✅ " if current_mode == "economy" else ""
    b.button(text=f"{normal_mark}💬 Обычный", callback_data="mode:set:normal")
    b.button(text=f"{economy_mark}⚡ Экономный", callback_data="mode:set:economy")
    b.adjust(1)
    return b.as_markup()


def chat_reply_kb() -> ReplyKeyboardMarkup:
    b = ReplyKeyboardBuilder()
    b.button(text=CHAT_BTN_CLEAR)
    b.button(text=CHAT_BTN_BACK)
    b.adjust(2)
    return b.as_markup(resize_keyboard=True)


# ---------------- inline keyboards (подменю поверх сообщений) ----------------

def main_menu(is_admin: bool = False) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="👤 Профиль", callback_data="menu:profile")
    b.button(text="💰 Баланс", callback_data="menu:balance")
    b.button(text="🛒 Покупка", callback_data="models_list:buy")
    b.button(text="🎁 Промокод", callback_data="menu:promo")
    b.button(text="🛟 Поддержка", callback_data="menu:support")
    b.button(text="👥 Рефералы", callback_data="menu:referral")
    b.button(text="📢 Наш канал", url=cfg.channel_url)
    sizes = [2, 2, 2, 1]
    if is_admin:
        b.button(text="🛠 Админ-панель", callback_data="menu:admin")
        sizes.append(1)
    b.adjust(*sizes)
    return b.as_markup()


def back_to_main() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="⬅️ В главное меню", callback_data="menu:main")
    return b.as_markup()


def balance_menu() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="➕ Пополнить баланс", callback_data="balance:topup")
    b.button(text="📜 История платежей", callback_data="balance:history")
    b.button(text="⬅️ В главное меню", callback_data="menu:main")
    b.adjust(1)
    return b.as_markup()


def pay_link_kb(url: str) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="💳 Оплатить", url=url)
    b.button(text="⬅️ В главное меню", callback_data="menu:main")
    b.adjust(1)
    return b.as_markup()


def categories_kb(mode: str) -> InlineKeyboardMarkup:
    """mode: 'buy' — покупка токенов; 'chat' — начать диалог.
    Первый шаг: выбор категории моделей (фото/Claude/Gemini/GPT/другие)."""
    b = InlineKeyboardBuilder()
    for cat in pricing.categories_with_models():
        b.button(text=pricing.CATEGORY_TITLES[cat], callback_data=f"models_cat:{mode}:{cat}")
    b.button(text="⬅️ В главное меню", callback_data="menu:main")
    b.adjust(1)
    return b.as_markup()


def models_in_category_kb(mode: str, category: str) -> InlineKeyboardMarkup:
    """Второй шаг: список моделей внутри выбранной категории."""
    b = InlineKeyboardBuilder()
    for key, m in pricing.models_in_category(category):
        b.button(text=m.title, callback_data=f"model:{mode}:{key}")
    b.button(text="⬅️ К категориям", callback_data=f"models_list:{mode}")
    b.adjust(1)
    return b.as_markup()


def model_card_kb(model_key: str, mode: str) -> InlineKeyboardMarkup:
    """mode: 'buy' — показываем пакеты токенов на покупку; 'chat' — только кнопка начать диалог,
    без возможности купить (её убрали из "Начать чат" по просьбе — покупка теперь только
    через отдельный раздел "🛒 Покупка")."""
    b = InlineKeyboardBuilder()
    if mode == "buy":
        for amount, price in pricing.list_packages(model_key):
            b.button(text=f"{amount:,} ток. — {price} ₽".replace(",", " "), callback_data=f"buy:{model_key}:{amount}")
    b.button(text="💬 Начать диалог", callback_data=f"chat:{model_key}")
    category = pricing.MODELS[model_key].category
    b.button(text="⬅️ К моделям", callback_data=f"models_cat:{mode}:{category}")
    b.adjust(1)
    return b.as_markup()


def confirm_topup_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="➕ Пополнить баланс", callback_data="balance:topup")
    b.button(text="⬅️ В главное меню", callback_data="menu:main")
    b.adjust(1)
    return b.as_markup()


def support_menu() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="🎫 Мои тикеты / Написать в поддержку", callback_data="support:tickets")
    b.button(text="📄 Пользовательское соглашение", callback_data="support:agreement")
    b.button(text="🔒 Политика конфиденциальности", callback_data="support:privacy")
    b.button(text="⬅️ В главное меню", callback_data="menu:main")
    b.adjust(1)
    return b.as_markup()


def tickets_menu(tickets: list[dict]) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="✍️ Новое обращение", callback_data="ticket:new")
    for t in tickets[:10]:
        status = "🟢" if t["status"] == "open" else "⚪️"
        b.button(text=f"{status} Тикет #{t['id']}", callback_data=f"ticket:view:{t['id']}")
    b.button(text="⬅️ Назад", callback_data="menu:support")
    b.adjust(1)
    return b.as_markup()


def ticket_view_kb(ticket_id: int, is_open: bool) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    if is_open:
        b.button(text="✏️ Ответить", callback_data=f"ticket:reply:{ticket_id}")
    b.button(text="⬅️ К тикетам", callback_data="support:tickets")
    b.adjust(1)
    return b.as_markup()


def chat_kb(model_key: str) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="🧹 Очистить диалог", callback_data=f"chat:clear:{model_key}")
    b.button(text="⬅️ В главное меню", callback_data="menu:main")
    b.adjust(1)
    return b.as_markup()


# ---------------- admin ----------------

def admin_menu() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="💸 Выдать баланс", callback_data="admin:give_balance")
    b.button(text="🔍 Найти пользователя (ID)", callback_data="admin:find_user")
    b.button(text="✉️ Написать одному (ID)", callback_data="admin:write_one")
    b.button(text="📣 Рассылка всем", callback_data="admin:broadcast")
    b.button(text="🎫 Тикеты", callback_data="admin:tickets")
    b.button(text="👥 Пользователи", callback_data="admin:users")
    b.button(text="🧾 История платежей", callback_data="admin:payments")
    b.button(text="🎁 Промокоды", callback_data="admin:promo")
    b.button(text="📊 Статистика", callback_data="admin:stats")
    b.button(text="🔑 Настройки ForgetAPI", callback_data="admin:forgetapi")
    b.button(text="⬅️ В главное меню", callback_data="menu:main")
    b.adjust(1)
    return b.as_markup()


def admin_back_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="⬅️ В админ-панель", callback_data="menu:admin")
    return b.as_markup()


def admin_tickets_kb(tickets: list[dict]) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    for t in tickets[:20]:
        b.button(text=f"Тикет #{t['id']} (user {t['user_id']})", callback_data=f"admin:ticket:{t['id']}")
    b.button(text="⬅️ В админ-панель", callback_data="menu:admin")
    b.adjust(1)
    return b.as_markup()


def admin_ticket_view_kb(ticket_id: int) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="✏️ Ответить", callback_data=f"admin:ticket_reply:{ticket_id}")
    b.button(text="✅ Закрыть тикет", callback_data=f"admin:ticket_close:{ticket_id}")
    b.button(text="⬅️ К тикетам", callback_data="admin:tickets")
    b.adjust(1)
    return b.as_markup()
