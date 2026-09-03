import { requireAdmin, jsonError } from "@/lib/miniapp-auth";
import * as repo from "@/lib/repo";
import * as svc from "@/lib/services";
import { MODELS } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

async function resolveUser(q: string) {
  const s = q.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return repo.getUser(Number(s));
  return repo.findUserByUsername(s);
}

async function fullUser(u: NonNullable<Awaited<ReturnType<typeof repo.getUser>>>) {
  const wallets = await repo.getAllWallets(u.userId);
  return {
    ...u,
    wallets: Object.entries(wallets)
      .filter(([k, v]) => MODELS[k] && v > 0)
      .map(([k, v]) => ({ modelKey: k, title: MODELS[k].title, remaining: Math.floor(v) })),
    referrals: await repo.referralCount(u.userId),
  };
}

/** GET /api/app/admin?section=stats|users|payments|tickets|promos|user&q= */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const section = url.searchParams.get("section") ?? "stats";
    switch (section) {
      case "stats":
        return Response.json(await svc.adminStats());
      case "users":
        return Response.json({ total: await repo.userCount(), users: await repo.recentUsers(50) });
      case "user": {
        const u = await resolveUser(url.searchParams.get("q") ?? "");
        if (!u) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
        return Response.json({ user: await fullUser(u) });
      }
      case "payments":
        return Response.json({ transactions: await repo.recentTransactions(50) });
      case "tickets": {
        const list = await repo.openTickets();
        const full = await Promise.all(list.map(async (t) => ({ ...t, messages: await repo.getTicketMessages(t.id), user: await repo.getUser(t.userId) })));
        return Response.json({ tickets: full });
      }
      case "promos":
        return Response.json({ promos: await repo.listPromos() });
      case "apikey": {
        const k = await repo.getSetting("forgetapi_key");
        return Response.json({ fromDb: Boolean(k), tail: k ? k.slice(-4) : null });
      }
      default:
        return Response.json({ error: "unknown section" }, { status: 400 });
    }
  } catch (e) {
    return jsonError(e);
  }
}

/** POST — действия админа */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    switch (action) {
      case "give_balance": {
        const u = await resolveUser(String(body.user ?? ""));
        const amount = Number(body.amount);
        if (!u) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
        if (!Number.isFinite(amount) || amount === 0) return Response.json({ error: "Неверная сумма" }, { status: 400 });
        await repo.addBalance(u.userId, amount);
        void svc.sendTelegramMessage(u.userId, amount > 0 ? `🎁 Администратор начислил тебе <b>${svc.fmtRub(amount)}</b> на баланс.` : `ℹ️ С твоего баланса списано ${svc.fmtRub(-amount)} администратором.`);
        return Response.json({ ok: true, user: await fullUser((await repo.getUser(u.userId))!) });
      }
      case "give_tokens": {
        const u = await resolveUser(String(body.user ?? ""));
        const modelKey = String(body.modelKey ?? "");
        const tokens = Number(body.tokens);
        if (!u) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
        if (!MODELS[modelKey] || !Number.isFinite(tokens) || tokens <= 0) return Response.json({ error: "Неверные данные" }, { status: 400 });
        await repo.addWallet(u.userId, modelKey, tokens);
        void svc.sendTelegramMessage(u.userId, `🎁 Администратор начислил тебе <b>${svc.fmtNum(tokens)}</b> токенов «${MODELS[modelKey].title}».`);
        return Response.json({ ok: true, user: await fullUser((await repo.getUser(u.userId))!) });
      }
      case "ban": {
        const u = await resolveUser(String(body.user ?? ""));
        if (!u) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
        if (u.userId === admin.userId) return Response.json({ error: "Себя банить нельзя" }, { status: 400 });
        const banned = body.banned !== undefined ? Boolean(body.banned) : !u.banned;
        await repo.setBanned(u.userId, banned);
        return Response.json({ ok: true, banned, user: await fullUser((await repo.getUser(u.userId))!) });
      }
      case "message": {
        const u = await resolveUser(String(body.user ?? ""));
        const text = String(body.text ?? "").trim();
        if (!u) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
        if (!text) return Response.json({ error: "Пустой текст" }, { status: 400 });
        const ok = await svc.sendTelegramMessage(u.userId, text);
        return Response.json({ ok });
      }
      case "broadcast": {
        const text = String(body.text ?? "").trim();
        if (!text) return Response.json({ error: "Пустой текст" }, { status: 400 });
        return Response.json({ ok: true, ...(await svc.broadcast(text)) });
      }
      case "ticket_reply": {
        const ok = await svc.replyTicketAsAdmin(Number(body.ticketId), String(body.text ?? "").trim());
        return Response.json({ ok });
      }
      case "ticket_close": {
        const ok = await svc.closeTicketByAdmin(Number(body.ticketId));
        return Response.json({ ok });
      }
      case "promo_create": {
        const code = String(body.code ?? "").trim().toUpperCase();
        const bonus = Number(body.bonusRub);
        const max = Number(body.maxUses);
        if (!code || !(bonus > 0) || !(max > 0)) return Response.json({ error: "Неверные данные" }, { status: 400 });
        await repo.createPromo(code, bonus, Math.floor(max));
        return Response.json({ ok: true, promos: await repo.listPromos() });
      }
      case "promo_off": {
        await repo.deactivatePromo(String(body.code ?? "").toUpperCase());
        return Response.json({ ok: true, promos: await repo.listPromos() });
      }
      case "set_apikey": {
        const key = String(body.key ?? "").trim();
        if (!key) return Response.json({ error: "Пустой ключ" }, { status: 400 });
        await repo.setSetting("forgetapi_key", key);
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return jsonError(e);
  }
}
