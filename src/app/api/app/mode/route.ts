import { requireUser, jsonError } from "@/lib/miniapp-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as { chatMode?: string; activeModel?: string | null };
    if (body.chatMode === "normal" || body.chatMode === "economy") await repo.setChatMode(user.userId, body.chatMode);
    if (body.activeModel !== undefined) await repo.setActiveModel(user.userId, body.activeModel);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
