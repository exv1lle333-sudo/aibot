"""
Прайсинг моделей.

Закупочные цены (₽ за 1 000 000 токенов) — из прайса ForgetAPI (forgetapi.ru).
Для текстовых моделей себестоимость = среднее (ввод, вывод) за 1М токенов.
Для картиночных моделей (nano-banana*, seedream*) себестоимость считается по цене
"за изображение", пересчитанной в токены через max_tokens_per_generation — так генерация
картинок продаётся как обычные токены, а не отдельными "генерациями".
Цена продажи = себестоимость * MARKUP.

MARKUP = 1.5 — цена продажи на 50% выше закупочной (себестоимости).

Цены ниже — реальные, с прайса ForgetAPI (скрин от 29.08.2026): вход/выход за 1М токенов
для текстовых моделей, "за изображение" (пересчитано в токены через
max_tokens_per_generation) для nano-banana*/seedream*. Если ForgetAPI поменяет тарифы —
просто поправь cost_rub_per_1m у нужной модели, продажная цена пересчитается сама.

DeepSeek намеренно исключён из каталога (модели DeepSeek V4 Pro/Flash больше не продаются).
"""
from dataclasses import dataclass

MARKUP = 1.5  # цена продажи = себестоимость * 1.5, т.е. +50% к цене ForgetAPI

PLACEHOLDER_COST = 999_999  # аварийная заглушка на случай, если в будущем добавят новую
# модель и забудут проставить cost_rub_per_1m — see has_placeholder_prices() в bot.py


@dataclass
class ModelInfo:
    key: str                 # внутренний ключ
    api_model: str            # id модели, который отправляется в ForgetAPI
    title: str                # человекочитаемое имя
    provider: str              # anthropic / openai / google / ... — только для отображения,
                                # сам запрос всегда идёт через единый эндпоинт ForgetAPI
    kind: str                  # "text" или "image" — обе продаются в токенах, отличается только то,
                                # что генерация картинки списывает max_tokens_per_generation за раз
    category: str              # ключ категории для группировки в меню (см. CATEGORY_TITLES)
    description: str           # краткое описание для карточки покупки
    cost_rub_per_1m: float = 0.0        # себестоимость за 1M токенов (для картиночных — расчётная)
    supports_files: bool = False        # можно ли слать этой модели фото/файлы (vision/документы)
    referral_eligible: bool = False     # действуют ли реферальные бесплатные запросы на эту модель
    # для kind="image": сколько токенов максимум тратится на одну генерацию (по самому "дорогому"
    # доступному разрешению) — с пользователя списывается именно это количество за каждую картинку,
    # и минимальный покупаемый пакет токенов не может быть меньше этого числа.
    max_tokens_per_generation: int = 0

    @property
    def sell_rub_per_1m(self) -> float:
        return round(self.cost_rub_per_1m * MARKUP, 2)


# ---------------- категории (группировка в меню "🤖 Модели") ----------------

CATEGORY_TITLES: dict[str, str] = {
    "image": "🖼 Генерация изображений",
    "claude": "🧠 Claude (Anthropic)",
    "gemini": "✨ Gemini (Google)",
    "gpt": "🤖 GPT (OpenAI)",
}
# Порядок категорий в меню
CATEGORY_ORDER = ["image", "claude", "gemini", "gpt"]


MODELS: dict[str, ModelInfo] = {
    # ---------------- Claude (Anthropic) ----------------
    "claude-5-opus": ModelInfo(
        key="claude-5-opus",
        api_model="claude-opus-5",
        title="Claude 5 Opus",
        provider="anthropic",
        kind="text",
        category="claude",
        description=(
            "Самая мощная модель Anthropic. Подходит для сложной аналитики, "
            "объёмного кода, юридических и научных текстов — там, где важно "
            "качество рассуждений, а не скорость. Понимает фото и файлы.\n\n"
            "⚠️ Возможны технические неполадки: эта модель периодически отдаёт ошибки — "
            "иногда часть запросов может не проходить. Если это критично, "
            "попробуйте Claude Sonnet 5 или Gemini 3.1 Pro."
        ),
        cost_rub_per_1m=(258.09 + 1290.45) / 2,  # ForgetAPI: вход 258.09₽ / выход 1290.45₽ за 1М
        supports_files=True,
    ),
    "claude-sonnet-5": ModelInfo(
        key="claude-sonnet-5",
        api_model="claude-sonnet-5",
        title="Claude Sonnet 5",
        provider="anthropic",
        kind="text",
        category="claude",
        description=(
            "Быстрая и сбалансированная модель Anthropic — почти как Opus по качеству, "
            "но заметно дешевле и быстрее. Хороша для повседневной работы с кодом и текстами. "
            "Понимает фото и файлы."
        ),
        cost_rub_per_1m=(129.05 + 516.18) / 2,  # ForgetAPI: вход 129.05₽ / выход 516.18₽ за 1М
        supports_files=True,
    ),

    # ---------------- Gemini (Google) ----------------
    "gemini-3.1-pro-preview": ModelInfo(
        key="gemini-3.1-pro-preview",
        api_model="gemini-3.1-pro-preview",
        title="Gemini 3.1 Pro Preview",
        provider="google",
        kind="text",
        category="gemini",
        description=(
            "Флагманская модель Google — большой контекст, сильна в анализе документов, "
            "коде и рассуждениях. Понимает фото и файлы."
        ),
        cost_rub_per_1m=(98.93 + 602.21) / 2,  # ForgetAPI: вход 98.93₽ / выход 602.21₽ за 1М
        supports_files=True,
    ),
    "gemini-3-flash-preview": ModelInfo(
        key="gemini-3-flash-preview",
        api_model="gemini-3-flash-preview",
        title="Gemini 3 Flash Preview",
        provider="google",
        kind="text",
        category="gemini",
        description=(
            "Быстрая модель Google среднего уровня — хороший баланс скорости и качества "
            "для повседневных задач. Понимает фото и файлы."
        ),
        cost_rub_per_1m=(30.11 + 141.95) / 2,  # ForgetAPI: вход 30.11₽ / выход 141.95₽ за 1М
        supports_files=True,
    ),
    "gemini-3.1-flash-lite": ModelInfo(
        key="gemini-3.1-flash-lite",
        api_model="gemini-3.1-flash-lite",
        title="Gemini 3.1 Flash Lite",
        provider="google",
        kind="text",
        category="gemini",
        description=(
            "Самая быстрая и недорогая модель Google в каталоге — для простых задач "
            "и переписки, где важна скорость ответа. Понимает фото и файлы."
        ),
        cost_rub_per_1m=(12.90 + 68.82) / 2,  # ForgetAPI: вход 12.90₽ / выход 68.82₽ за 1М
        supports_files=True,
        referral_eligible=True,  # реферальные бесплатные запросы и приветственный бонус — на этой модели
    ),

    # ---------------- GPT (OpenAI) ----------------
    "gpt-5.6-sol": ModelInfo(
        key="gpt-5.6-sol",
        api_model="gpt-5.6-sol",
        title="GPT-5.6 Sol",
        provider="openai",
        kind="text",
        category="gpt",
        description=(
            "Модель OpenAI старшего уровня — быстрее и точнее Luna и Terra, хороша для "
            "сложных рабочих задач и объёмных текстов. Понимает фото и файлы."
        ),
        cost_rub_per_1m=(223.68 + 1290.45) / 2,  # ForgetAPI: вход 223.68₽ / выход 1290.45₽ за 1М
        supports_files=True,
    ),

    # ---------------- генерация изображений ----------------
    "nano-banana-pro": ModelInfo(
        key="nano-banana-pro",
        api_model="nano-banana-pro",
        title="Nano Banana Pro",
        provider="google",
        kind="image",
        category="image",
        description=(
            "Генерация изображений (Gemini) старшей версии — самое высокое качество "
            "картинок из доступных в боте."
        ),
        cost_rub_per_1m=5.16 / 2000 * 1_000_000,  # ForgetAPI: 5.16₽ за изображение
        max_tokens_per_generation=2000,
        supports_files=True,  # принимает фото как референс/описание (image-to-image)
    ),
    "nano-banana": ModelInfo(
        key="nano-banana",
        api_model="nano-banana",
        title="Nano Banana",
        provider="google",
        kind="image",
        category="image",
        description=(
            "Генерация изображений (Gemini) по текстовому описанию — базовая версия, "
            "быстро и недорого. Подходит для иллюстраций, обложек, набросков."
        ),
        cost_rub_per_1m=1.72 / 1000 * 1_000_000,  # ForgetAPI: 1.72₽ за изображение
        max_tokens_per_generation=1000,
        supports_files=True,  # принимает фото как референс/описание (image-to-image)
    ),
    "nano-banana-2": ModelInfo(
        key="nano-banana-2",
        api_model="nano-banana-2",
        title="Nano Banana 2",
        provider="google",
        kind="image",
        category="image",
        description=(
            "Генерация изображений (Gemini) второго поколения — среднее между "
            "обычной Nano Banana и Pro-версией по цене и качеству."
        ),
        cost_rub_per_1m=3.44 / 1500 * 1_000_000,  # ForgetAPI: 3.44₽ за изображение
        max_tokens_per_generation=1500,
        supports_files=True,  # принимает фото как референс/описание (image-to-image)
    ),
}

# Пакеты токенов для текстовых моделей
TEXT_PACKAGES = [10_000, 50_000, 100_000, 200_000, 500_000]

# Пакеты для картиночных моделей задаются как кратные max_tokens_per_generation —
# так минимальный пакет всегда покрывает минимум 1 генерацию в самом дорогом разрешении.
IMAGE_PACKAGE_MULTIPLIERS = [1, 5, 10, 25, 50]

# Отдельный "мега"-пакет ровно на 1 000 000 токенов — доступен для ЛЮБОЙ модели (и текстовой,
# и картиночной) в дополнение к обычной линейке пакетов, по той же формуле цены (себестоимость * MARKUP).
MEGA_PACKAGE_TOKENS = 1_000_000


def package_price(model_key: str, amount: int) -> int:
    """Цена пакета в рублях (округление до целого рубля). Токены — везде одна формула."""
    m = MODELS[model_key]
    price = m.sell_rub_per_1m * amount / 1_000_000
    return max(1, round(price))


def list_packages(model_key: str) -> list[tuple[int, int]]:
    """Возвращает [(кол-во_токенов, цена_в_рублях), ...] для модели."""
    m = MODELS[model_key]
    if m.kind == "text":
        amounts = list(TEXT_PACKAGES)
    else:
        amounts = [n * m.max_tokens_per_generation for n in IMAGE_PACKAGE_MULTIPLIERS]
    if MEGA_PACKAGE_TOKENS not in amounts:
        amounts.append(MEGA_PACKAGE_TOKENS)
    return [(a, package_price(model_key, a)) for a in amounts]


def has_placeholder_prices() -> list[str]:
    """Список моделей, у которых до сих пор стоит временная заглушка цены —
    используется при старте бота, чтобы громко предупредить админа в логах."""
    return [key for key, m in MODELS.items() if m.cost_rub_per_1m == PLACEHOLDER_COST]


def categories_with_models() -> list[str]:
    """Категории, в которых реально есть хотя бы одна модель, в заданном порядке отображения."""
    present = {m.category for m in MODELS.values()}
    return [c for c in CATEGORY_ORDER if c in present]


def models_in_category(category: str) -> list[tuple[str, ModelInfo]]:
    """Модели данной категории в порядке объявления в MODELS."""
    return [(key, m) for key, m in MODELS.items() if m.category == category]
