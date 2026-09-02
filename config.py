"""
Конфигурация бота. Всё берётся из переменных окружения (.env).
Скопируйте .env.example в .env и заполните значения.
"""
import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    val = os.getenv(name)
    return int(val) if val not in (None, "") else default


def _list_int(name: str) -> list[int]:
    val = os.getenv(name, "")
    return [int(x) for x in val.split(",") if x.strip()]


@dataclass
class Config:
    # --- Telegram ---
    bot_token: str = os.getenv("BOT_TOKEN", "")
    admin_ids: list[int] = field(default_factory=lambda: _list_int("ADMIN_IDS"))
    support_username: str = os.getenv("SUPPORT_USERNAME", "@support")
    channel_url: str = os.getenv("CHANNEL_URL", "https://t.me/your_channel")

    # --- ForgetAPI (единый OpenAI-совместимый ключ и эндпоинт на ВСЕ модели сразу) ---
    forgetapi_key: str = os.getenv("FORGETAPI_KEY", "")
    forgetapi_base_url: str = os.getenv("FORGETAPI_BASE_URL", "https://api.forgetapi.ru/v1")

    # --- Platega ---
    platega_merchant_id: str = os.getenv("PLATEGA_MERCHANT_ID", "")
    platega_secret: str = os.getenv("PLATEGA_SECRET", "")
    platega_base_url: str = os.getenv("PLATEGA_BASE_URL", "https://app.platega.io")
    platega_api_version: str = os.getenv("PLATEGA_API_VERSION", "v1")  # v1 or v2
    platega_active_methods: list[int] = field(default_factory=lambda: _list_int("PLATEGA_ACTIVE_METHODS") or [2, 10, 11, 13])
    platega_return_url: str = os.getenv("PLATEGA_RETURN_URL", "")
    platega_failed_url: str = os.getenv("PLATEGA_FAILED_URL", "")

    # --- Webhook server (принимает колбэк от Platega) ---
    webhook_host: str = os.getenv("WEBHOOK_HOST", "0.0.0.0")
    webhook_port: int = _int("WEBHOOK_PORT", 8080)
    webhook_path: str = os.getenv("PLATEGA_WEBHOOK_PATH", "/platega-webhook")
    public_base_url: str = os.getenv("PUBLIC_BASE_URL", "")  # напр. https://hooks.example.com

    # --- Telegram Mini App (веб-версия меню бота) ---
    # Полный публичный адрес мини-аппа, например https://exvl.ru/app/ — именно его нужно
    # прописать в @BotFather (Bot Settings -> Menu Button, или /newapp) и сюда же смотрит
    # кнопка "🖥 Мини-апп" в главном меню бота. ОБЯЗАТЕЛЬНО https (Telegram другого не примет).
    miniapp_url: str = os.getenv("MINIAPP_URL", "")
    # Путь на диске к статике мини-аппа (index.html/app.js/style.css) — раздаётся тем же
    # aiohttp-сервером, что и вебхук Platega, на префиксе /app/.
    miniapp_static_dir: str = os.getenv("MINIAPP_STATIC_DIR", "./webapp_static")

    # --- Бизнес-правила ---
    min_topup_rub: int = _int("MIN_TOPUP_RUB", 50)
    referral_free_requests: int = _int("REFERRAL_FREE_REQUESTS", 7)
    referral_commission_percent: float = float(os.getenv("REFERRAL_COMMISSION_PERCENT", "5"))
    signup_bonus_tokens: int = _int("SIGNUP_BONUS_TOKENS", 5000)  # бонус выдаётся на Gemini 3.1 Flash Lite
    db_path: str = os.getenv("DB_PATH", "./bot.db")

    user_agreement_url: str = os.getenv("USER_AGREEMENT_URL", "")
    privacy_policy_url: str = os.getenv("PRIVACY_POLICY_URL", "")

    # --- Распознавание голосовых (бесплатно, локально — см. voice.py) ---
    whisper_model_size: str = os.getenv("WHISPER_MODEL_SIZE", "small")
    whisper_device: str = os.getenv("WHISPER_DEVICE", "cpu")
    whisper_compute_type: str = os.getenv("WHISPER_COMPUTE_TYPE", "int8")


cfg = Config()
