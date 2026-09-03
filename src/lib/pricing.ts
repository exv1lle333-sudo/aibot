/**
 * Прайсинг моделей. Закупочные цены — из прайса ForgetAPI (₽ за 1М токенов, среднее ввод/вывод).
 * Цена продажи = себестоимость × MARKUP. Меняешь только cost_rub_per_1m — всё пересчитается.
 */
export const MARKUP = 1.5;

export type ModelKind = "text" | "image";

export interface ModelInfo {
  key: string;
  apiModel: string;
  title: string;
  provider: string;
  kind: ModelKind;
  category: string;
  description: string;
  short: string;
  costRubPer1m: number;
  supportsFiles: boolean;
  referralEligible: boolean;
  maxTokensPerGeneration: number;
  emoji: string;
}

export const CATEGORY_TITLES: Record<string, string> = {
  image: "🖼 Генерация изображений",
  claude: "🧠 Claude (Anthropic)",
  gemini: "✨ Gemini (Google)",
  gpt: "🤖 GPT (OpenAI)",
};
export const CATEGORY_ORDER = ["image", "claude", "gemini", "gpt"];

function m(p: Omit<ModelInfo, "supportsFiles" | "referralEligible" | "maxTokensPerGeneration"> &
  Partial<Pick<ModelInfo, "supportsFiles" | "referralEligible" | "maxTokensPerGeneration">>): ModelInfo {
  return { supportsFiles: true, referralEligible: false, maxTokensPerGeneration: 0, ...p };
}

export const MODELS: Record<string, ModelInfo> = {
  "claude-5-opus": m({
    key: "claude-5-opus",
    apiModel: "claude-opus-5",
    title: "Claude 5 Opus",
    provider: "anthropic",
    kind: "text",
    category: "claude",
    emoji: "🧠",
    short: "Самая мощная модель Anthropic",
    description:
      "Самая мощная модель Anthropic. Подходит для сложной аналитики, объёмного кода, юридических и научных текстов — там, где важно качество рассуждений, а не скорость. Понимает фото и файлы.",
    costRubPer1m: (258.09 + 1290.45) / 2,
  }),
  "claude-sonnet-5": m({
    key: "claude-sonnet-5",
    apiModel: "claude-sonnet-5",
    title: "Claude Sonnet 5",
    provider: "anthropic",
    kind: "text",
    category: "claude",
    emoji: "⚡",
    short: "Быстрый и сбалансированный Claude",
    description:
      "Быстрая и сбалансированная модель Anthropic — почти как Opus по качеству, но заметно дешевле и быстрее. Хороша для повседневной работы с кодом и текстами. Понимает фото и файлы.",
    costRubPer1m: (129.05 + 516.18) / 2,
  }),
  "gemini-3.1-pro-preview": m({
    key: "gemini-3.1-pro-preview",
    apiModel: "gemini-3.1-pro-preview",
    title: "Gemini 3.1 Pro",
    provider: "google",
    kind: "text",
    category: "gemini",
    emoji: "💎",
    short: "Флагман Google, большой контекст",
    description:
      "Флагманская модель Google — большой контекст, сильна в анализе документов, коде и рассуждениях. Понимает фото и файлы.",
    costRubPer1m: (98.93 + 602.21) / 2,
  }),
  "gemini-3-flash-preview": m({
    key: "gemini-3-flash-preview",
    apiModel: "gemini-3-flash-preview",
    title: "Gemini 3 Flash",
    provider: "google",
    kind: "text",
    category: "gemini",
    emoji: "✨",
    short: "Баланс скорости и качества",
    description:
      "Быстрая модель Google среднего уровня — хороший баланс скорости и качества для повседневных задач. Понимает фото и файлы.",
    costRubPer1m: (30.11 + 141.95) / 2,
  }),
  "gemini-3.1-flash-lite": m({
    key: "gemini-3.1-flash-lite",
    apiModel: "gemini-3.1-flash-lite",
    title: "Gemini 3.1 Flash Lite",
    provider: "google",
    kind: "text",
    category: "gemini",
    emoji: "🪶",
    short: "Самая быстрая и дешёвая",
    description:
      "Самая быстрая и недорогая модель Google в каталоге — для простых задач и переписки, где важна скорость ответа. Понимает фото и файлы.",
    costRubPer1m: (12.9 + 68.82) / 2,
    referralEligible: true,
  }),
  "gpt-5.6-sol": m({
    key: "gpt-5.6-sol",
    apiModel: "gpt-5.6-sol",
    title: "GPT-5.6 Sol",
    provider: "openai",
    kind: "text",
    category: "gpt",
    emoji: "🤖",
    short: "Старшая модель OpenAI",
    description:
      "Модель OpenAI старшего уровня — хороша для сложных рабочих задач и объёмных текстов. Понимает фото и файлы.",
    costRubPer1m: (223.68 + 1290.45) / 2,
  }),
  "nano-banana-pro": m({
    key: "nano-banana-pro",
    apiModel: "nano-banana-pro",
    title: "Nano Banana Pro",
    provider: "google",
    kind: "image",
    category: "image",
    emoji: "🍌",
    short: "Максимальное качество картинок",
    description: "Генерация изображений (Gemini) старшей версии — самое высокое качество картинок из доступных в боте.",
    costRubPer1m: (5.16 / 2000) * 1_000_000,
    maxTokensPerGeneration: 2000,
  }),
  "nano-banana": m({
    key: "nano-banana",
    apiModel: "nano-banana",
    title: "Nano Banana",
    provider: "google",
    kind: "image",
    category: "image",
    emoji: "🎨",
    short: "Быстро и недорого",
    description:
      "Генерация изображений (Gemini) по текстовому описанию — базовая версия, быстро и недорого. Подходит для иллюстраций, обложек, набросков.",
    costRubPer1m: (1.72 / 1000) * 1_000_000,
    maxTokensPerGeneration: 1000,
  }),
  "nano-banana-2": m({
    key: "nano-banana-2",
    apiModel: "nano-banana-2",
    title: "Nano Banana 2",
    provider: "google",
    kind: "image",
    category: "image",
    emoji: "🖌",
    short: "Второе поколение, золотая середина",
    description:
      "Генерация изображений (Gemini) второго поколения — среднее между обычной Nano Banana и Pro-версией по цене и качеству.",
    costRubPer1m: (3.44 / 1500) * 1_000_000,
    maxTokensPerGeneration: 1500,
  }),
};

export const SIGNUP_BONUS_MODEL = "gemini-3.1-flash-lite";

export const TEXT_PACKAGES = [10_000, 50_000, 100_000, 200_000, 500_000];
export const IMAGE_PACKAGE_MULTIPLIERS = [1, 5, 10, 25, 50];
export const MEGA_PACKAGE_TOKENS = 1_000_000;

/** Минимальный остаток токенов, с которым разрешаем текстовый запрос.
 *  Раньше при 1 токене на счету можно было получить ответ на 10 000 токенов «бесплатно». */
export const MIN_TOKENS_FOR_TEXT_REQUEST = 1000;

export function sellRubPer1m(model: ModelInfo): number {
  return Math.round(model.costRubPer1m * MARKUP * 100) / 100;
}

export function packagePrice(modelKey: string, amount: number): number {
  const model = MODELS[modelKey];
  if (!model) throw new Error("unknown model");
  return Math.max(1, Math.round((sellRubPer1m(model) * amount) / 1_000_000));
}

export function listPackages(modelKey: string): { tokens: number; price: number }[] {
  const model = MODELS[modelKey];
  if (!model) return [];
  const amounts = model.kind === "text" ? [...TEXT_PACKAGES] : IMAGE_PACKAGE_MULTIPLIERS.map((n) => n * model.maxTokensPerGeneration);
  if (!amounts.includes(MEGA_PACKAGE_TOKENS)) amounts.push(MEGA_PACKAGE_TOKENS);
  return amounts.map((tokens) => ({ tokens, price: packagePrice(modelKey, tokens) }));
}

export function isValidPackage(modelKey: string, amount: number): boolean {
  return listPackages(modelKey).some((p) => p.tokens === amount);
}

export function categoriesWithModels(): string[] {
  const present = new Set(Object.values(MODELS).map((x) => x.category));
  return CATEGORY_ORDER.filter((c) => present.has(c));
}

export function modelsInCategory(category: string): ModelInfo[] {
  return Object.values(MODELS).filter((x) => x.category === category);
}

/** Публичное описание модели для мини-аппа (без внутренних полей). */
export function publicModel(model: ModelInfo) {
  return {
    key: model.key,
    title: model.title,
    provider: model.provider,
    kind: model.kind,
    category: model.category,
    categoryTitle: CATEGORY_TITLES[model.category] ?? model.category,
    description: model.description,
    short: model.short,
    emoji: model.emoji,
    sellRubPer1m: sellRubPer1m(model),
    maxTokensPerGeneration: model.maxTokensPerGeneration,
    pricePerGeneration: model.kind === "image" ? packagePrice(model.key, model.maxTokensPerGeneration) : null,
    supportsFiles: model.supportsFiles,
    referralEligible: model.referralEligible,
    packages: listPackages(model.key),
  };
}
