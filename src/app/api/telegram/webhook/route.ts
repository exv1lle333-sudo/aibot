import { after } from "next/server";
import { getBot } from "@/lib/bot";
import { cfg } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * Вебхук Telegram. Отвечаем 200 сразу, а апдейт обрабатываем после ответа —
 * иначе на долгих ответах модели Telegram решит, что вебхук упал, и начнёт слать дубли.
 */
export async function POST(req: Request) {
  if (cfg.webhookSecret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (got !== cfg.webhookSecret) return new Response("forbidden", { status: 403 });
  }
  if (!cfg.botToken) return new Response("BOT_TOKEN not set", { status: 500 });
  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const bot = getBot();
  if (!bot.isInited()) await bot.init();
  after(async () => {
    try {
      await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]);
    } catch (e) {
      console.error("handleUpdate failed", e);
    }
  });
  return Response.json({ ok: true });
}

export async function GET() {
  return Response.json({ ok: true, hint: "Telegram webhook endpoint. Настройка: GET /api/telegram/setup?key=<TELEGRAM_WEBHOOK_SECRET>" });
}
