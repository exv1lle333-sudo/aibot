# -*- coding: utf-8 -*-
import asyncio
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand, MenuButtonWebApp, MenuButtonDefault, WebAppInfo

from database import db
from config import cfg
import pricing
from handlers import user as user_handlers
from handlers import admin as admin_handlers
from webhook import run_webhook_server

# Логи теперь пишутся не только в консоль, но и в файл bot.log рядом с bot.py — так их можно
# посмотреть и после того, как окно консоли/сессии закрылось (раньше логи были видны только
# "здесь и сейчас" в терминале, где запущен бот). RotatingFileHandler сам режет файл на части
# по 5 МБ и хранит 3 последних, чтобы bot.log не рос бесконечно.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        RotatingFileHandler("bot.log", maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# Меню команд рядом с полем ввода в Telegram. Специально держим его коротким:
# "Поддержка" и "Админ-панель" сюда не выносим — они уже есть отдельными кнопками
# в главном меню снизу экрана (и для админ-панели, и для тикетов поддержки),
# а /admin по-прежнему работает, если его набрать вручную.
BOT_COMMANDS = [
    BotCommand(command="start", description="Главное меню"),
    BotCommand(command="new_chat", description="Очистить историю диалога с ИИ"),
]

# ---------------------------------------------------------------------------
# Защита от повторного запуска. Без неё, если бота случайно запустить второй раз
# на этой же машине (например, забыли проверить, что предыдущий процесс ещё жив,
# при деплое через nohup/screen) — оба процесса начинают одновременно опрашивать
# Telegram (getUpdates) с одним и тем же BOT_TOKEN и параллельно писать в одну и
# ту же SQLite-базу. Внешне это выглядит как "бот глючит": сообщения дублируются,
# часть ответов теряется, а в логах — ничего явного, что объяснило бы причину.
# Держим файловый лок (fcntl.flock) рядом с bot.py: второй процесс сразу видит,
# что лок занят, и завершается с понятным сообщением вместо того, чтобы тихо
# конфликтовать с первым.
# ---------------------------------------------------------------------------
_LOCK_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.lock")
_lock_file_handle = None  # держим файл открытым на всё время жизни процесса — иначе лок снимется


def _acquire_single_instance_lock() -> None:
    global _lock_file_handle
    _lock_file_handle = open(_LOCK_FILE_PATH, "w")
    try:
        import fcntl
    except ImportError:
        # fcntl есть только на POSIX (Linux/macOS), на которых и живёт боевой сервер (см.
        # README.md/DEPLOY_MINIAPP.md — деплой через venv+nginx на Linux). Если кто-то всё же
        # запускает бота локально на Windows для разработки — не роняем его из-за отсутствия
        # fcntl, просто пропускаем проверку с предупреждением в лог.
        log.warning("Защита от повторного запуска недоступна на этой ОС (нет модуля fcntl) — пропускаем.")
        return
    try:
        fcntl.flock(_lock_file_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.error(
            "❌ Бот уже запущен другим процессом (лок-файл %s занят) — второй экземпляр НЕ "
            "поднимаем, иначе оба процесса начнут одновременно опрашивать Telegram и писать в "
            "одну базу. Если ты точно знаешь, что старый процесс уже не работает (например, он "
            "упал аварийно и не снял лок) — останови все процессы бота (`pkill -f bot.py`) и "
            "попробуй запустить снова.",
            _LOCK_FILE_PATH,
        )
        sys.exit(1)
    _lock_file_handle.seek(0)
    _lock_file_handle.truncate()
    _lock_file_handle.write(str(os.getpid()))
    _lock_file_handle.flush()


async def main():
    if not cfg.bot_token:
        raise RuntimeError("BOT_TOKEN не задан в .env")

    _acquire_single_instance_lock()

    placeholder_models = pricing.has_placeholder_prices()
    if placeholder_models:
        log.warning(
            "⚠️⚠️⚠️ У этих моделей ВРЕМЕННАЯ (завышенная) цена в pricing.py, реальные цены "
            "с ForgetAPI ещё не вставлены: %s — открой pricing.py и замени PLACEHOLDER_COST "
            "на настоящий cost_rub_per_1m у каждой из них!",
            ", ".join(placeholder_models),
        )

    await db.init_db()

    bot = Bot(token=cfg.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher(storage=MemoryStorage())

    await bot.set_my_commands(BOT_COMMANDS)

    # Синяя кнопка слева от поля ввода в Telegram: открывает мини-апп в один тап.
    # Требует https в MINIAPP_URL — иначе Telegram откажется её показать, и мы
    # оставляем обычную кнопку меню, чтобы бот не падал из-за незаполненного .env.
    if cfg.miniapp_url:
        try:
            await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Мини-апп", web_app=WebAppInfo(url=cfg.miniapp_url)))
        except Exception:
            log.exception("failed to set webapp menu button (проверь, что MINIAPP_URL начинается с https://)")
    else:
        await bot.set_chat_menu_button(menu_button=MenuButtonDefault())

    # порядок важен: admin раньше user, чтобы /admin и колбэки admin:* обрабатывались в первую очередь
    dp.include_router(admin_handlers.router)
    dp.include_router(user_handlers.router)

    # Веб-сервер (Platega webhook + мини-апп) запускаем ДО polling и не через asyncio.gather —
    # run_webhook_server() всего лишь поднимает aiohttp-сайт (site.start()) и сразу возвращается,
    # дальше сервер сам живёт в фоне на этом же event loop. Если он не поднимется (например, порт
    # уже занят не до конца остановленным предыдущим запуском бота — частая ситуация при deploy
    # через nohup/screen), ловим ошибку здесь и НЕ роняем весь процесс: раньше это делалось через
    # asyncio.gather(run_webhook_server(...), dp.start_polling(...)), и падение веб-сервера обрывало
    # заодно и polling — бот переставал отвечать в Telegram целиком из-за проблемы с портом,
    # которая вообще-то никак не должна мешать боту принимать сообщения.
    try:
        await run_webhook_server(bot)
    except OSError as e:
        log.error(
            "❌ Не удалось запустить веб-сервер (Platega webhook + мини-апп) на %s:%s — %s. "
            "Похоже, порт уже занят другим процессом — например, не был до конца остановлен "
            "предыдущий запуск бота. Останови все процессы на этом порту (например: "
            "`fuser -k %s/tcp` или `pkill -f bot.py`) и перезапусти бота. Сейчас бот всё равно "
            "продолжит принимать сообщения в Telegram (long polling), но приём оплат через "
            "Platega webhook и мини-апп будут недоступны, пока порт не освободится.",
            cfg.webhook_host, cfg.webhook_port, e, cfg.webhook_port,
        )
    except Exception:
        log.exception("❌ Веб-сервер (webhook/мини-апп) не запустился по неожиданной причине")

    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
