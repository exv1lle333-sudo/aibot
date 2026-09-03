/**
 * Клиент ForgetAPI (https://forgetapi.ru) — единый OpenAI-совместимый эндпоинт на все модели.
 */
import { cfg } from "./config";
import { getSetting } from "./repo";
import type { ModelInfo } from "./pricing";

export const SYSTEM_PROMPT =
  "Ты — универсальный ИИ-ассистент в Telegram-боте. Отвечай полезно, точно и по делу.\n\n" +
  "Правила:\n" +
  "- Отвечай на языке пользователя (по умолчанию — русский).\n" +
  "- Форматируй ответ для Telegram: используй **жирный**, _курсив_, `код`, списки — без таблиц и заголовков #.\n" +
  "- Код оформляй в блоках ```язык ... ```.\n" +
  "- Любые формулы и численные расчёты оформляй в блоке ``` ... ``` (без указания языка), по одной строке на вычисление.\n" +
  "- НИКОГДА не используй LaTeX (\\[ \\], \\( \\), \\frac{}{}, \\cdot и т.п.) — пиши обычными символами ×, ·, ÷, ², √, ≤, ≥, ≈, π.\n" +
  "- Если не знаешь ответ — так и скажи, не выдумывай факты.\n" +
  "- Будь краток, если пользователь не просил подробный разбор.\n" +
  "- Не упоминай, что работаешь через промежуточный сервис или API.";

export interface Attachment {
  kind: "image" | "document" | "text_file";
  mime_type?: string;
  filename?: string;
  data_b64?: string;
  text?: string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[] | null;
}

const RETRY_STATUSES = new Set([502, 503, 504]);

export class ForgetApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`ForgetAPI ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

export async function getApiKey(): Promise<string> {
  const fromDb = await getSetting("forgetapi_key");
  return fromDb || cfg.forgetapiKey;
}

function requireKey(key: string) {
  if (!key) throw new Error("FORGETAPI_KEY не задан. Укажи его в .env или в Админ-панели → Настройки API.");
}

async function postWithRetry(path: string, init: RequestInit, timeoutMs: number, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(`${cfg.forgetapiBaseUrl}${path}`, { ...init, signal: ctrl.signal });
      if (resp.ok) return resp;
      const body = await resp.text();
      const err = new ForgetApiError(resp.status, body);
      if (!RETRY_STATUSES.has(resp.status) || attempt === attempts) throw err;
      lastErr = err;
    } catch (e) {
      if (e instanceof ForgetApiError) throw e;
      if ((e as Error).name === "AbortError") throw new Error("Таймаут ожидания ответа модели");
      lastErr = e;
      if (attempt === attempts) throw e;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw lastErr;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

function toOpenAiContent(text: string, attachments?: Attachment[] | null): string | ContentBlock[] {
  if (!attachments || attachments.length === 0) return text ?? "";
  const blocks: ContentBlock[] = [];
  if (text) blocks.push({ type: "text", text });
  for (const a of attachments) {
    if (a.kind === "image") {
      blocks.push({ type: "image_url", image_url: { url: `data:${a.mime_type ?? "image/jpeg"};base64,${a.data_b64 ?? ""}` } });
    } else if (a.kind === "document") {
      blocks.push({
        type: "file",
        file: { filename: a.filename || "file", file_data: `data:${a.mime_type ?? "application/octet-stream"};base64,${a.data_b64 ?? ""}` },
      });
    } else if (a.kind === "text_file") {
      blocks.push({ type: "text", text: `[Файл ${a.filename ?? ""}]:\n${a.text ?? ""}` });
    }
  }
  return blocks;
}

export async function chat(model: ModelInfo, history: HistoryMessage[]): Promise<{ text: string; tokens: number }> {
  const key = await getApiKey();
  requireKey(key);
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: toOpenAiContent(h.content ?? "", h.attachments) })),
  ];
  const resp = await postWithRetry(
    "/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.apiModel, messages, max_tokens: 16000 }),
    },
    15 * 60 * 1000,
  );
  const data = (await resp.json()) as {
    choices?: { message?: { content?: string | { type: string; text?: string }[] } }[];
    usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  };
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error(`Неожиданный формат ответа ForgetAPI: ${JSON.stringify(data).slice(0, 300)}`);
  let text = message.content ?? "";
  if (Array.isArray(text)) text = text.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const usage = data.usage ?? {};
  const tokens = usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
  if (!text.trim()) {
    console.error("ForgetAPI: пустой ответ модели", model.apiModel, JSON.stringify(data).slice(0, 1000));
  }
  return { text, tokens };
}

export async function generateImage(
  model: ModelInfo,
  prompt: string,
  ref?: { data: Buffer; mime: string } | null,
): Promise<{ data: Buffer; mime: string }> {
  const key = await getApiKey();
  requireKey(key);
  let resp: Response;
  if (ref) {
    const form = new FormData();
    form.append("model", model.apiModel);
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("response_format", "b64_json");
    const ext = ref.mime.includes("png") ? "png" : "jpg";
    form.append("image", new Blob([new Uint8Array(ref.data)], { type: ref.mime }), `reference.${ext}`);
    resp = await postWithRetry("/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form }, 5 * 60 * 1000);
  } else {
    resp = await postWithRetry(
      "/images/generations",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.apiModel, prompt, n: 1, response_format: "b64_json" }),
      },
      5 * 60 * 1000,
    );
  }
  const data = (await resp.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = data.data?.[0];
  if (!item) throw new Error("ForgetAPI не вернул ни одной картинки");
  if (item.b64_json) return { data: Buffer.from(item.b64_json, "base64"), mime: "image/png" };
  if (item.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error(`Не удалось скачать картинку: ${r.status}`);
    const mime = (r.headers.get("content-type") ?? "image/png").split(";")[0];
    return { data: Buffer.from(await r.arrayBuffer()), mime };
  }
  throw new Error("Неожиданный формат ответа images/generations");
}

/** Распознавание голосовых через OpenAI-совместимый /audio/transcriptions. */
export async function transcribe(audio: Buffer, filename: string, mime: string): Promise<string> {
  const key = await getApiKey();
  requireKey(key);
  const form = new FormData();
  form.append("model", cfg.whisperModel);
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
  const resp = await postWithRetry("/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form }, 120_000);
  const data = (await resp.json()) as { text?: string };
  return (data.text ?? "").trim();
}
