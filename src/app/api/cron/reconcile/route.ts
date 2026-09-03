import { reconcilePending } from "@/lib/services";
import { cfg } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Сверка зависших платежей. Дёргай по крону раз в пару минут: GET /api/cron/reconcile?key=<TELEGRAM_WEBHOOK_SECRET> */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (cfg.webhookSecret && key !== cfg.webhookSecret) return Response.json({ ok: false }, { status: 403 });
  const credited = await reconcilePending();
  return Response.json({ ok: true, credited });
}
