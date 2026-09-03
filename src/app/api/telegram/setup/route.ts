import { setupWebhook } from "@/lib/bot";
import { cfg } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Регистрирует вебхук в Telegram. Защищено ключом: ?key=<TELEGRAM_WEBHOOK_SECRET>. */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!cfg.webhookSecret || key !== cfg.webhookSecret) {
    return Response.json({ ok: false, error: "Укажи ?key=<TELEGRAM_WEBHOOK_SECRET> (и задай эту переменную в .env)" }, { status: 403 });
  }
  const res = await setupWebhook();
  return Response.json(res, { status: res.ok ? 200 : 500 });
}
