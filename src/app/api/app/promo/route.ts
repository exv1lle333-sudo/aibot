import { requireUser, jsonError } from "@/lib/miniapp-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as { code?: string };
    const code = String(body.code ?? "").trim();
    if (!code) return Response.json({ ok: false, message: "Введи промокод" }, { status: 400 });
    const res = await repo.redeemPromo(code, user.userId);
    return Response.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return jsonError(e);
  }
}
