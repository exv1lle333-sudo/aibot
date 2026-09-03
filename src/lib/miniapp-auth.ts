import { createHmac } from "crypto";
import { cfg, isAdmin } from "./config";
import * as repo from "./repo";
import type { User } from "@/db/schema";

export interface TgInitUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/** Проверяем подпись initData из Telegram WebApp (HMAC-SHA256 с ключом "WebAppData"). */
export function validateInitData(initData: string, maxAgeSec = 60 * 60 * 24): { ok: true; user: TgInitUser; startParam?: string } | { ok: false; error: string } {
  if (!initData) return { ok: false, error: "no initData" };
  if (!cfg.botToken) return { ok: false, error: "BOT_TOKEN не задан" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "no hash" };
  params.delete("hash");
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(cfg.botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (computed !== hash) return { ok: false, error: "bad signature" };
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return { ok: false, error: "initData expired" };
  try {
    const user = JSON.parse(params.get("user") ?? "{}") as TgInitUser;
    if (!user.id) return { ok: false, error: "no user" };
    return { ok: true, user, startParam: params.get("start_param") ?? undefined };
  } catch {
    return { ok: false, error: "bad user json" };
  }
}

export class AuthError extends Error {
  status: number;
  constructor(msg: string, status = 401) {
    super(msg);
    this.status = status;
  }
}

const DEMO_USER: TgInitUser = { id: 1, first_name: "Демо", username: "demo" };

/** Достаём и проверяем пользователя из заголовка Authorization: tma <initData>. */
export async function requireUser(req: Request): Promise<User> {
  const header = req.headers.get("authorization") ?? "";
  const initData = header.startsWith("tma ") ? header.slice(4) : "";
  let tgUser: TgInitUser;
  let startParam: string | undefined;
  if (initData) {
    const v = validateInitData(initData);
    if (!v.ok) throw new AuthError(`Неверная подпись Telegram: ${v.error}`);
    tgUser = v.user;
    startParam = v.startParam;
  } else if (cfg.miniappDemo) {
    tgUser = DEMO_USER;
  } else {
    throw new AuthError("Открой приложение через Telegram");
  }
  let refBy: number | null = null;
  if (startParam && /^ref\d+$/.test(startParam)) refBy = Number(startParam.slice(3));
  const { user } = await repo.getOrCreateUser(tgUser.id, tgUser.username, tgUser.first_name, refBy);
  if (user.banned && !isAdmin(user.userId)) throw new AuthError("Доступ ограничен", 403);
  return user;
}

export async function requireAdmin(req: Request): Promise<User> {
  const user = await requireUser(req);
  if (!isAdmin(user.userId)) throw new AuthError("Только для администратора", 403);
  return user;
}

export function jsonError(e: unknown): Response {
  if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: e instanceof Error ? e.message : "Внутренняя ошибка" }, { status: 500 });
}
