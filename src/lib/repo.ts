import { db } from "@/db";
import { and, desc, eq, gte, sql, count, sum, asc } from "drizzle-orm";
import {
  users,
  wallets,
  transactions,
  purchases,
  dialogs,
  tickets,
  ticketMessages,
  promoCodes,
  promoRedemptions,
  settings,
  userStates,
  type User,
} from "@/db/schema";
import { cfg } from "./config";
import { SIGNUP_BONUS_MODEL } from "./pricing";
import type { Attachment } from "./forgetapi";

export const now = () => Math.floor(Date.now() / 1000);

// ---------------- settings ----------------
export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

// ---------------- users ----------------
export async function getUser(userId: number): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
  return row ?? null;
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${username.replace(/^@/, "").toLowerCase()}`)
    .limit(1);
  return row ?? null;
}

/** Создаёт пользователя (если нового нет). Возвращает {user, isNew}. */
export async function getOrCreateUser(
  userId: number,
  username: string | null | undefined,
  firstName: string | null | undefined,
  refBy?: number | null,
): Promise<{ user: User; isNew: boolean }> {
  const existing = await getUser(userId);
  if (existing) {
    if ((username ?? null) !== existing.username || (firstName ?? null) !== existing.firstName) {
      await db.update(users).set({ username: username ?? null, firstName: firstName ?? null }).where(eq(users.userId, userId));
    }
    return { user: existing, isNew: false };
  }
  // самореферал и несуществующий реферер — игнорируем
  let ref: number | null = null;
  if (refBy && refBy !== userId) {
    const referrer = await getUser(refBy);
    if (referrer) ref = refBy;
  }
  const inserted = await db
    .insert(users)
    .values({ userId, username: username ?? null, firstName: firstName ?? null, refBy: ref, createdAt: now() })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    // гонка: пользователь создан параллельным запросом
    return { user: (await getUser(userId))!, isNew: false };
  }
  if (ref) await addFreeRequests(ref, cfg.referralFreeRequests);
  if (cfg.signupBonusTokens > 0) await addWallet(userId, SIGNUP_BONUS_MODEL, cfg.signupBonusTokens);
  return { user: inserted[0], isNew: true };
}

export async function addBalance(userId: number, amount: number) {
  await db.update(users).set({ balanceRub: sql`${users.balanceRub} + ${amount}` }).where(eq(users.userId, userId));
}

/** Атомарное списание: не даст уйти в минус при двойном нажатии. */
export async function trySpendBalance(userId: number, amount: number): Promise<boolean> {
  const res = await db
    .update(users)
    .set({ balanceRub: sql`${users.balanceRub} - ${amount}` })
    .where(and(eq(users.userId, userId), gte(users.balanceRub, amount)))
    .returning({ id: users.userId });
  return res.length > 0;
}

export async function addFreeRequests(userId: number, n: number) {
  await db.update(users).set({ freeRequests: sql`${users.freeRequests} + ${n}` }).where(eq(users.userId, userId));
}

export async function tryUseFreeRequest(userId: number): Promise<boolean> {
  const res = await db
    .update(users)
    .set({ freeRequests: sql`${users.freeRequests} - 1` })
    .where(and(eq(users.userId, userId), gte(users.freeRequests, 1)))
    .returning({ id: users.userId });
  return res.length > 0;
}

export async function setBanned(userId: number, banned: boolean) {
  await db.update(users).set({ banned }).where(eq(users.userId, userId));
}

export async function setChatMode(userId: number, mode: "normal" | "economy") {
  await db.update(users).set({ chatMode: mode }).where(eq(users.userId, userId));
}

export async function setActiveModel(userId: number, modelKey: string | null) {
  await db.update(users).set({ activeModel: modelKey }).where(eq(users.userId, userId));
}

export async function allUserIds(): Promise<number[]> {
  const rows = await db.select({ id: users.userId }).from(users);
  return rows.map((r) => r.id);
}

export async function userCount(): Promise<number> {
  const [row] = await db.select({ c: count() }).from(users);
  return row?.c ?? 0;
}

export async function referralCount(userId: number): Promise<number> {
  const [row] = await db.select({ c: count() }).from(users).where(eq(users.refBy, userId));
  return row?.c ?? 0;
}

export async function recentUsers(limit = 30): Promise<User[]> {
  return db.select().from(users).orderBy(desc(users.createdAt)).limit(limit);
}

// ---------------- wallets ----------------
export async function getWallet(userId: number, modelKey: string): Promise<number> {
  const [row] = await db
    .select({ remaining: wallets.remaining })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.modelKey, modelKey)))
    .limit(1);
  return row?.remaining ?? 0;
}

export async function getAllWallets(userId: number): Promise<Record<string, number>> {
  const rows = await db.select().from(wallets).where(eq(wallets.userId, userId));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.modelKey] = r.remaining;
  return out;
}

export async function addWallet(userId: number, modelKey: string, amount: number) {
  await db
    .insert(wallets)
    .values({ userId, modelKey, remaining: amount })
    .onConflictDoUpdate({ target: [wallets.userId, wallets.modelKey], set: { remaining: sql`${wallets.remaining} + ${amount}` } });
}

/** Списывает amount токенов; если не хватает — списывает всё что есть (не уходит в минус). */
export async function spendWalletClamped(userId: number, modelKey: string, amount: number) {
  await db
    .update(wallets)
    .set({ remaining: sql`GREATEST(0, ${wallets.remaining} - ${amount})` })
    .where(and(eq(wallets.userId, userId), eq(wallets.modelKey, modelKey)));
}

/** Атомарное списание фиксированной суммы (для генерации картинок). */
export async function trySpendWallet(userId: number, modelKey: string, amount: number): Promise<boolean> {
  const res = await db
    .update(wallets)
    .set({ remaining: sql`${wallets.remaining} - ${amount}` })
    .where(and(eq(wallets.userId, userId), eq(wallets.modelKey, modelKey), gte(wallets.remaining, amount)))
    .returning({ u: wallets.userId });
  return res.length > 0;
}

// ---------------- transactions ----------------
export async function createTransaction(userId: number, amountRub: number, method: number | null): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(transactions).values({ id, userId, amountRub, status: "pending", method, createdAt: now() });
  return id;
}

export async function setTransactionUrl(id: string, url: string) {
  await db.update(transactions).set({ paymentUrl: url }).where(eq(transactions.id, id));
}

export async function getTransaction(id: string) {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return row ?? null;
}

export async function markTransactionFailed(id: string) {
  await db.update(transactions).set({ status: "failed" }).where(and(eq(transactions.id, id), eq(transactions.status, "pending")));
}

/**
 * Идемпотентно помечает транзакцию оплаченной и зачисляет деньги.
 * Возвращает транзакцию, если зачисление произошло именно сейчас (для уведомления), иначе null.
 */
export async function creditPaidTransaction(id: string) {
  const updated = await db
    .update(transactions)
    .set({ status: "paid", credited: true, paidAt: now() })
    .where(and(eq(transactions.id, id), eq(transactions.credited, false)))
    .returning();
  if (updated.length === 0) return null;
  const tx = updated[0];
  await addBalance(tx.userId, tx.amountRub);
  return tx;
}

export async function pendingTransactions(maxAgeSec: number) {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.status, "pending"), gte(transactions.createdAt, now() - maxAgeSec)));
}

export async function userTransactions(userId: number, limit = 10) {
  return db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(desc(transactions.createdAt)).limit(limit);
}

export async function recentTransactions(limit = 30) {
  return db.select().from(transactions).orderBy(desc(transactions.createdAt)).limit(limit);
}

export async function paymentStats() {
  const [row] = await db
    .select({ c: count(), s: sum(transactions.amountRub) })
    .from(transactions)
    .where(eq(transactions.status, "paid"));
  return { count: row?.c ?? 0, sum: Number(row?.s ?? 0) };
}

// ---------------- purchases ----------------
export async function recordPurchase(userId: number, modelKey: string, tokens: number, priceRub: number) {
  await db.insert(purchases).values({ userId, modelKey, tokens, priceRub, createdAt: now() });
}

export async function userPurchases(userId: number, limit = 10) {
  return db.select().from(purchases).where(eq(purchases.userId, userId)).orderBy(desc(purchases.createdAt)).limit(limit);
}

export async function purchaseStats() {
  const [row] = await db.select({ c: count(), s: sum(purchases.priceRub) }).from(purchases);
  return { count: row?.c ?? 0, sum: Number(row?.s ?? 0) };
}

// ---------------- dialogs ----------------
export async function addDialogMessage(
  userId: number,
  modelKey: string,
  role: "user" | "assistant",
  content: string,
  attachments: Attachment[] | null = null,
  extra: { imageB64?: string | null; tokens?: number | null } = {},
) {
  const [row] = await db
    .insert(dialogs)
    .values({ userId, modelKey, role, content, attachments: attachments ?? null, imageB64: extra.imageB64 ?? null, tokens: extra.tokens ?? null, createdAt: now() })
    .returning();
  return row;
}

export async function getDialog(userId: number, modelKey: string, limit = 20) {
  const rows = await db
    .select()
    .from(dialogs)
    .where(and(eq(dialogs.userId, userId), eq(dialogs.modelKey, modelKey)))
    .orderBy(desc(dialogs.id))
    .limit(limit);
  return rows.reverse();
}

export async function clearDialog(userId: number, modelKey: string) {
  await db.delete(dialogs).where(and(eq(dialogs.userId, userId), eq(dialogs.modelKey, modelKey)));
}

// ---------------- tickets ----------------
export async function createTicket(userId: number, text: string): Promise<number> {
  const [t] = await db.insert(tickets).values({ userId, status: "open", createdAt: now() }).returning();
  await db.insert(ticketMessages).values({ ticketId: t.id, sender: "user", text, createdAt: now() });
  return t.id;
}

export async function addTicketMessage(ticketId: number, sender: "user" | "admin", text: string) {
  await db.insert(ticketMessages).values({ ticketId, sender, text, createdAt: now() });
}

export async function getTicket(ticketId: number) {
  const [row] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  return row ?? null;
}

export async function userTickets(userId: number) {
  return db.select().from(tickets).where(eq(tickets.userId, userId)).orderBy(desc(tickets.createdAt));
}

export async function openTickets() {
  return db.select().from(tickets).where(eq(tickets.status, "open")).orderBy(asc(tickets.createdAt));
}

export async function openTicketCount(): Promise<number> {
  const [row] = await db.select({ c: count() }).from(tickets).where(eq(tickets.status, "open"));
  return row?.c ?? 0;
}

export async function getTicketMessages(ticketId: number) {
  return db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, ticketId)).orderBy(asc(ticketMessages.createdAt));
}

export async function closeTicket(ticketId: number) {
  await db.update(tickets).set({ status: "closed" }).where(eq(tickets.id, ticketId));
}

// ---------------- promo ----------------
export async function createPromo(code: string, bonusRub: number, maxUses: number) {
  await db
    .insert(promoCodes)
    .values({ code, bonusRub, maxUses, usedCount: 0, active: true })
    .onConflictDoUpdate({ target: promoCodes.code, set: { bonusRub, maxUses, active: true } });
}

export async function listPromos() {
  return db.select().from(promoCodes).orderBy(asc(promoCodes.code));
}

export async function deactivatePromo(code: string) {
  await db.update(promoCodes).set({ active: false }).where(eq(promoCodes.code, code));
}

export async function redeemPromo(codeRaw: string, userId: number): Promise<{ ok: boolean; message: string }> {
  const code = codeRaw.trim().toUpperCase();
  const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
  if (!promo || !promo.active) return { ok: false, message: "Промокод не найден или неактивен." };
  const inserted = await db.insert(promoRedemptions).values({ code, userId }).onConflictDoNothing().returning();
  if (inserted.length === 0) return { ok: false, message: "Вы уже активировали этот промокод." };
  // атомарно увеличиваем счётчик только если лимит не исчерпан
  const bumped = await db
    .update(promoCodes)
    .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
    .where(and(eq(promoCodes.code, code), sql`${promoCodes.usedCount} < ${promoCodes.maxUses}`))
    .returning();
  if (bumped.length === 0) {
    await db.delete(promoRedemptions).where(and(eq(promoRedemptions.code, code), eq(promoRedemptions.userId, userId)));
    return { ok: false, message: "Лимит активаций промокода исчерпан." };
  }
  await addBalance(userId, promo.bonusRub);
  return { ok: true, message: `Промокод активирован! Начислено ${Math.round(promo.bonusRub)} ₽ на баланс.` };
}

// ---------------- FSM state ----------------
export interface UserState {
  state: string | null;
  data: Record<string, unknown>;
}

export async function getState(userId: number): Promise<UserState> {
  const [row] = await db.select().from(userStates).where(eq(userStates.userId, userId)).limit(1);
  return { state: row?.state ?? null, data: (row?.data as Record<string, unknown>) ?? {} };
}

export async function setState(userId: number, state: string | null, data: Record<string, unknown> = {}) {
  await db
    .insert(userStates)
    .values({ userId, state, data, updatedAt: now() })
    .onConflictDoUpdate({ target: userStates.userId, set: { state, data, updatedAt: now() } });
}

export async function clearState(userId: number) {
  await setState(userId, null, {});
}
