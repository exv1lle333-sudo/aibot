import { requireUser, jsonError } from "@/lib/miniapp-auth";
import * as repo from "@/lib/repo";
import { openTicket, replyTicketAsUser } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const list = await repo.userTickets(user.userId);
    const withMessages = await Promise.all(
      list.map(async (t) => ({ id: t.id, status: t.status, createdAt: t.createdAt, messages: await repo.getTicketMessages(t.id) })),
    );
    return Response.json({ tickets: withMessages });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as { text?: string; ticketId?: number };
    const text = String(body.text ?? "").trim().slice(0, 4000);
    if (!text) return Response.json({ error: "Пустое сообщение" }, { status: 400 });
    if (body.ticketId) {
      const ok = await replyTicketAsUser(user.userId, Number(body.ticketId), text);
      return Response.json({ ok }, { status: ok ? 200 : 400 });
    }
    const id = await openTicket(user.userId, text);
    return Response.json({ ok: true, id });
  } catch (e) {
    return jsonError(e);
  }
}
