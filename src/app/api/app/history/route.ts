import { requireUser, jsonError } from "@/lib/miniapp-auth";
import * as repo from "@/lib/repo";
import { MODELS } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const [txs, purchases] = await Promise.all([repo.userTransactions(user.userId, 20), repo.userPurchases(user.userId, 20)]);
    return Response.json({
      transactions: txs.map((t) => ({ id: t.id, amountRub: t.amountRub, status: t.status, createdAt: t.createdAt, paymentUrl: t.status === "pending" ? t.paymentUrl : null })),
      purchases: purchases.map((p) => ({ id: p.id, modelKey: p.modelKey, title: MODELS[p.modelKey]?.title ?? p.modelKey, tokens: p.tokens, priceRub: p.priceRub, createdAt: p.createdAt })),
    });
  } catch (e) {
    return jsonError(e);
  }
}
