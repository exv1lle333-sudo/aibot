import { verifyWebhookHeaders, PAID_STATUSES, FAILED_STATUSES } from "@/lib/platega";
import { settlePaidTransaction } from "@/lib/services";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Колбэк Platega о статусе оплаты. Идемпотентен: повторная доставка не задвоит зачисление. */
export async function POST(req: Request) {
  if (!verifyWebhookHeaders(req.headers)) {
    console.warn("Platega webhook: unauthorized", Object.fromEntries(req.headers));
    return Response.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  let data: Record<string, unknown>;
  try {
    data = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const status = String(data.status ?? "").toUpperCase();
  const txId = String(data.id ?? data.merchantTransactionId ?? "");
  if (!txId) return Response.json({ ok: false, error: "missing transaction id" }, { status: 400 });
  const tx = await repo.getTransaction(txId);
  if (!tx) return Response.json({ ok: false, error: "unknown transaction" }, { status: 404 });

  if (FAILED_STATUSES.has(status)) {
    await repo.markTransactionFailed(txId);
  } else if (PAID_STATUSES.has(status)) {
    await settlePaidTransaction(txId);
  }
  return Response.json({ ok: true });
}
