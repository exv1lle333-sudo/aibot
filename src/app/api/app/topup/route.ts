import { requireUser, jsonError } from "@/lib/miniapp-auth";
import { createTopup, reconcilePending } from "@/lib/services";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as { amount?: number };
    const res = await createTopup(user.userId, Number(body.amount ?? 0));
    if (!res.ok) return Response.json(res, { status: 400 });
    return Response.json(res);
  } catch (e) {
    return jsonError(e);
  }
}

/** Проверка: не появились ли оплаченные транзакции (кнопка «Проверить оплату»). */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const credited = await reconcilePending(user.userId);
    const fresh = await repo.getUser(user.userId);
    return Response.json({ credited, balanceRub: fresh?.balanceRub ?? 0 });
  } catch (e) {
    return jsonError(e);
  }
}
