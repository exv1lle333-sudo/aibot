"""
Слой работы с базой данных (SQLite, через aiosqlite).
Одного файла достаточно для среднего бота; при росте нагрузки можно перейти на Postgres,
поменяв только этот модуль (интерфейс функций останется тем же).
"""
import time
import secrets
import aiosqlite

from config import cfg

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    balance_rub REAL NOT NULL DEFAULT 0,
    free_requests INTEGER NOT NULL DEFAULT 0,
    ref_by INTEGER,
    banned INTEGER NOT NULL DEFAULT 0,
    chat_mode TEXT NOT NULL DEFAULT 'normal',   -- 'normal' (с историей) / 'economy' (без истории, дешевле по токенам)
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
    user_id INTEGER NOT NULL,
    model_key TEXT NOT NULL,
    remaining REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, model_key)
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    amount_rub REAL NOT NULL,
    status TEXT NOT NULL,          -- pending / paid / failed
    method INTEGER,
    created_at INTEGER NOT NULL,
    paid_at INTEGER
);

CREATE TABLE IF NOT EXISTS dialogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    model_key TEXT NOT NULL,
    role TEXT NOT NULL,             -- user / assistant
    content TEXT NOT NULL,
    attachments TEXT,               -- JSON-список вложений (фото/файлы), может быть NULL
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',   -- open / closed
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    sender TEXT NOT NULL,   -- user / admin
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    bonus_rub REAL NOT NULL,
    max_uses INTEGER NOT NULL,
    used_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
    code TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (code, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

_db: aiosqlite.Connection | None = None


async def init_db():
    global _db
    _db = await aiosqlite.connect(cfg.db_path)
    await _db.executescript(SCHEMA)
    await _db.commit()
    await _migrate_dialogs_add_id()
    await _migrate_dialogs_add_attachments()
    await _migrate_users_add_chat_mode()
    return _db


async def _migrate_dialogs_add_id():
    """
    Старые базы были созданы до того, как в таблицу dialogs добавили
    автоинкрементный столбец id (использовавшийся в ORDER BY id в get_dialog,
    из-за чего падало "OperationalError: no such column: id").
    Если столбца id ещё нет — пересоздаём таблицу с сохранением всех данных.
    """
    cur = await _db.execute("PRAGMA table_info(dialogs)")
    cols = [row[1] for row in await cur.fetchall()]
    if "id" in cols:
        return
    await _db.executescript(
        """
        ALTER TABLE dialogs RENAME TO dialogs_old;
        CREATE TABLE dialogs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            model_key TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        INSERT INTO dialogs (user_id, model_key, role, content, created_at)
            SELECT user_id, model_key, role, content, created_at FROM dialogs_old ORDER BY created_at;
        DROP TABLE dialogs_old;
        """
    )
    await _db.commit()


async def _migrate_dialogs_add_attachments():
    """Добавляет столбец attachments (фото/файлы в диалоге) в старые базы."""
    cur = await _db.execute("PRAGMA table_info(dialogs)")
    cols = [row[1] for row in await cur.fetchall()]
    if "attachments" in cols:
        return
    await _db.execute("ALTER TABLE dialogs ADD COLUMN attachments TEXT")
    await _db.commit()


async def _migrate_users_add_chat_mode():
    """Добавляет столбец chat_mode (обычный/экономный режим диалога) в старые базы."""
    cur = await _db.execute("PRAGMA table_info(users)")
    cols = [row[1] for row in await cur.fetchall()]
    if "chat_mode" in cols:
        return
    await _db.execute("ALTER TABLE users ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'normal'")
    await _db.commit()


def db() -> aiosqlite.Connection:
    assert _db is not None, "DB not initialized"
    return _db


# ---------- users ----------

async def get_or_create_user(user_id: int, username: str | None, ref_by: int | None = None) -> dict:
    cur = await db().execute("SELECT * FROM users WHERE user_id=?", (user_id,))
    row = await cur.fetchone()
    if row:
        return dict(zip([c[0] for c in cur.description], row))
    await db().execute(
        "INSERT INTO users (user_id, username, balance_rub, free_requests, ref_by, created_at) "
        "VALUES (?, ?, 0, 0, ?, ?)",
        (user_id, username, ref_by, int(time.time())),
    )
    if ref_by:
        # начисляем рефереру бесплатные запросы GPT-модели
        await add_free_requests(ref_by, cfg.referral_free_requests)
    await db().commit()
    if cfg.signup_bonus_tokens > 0:
        # приветственный бонус токенов Gemini 3.1 Flash Lite — каждому новому пользователю,
        # независимо от того, пришёл он по реферальной ссылке или нет
        await add_wallet(user_id, "gemini-3.1-flash-lite", cfg.signup_bonus_tokens)
    cur = await db().execute("SELECT * FROM users WHERE user_id=?", (user_id,))
    row = await cur.fetchone()
    return dict(zip([c[0] for c in cur.description], row))


async def get_user(user_id: int) -> dict | None:
    cur = await db().execute("SELECT * FROM users WHERE user_id=?", (user_id,))
    row = await cur.fetchone()
    if not row:
        return None
    return dict(zip([c[0] for c in cur.description], row))


async def find_user_by_username(username: str) -> dict | None:
    username = username.lstrip("@")
    cur = await db().execute("SELECT * FROM users WHERE username=?", (username,))
    row = await cur.fetchone()
    if not row:
        return None
    return dict(zip([c[0] for c in cur.description], row))


async def add_balance(user_id: int, amount_rub: float):
    await db().execute("UPDATE users SET balance_rub = balance_rub + ? WHERE user_id=?", (amount_rub, user_id))
    await db().commit()


async def set_balance(user_id: int, amount_rub: float):
    await db().execute("UPDATE users SET balance_rub = ? WHERE user_id=?", (amount_rub, user_id))
    await db().commit()


async def add_free_requests(user_id: int, n: int):
    await db().execute("UPDATE users SET free_requests = free_requests + ? WHERE user_id=?", (n, user_id))
    await db().commit()


async def get_ref_by(user_id: int) -> int | None:
    cur = await db().execute("SELECT ref_by FROM users WHERE user_id=?", (user_id,))
    row = await cur.fetchone()
    return row[0] if row and row[0] else None


async def credit_referral_commission(user_id: int, purchase_amount_rub: float, percent: float) -> tuple[int, float] | None:
    """
    Если у user_id есть пригласивший (ref_by), начисляет ему percent% от суммы покупки
    прямо на баланс (balance_rub). Возвращает (referrer_id, начисленная_сумма) или None,
    если реферера нет.
    """
    referrer_id = await get_ref_by(user_id)
    if not referrer_id:
        return None
    commission = round(purchase_amount_rub * percent / 100, 2)
    if commission <= 0:
        return None
    await add_balance(referrer_id, commission)
    return referrer_id, commission


async def use_free_request(user_id: int) -> bool:
    cur = await db().execute("SELECT free_requests FROM users WHERE user_id=?", (user_id,))
    row = await cur.fetchone()
    if not row or row[0] <= 0:
        return False
    await db().execute("UPDATE users SET free_requests = free_requests - 1 WHERE user_id=?", (user_id,))
    await db().commit()
    return True


async def set_banned(user_id: int, banned: bool):
    await db().execute("UPDATE users SET banned=? WHERE user_id=?", (1 if banned else 0, user_id))
    await db().commit()


async def all_user_ids() -> list[int]:
    cur = await db().execute("SELECT user_id FROM users")
    rows = await cur.fetchall()
    return [r[0] for r in rows]


async def user_count() -> int:
    cur = await db().execute("SELECT COUNT(*) FROM users")
    row = await cur.fetchone()
    return row[0]


# ---------- wallets (баланс токенов по каждой модели) ----------

async def get_wallet(user_id: int, model_key: str) -> float:
    cur = await db().execute("SELECT remaining FROM wallets WHERE user_id=? AND model_key=?", (user_id, model_key))
    row = await cur.fetchone()
    return row[0] if row else 0.0


async def add_wallet(user_id: int, model_key: str, amount: float):
    await db().execute(
        "INSERT INTO wallets (user_id, model_key, remaining) VALUES (?, ?, ?) "
        "ON CONFLICT(user_id, model_key) DO UPDATE SET remaining = remaining + excluded.remaining",
        (user_id, model_key, amount),
    )
    await db().commit()


async def spend_wallet(user_id: int, model_key: str, amount: float) -> bool:
    remaining = await get_wallet(user_id, model_key)
    if remaining < amount:
        return False
    await db().execute(
        "UPDATE wallets SET remaining = remaining - ? WHERE user_id=? AND model_key=?",
        (amount, user_id, model_key),
    )
    await db().commit()
    return True


# ---------- transactions ----------

async def create_transaction(user_id: int, amount_rub: float, method: int | None) -> str:
    tx_id = secrets.token_hex(16)
    await db().execute(
        "INSERT INTO transactions (id, user_id, amount_rub, status, method, created_at) VALUES (?, ?, ?, 'pending', ?, ?)",
        (tx_id, user_id, amount_rub, method, int(time.time())),
    )
    await db().commit()
    return tx_id


async def mark_transaction_paid(tx_id: str) -> dict | None:
    cur = await db().execute("SELECT * FROM transactions WHERE id=?", (tx_id,))
    row = await cur.fetchone()
    if not row:
        return None
    tx = dict(zip([c[0] for c in cur.description], row))
    if tx["status"] == "paid":
        return tx  # уже обработано (идемпотентность)
    await db().execute("UPDATE transactions SET status='paid', paid_at=? WHERE id=?", (int(time.time()), tx_id))
    await db().commit()
    tx["status"] = "paid"
    return tx


async def get_transaction(tx_id: str) -> dict | None:
    cur = await db().execute("SELECT * FROM transactions WHERE id=?", (tx_id,))
    row = await cur.fetchone()
    if not row:
        return None
    return dict(zip([c[0] for c in cur.description], row))


async def user_transaction_history(user_id: int, limit: int = 10) -> list[dict]:
    cur = await db().execute(
        "SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT ?", (user_id, limit)
    )
    rows = await cur.fetchall()
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in rows]


async def recent_transactions(limit: int = 30) -> list[dict]:
    cur = await db().execute("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?", (limit,))
    rows = await cur.fetchall()
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in rows]


# ---------- dialogs ----------

async def add_message(user_id: int, model_key: str, role: str, content: str, attachments: str | None = None):
    """
    attachments — JSON-строка со списком вложений вида
    [{"kind": "image"|"document"|"text_file", "mime_type": ..., "filename": ..., "data_b64": ...}, ...]
    или None, если сообщение без вложений.
    """
    await db().execute(
        "INSERT INTO dialogs (user_id, model_key, role, content, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, model_key, role, content, attachments, int(time.time())),
    )
    await db().commit()


async def get_dialog(user_id: int, model_key: str, limit: int = 20) -> list[dict]:
    cur = await db().execute(
        "SELECT role, content, attachments FROM dialogs WHERE user_id=? AND model_key=? ORDER BY id DESC LIMIT ?",
        (user_id, model_key, limit),
    )
    rows = await cur.fetchall()
    rows.reverse()
    return [{"role": r[0], "content": r[1], "attachments": r[2]} for r in rows]


async def clear_dialog(user_id: int, model_key: str):
    await db().execute("DELETE FROM dialogs WHERE user_id=? AND model_key=?", (user_id, model_key))
    await db().commit()


# ---------- режим чата (обычный / экономный) ----------

async def get_chat_mode(user_id: int) -> str:
    cur = await db().execute("SELECT chat_mode FROM users WHERE user_id=?", (user_id,))
    row = await cur.fetchone()
    return (row[0] if row and row[0] else "normal")


async def set_chat_mode(user_id: int, mode: str):
    assert mode in ("normal", "economy")
    await db().execute("UPDATE users SET chat_mode=? WHERE user_id=?", (mode, user_id))
    await db().commit()


# ---------- tickets ----------

async def create_ticket(user_id: int, first_message: str) -> int:
    cur = await db().execute(
        "INSERT INTO tickets (user_id, status, created_at) VALUES (?, 'open', ?)", (user_id, int(time.time()))
    )
    await db().commit()
    ticket_id = cur.lastrowid
    await add_ticket_message(ticket_id, "user", first_message)
    return ticket_id


async def add_ticket_message(ticket_id: int, sender: str, text: str):
    await db().execute(
        "INSERT INTO ticket_messages (ticket_id, sender, text, created_at) VALUES (?, ?, ?, ?)",
        (ticket_id, sender, text, int(time.time())),
    )
    await db().commit()


async def get_ticket(ticket_id: int) -> dict | None:
    cur = await db().execute("SELECT * FROM tickets WHERE id=?", (ticket_id,))
    row = await cur.fetchone()
    if not row:
        return None
    return dict(zip([c[0] for c in cur.description], row))


async def user_open_tickets(user_id: int) -> list[dict]:
    cur = await db().execute(
        "SELECT * FROM tickets WHERE user_id=? ORDER BY created_at DESC", (user_id,)
    )
    rows = await cur.fetchall()
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in rows]


async def open_tickets() -> list[dict]:
    cur = await db().execute("SELECT * FROM tickets WHERE status='open' ORDER BY created_at ASC")
    rows = await cur.fetchall()
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in rows]


async def ticket_messages(ticket_id: int) -> list[dict]:
    cur = await db().execute(
        "SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY created_at ASC", (ticket_id,)
    )
    rows = await cur.fetchall()
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in rows]


async def close_ticket(ticket_id: int):
    await db().execute("UPDATE tickets SET status='closed' WHERE id=?", (ticket_id,))
    await db().commit()


# ---------- promo codes ----------

async def create_promo(code: str, bonus_rub: float, max_uses: int):
    await db().execute(
        "INSERT INTO promo_codes (code, bonus_rub, max_uses, used_count, active) VALUES (?, ?, ?, 0, 1) "
        "ON CONFLICT(code) DO UPDATE SET bonus_rub=excluded.bonus_rub, max_uses=excluded.max_uses, active=1",
        (code, bonus_rub, max_uses),
    )
    await db().commit()


async def get_promo(code: str) -> dict | None:
    cur = await db().execute("SELECT * FROM promo_codes WHERE code=?", (code,))
    row = await cur.fetchone()
    if not row:
        return None
    return dict(zip([c[0] for c in cur.description], row))


async def redeem_promo(code: str, user_id: int) -> tuple[bool, str]:
    promo = await get_promo(code)
    if not promo or not promo["active"]:
        return False, "Промокод не найден или неактивен."
    if promo["used_count"] >= promo["max_uses"]:
        return False, "Лимит активаций промокода исчерпан."
    cur = await db().execute(
        "SELECT 1 FROM promo_redemptions WHERE code=? AND user_id=?", (code, user_id)
    )
    if await cur.fetchone():
        return False, "Вы уже активировали этот промокод."
    await db().execute("INSERT INTO promo_redemptions (code, user_id) VALUES (?, ?)", (code, user_id))
    await db().execute("UPDATE promo_codes SET used_count = used_count + 1 WHERE code=?", (code,))
    await add_balance(user_id, promo["bonus_rub"])
    await db().commit()
    return True, f"Промокод активирован! Начислено {promo['bonus_rub']:.0f} ₽ на баланс."


# ---------- settings (напр. ключ ForgetAPI, если хотим менять его прямо из бота) ----------

async def set_setting(key: str, value: str):
    await db().execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    await db().commit()


async def get_setting(key: str, default: str | None = None) -> str | None:
    cur = await db().execute("SELECT value FROM settings WHERE key=?", (key,))
    row = await cur.fetchone()
    return row[0] if row else default
