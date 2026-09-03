/**
 * Бизнес-логика, общая для Telegram-бота и мини-аппа.
 */
import * as repo from "./repo";
import * as api from "./forgetapi";
import * as platega from "./platega";
import { cfg, fmtRub, fmtNum, isAdmin } from "./config";
import { MODELS, packagePrice, isValidPackage, MIN_TOKENS_FOR_TEXT_REQUEST, publicModel } from "./pricing";
import type { Attachment } from "./forgetapi";

// ---------- уведомления через Bot API (без импорта grammY — чтобы не тянуть бота в API-роуты) ----------
export async function sendTelegramMessage(chatId: number, text: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  if (!cfg.botToken) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...extra }),
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function notifyAdmins(text: string) {
  await Promise.all(cfg.adminIds.map((id) => sendTelegramMessage(id, text)));
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- кабинет ----------
export async function cabinet(userId: number) {
  const user = await repo.getUser(userId);
  if (!user) return null;
  const wallets = await repo.getAllWallets(userId);
  const walletList = Object.entries(wallets)
    .filter(([k, v]) => MODELS[k] && v > 0)
    .map(([k, v]) => ({ modelKey: k, title: MODELS[k].title, emoji: MODELS[k].emoji, kind: MODELS[k].kind, remaining: Math.floor(v) }));
  return {
    userId: user.userId,
    username: user.username,
    firstName: user.firstName,
    balanceRub: Math.round(user.balanceRub * 100) / 100,
    freeRequests: user.freeRequests,
    chatMode: user.chatMode as "normal" | "economy",
    activeModel: user.activeModel,
    banned: user.banned,
    isAdmin: isAdmin(user.userId),
    referrals: await repo.referralCount(userId),
    wallets: walletList,
  };
}

// ---------- покупка пакета ----------
export type BuyResult =
  | { ok: true; tokens: number; price: number; title: string }
  | { ok: false; reason: "unknown_model" | "bad_package" | "not_enough"; missing?: number; price?: number };

export async function buyPackage(userId: number, modelKey: string, tokens: number): Promise<BuyResult> {
  const model = MODELS[modelKey];
  if (!model) return { ok: false, reason: "unknown_model" };
  if (!isValidPackage(modelKey, tokens)) return { ok: false, reason: "bad_package" };
  const price = packagePrice(modelKey, tokens);
  const spent = await repo.trySpendBalance(userId, price);
  if (!spent) {
    const user = await repo.getUser(userId);
    const missing = Math.max(0, price - (user?.balanceRub ?? 0));
    return { ok: false, reason: "not_enough", missing: Math.round(missing * 100) / 100, price };
  }
  await repo.addWallet(userId, modelKey, tokens);
  await repo.recordPurchase(userId, modelKey, tokens, price);

  // реферальная комиссия
  const user = await repo.getUser(userId);
  if (user?.refBy) {
    const commission = Math.round(((price * cfg.referralCommissionPercent) / 100) * 100) / 100;
    if (commission > 0) {
      await repo.addBalance(user.refBy, commission);
      void sendTelegramMessage(
        user.refBy,
        `💸 Твой реферал купил пакет «${esc(model.title)}» — тебе начислено <b>${fmtRub(commission)}</b> (${cfg.referralCommissionPercent}% от покупки).`,
      );
    }
  }
  return { ok: true, tokens, price, title: model.title };
}

// ---------- пополнение ----------
export async function createTopup(userId: number, amountRub: number): Promise<{ ok: true; url: string; txId: string } | { ok: false; error: string }> {
  if (!Number.isFinite(amountRub) || amountRub < cfg.minTopupRub) {
    return { ok: false, error: `Минимальная сумма пополнения — ${cfg.minTopupRub} ₽.` };
  }
  if (amountRub > 1_000_000) return { ok: false, error: "Слишком большая сумма." };
  amountRub = Math.round(amountRub * 100) / 100;
  const txId = await repo.createTransaction(userId, amountRub, cfg.plategaActiveMethods[0] ?? null);
  try {
    const url = await platega.createPayment(amountRub, txId, `Пополнение баланса, пользователь ${userId}`);
    await repo.setTransactionUrl(txId, url);
    return { ok: true, url, txId };
  } catch (e) {
    await repo.markTransactionFailed(txId);
    console.error("createTopup failed", e);
    return { ok: false, error: e instanceof platega.PlategaError ? e.message : "Не удалось создать платёж. Попробуй позже." };
  }
}

/** Зачисляет оплаченную транзакцию (идемпотентно) и уведомляет пользователя. */
export async function settlePaidTransaction(txId: string): Promise<boolean> {
  const tx = await repo.creditPaidTransaction(txId);
  if (!tx) return false;
  void sendTelegramMessage(tx.userId, `✅ Оплата получена! Баланс пополнен на <b>${fmtRub(tx.amountRub)}</b>.`);
  void notifyAdmins(`💰 Пополнение: пользователь <code>${tx.userId}</code> — ${fmtRub(tx.amountRub)}`);
  return true;
}

/** Сверка зависших платежей напрямую с Platega (на случай, если webhook не дошёл). */
export async function reconcilePending(userId?: number): Promise<number> {
  const pending = await repo.pendingTransactions(60 * 60);
  let credited = 0;
  for (const tx of pending) {
    if (userId && tx.userId !== userId) continue;
    const info = await platega.getTransactionStatus(tx.id);
    if (!info) continue;
    if (platega.PAID_STATUSES.has(info.status)) {
      if (await settlePaidTransaction(tx.id)) credited++;
    } else if (platega.FAILED_STATUSES.has(info.status)) {
      await repo.markTransactionFailed(tx.id);
    }
  }
  return credited;
}

// ---------- чат ----------
export type ChatTurnResult =
  | { ok: true; kind: "text"; answer: string; tokens: number; usedFree: boolean }
  | { ok: true; kind: "image"; imageB64: string; mime: string; tokens: number }
  | { ok: false; error: string; code: "no_tokens" | "api_error" | "empty" | "unknown_model" | "banned" };

export function noTokensMessage(modelKey: string): string {
  const model = MODELS[modelKey];
  return `На балансе модели «${model?.title ?? modelKey}» закончились токены. Купи пакет в разделе «Модели».`;
}

/**
 * Один ход диалога с текстовой моделью.
 * Исправлено относительно оригинала:
 *  - бесплатный реферальный запрос списывается ТОЛЬКО после успешного ответа модели;
 *  - для запроса нужен минимальный остаток токенов (раньше при 1 токене можно было получить ответ на 10 000);
 *  - списание токенов не уходит в минус.
 */
export async function runTextTurn(userId: number, modelKey: string, text: string, attachments: Attachment[] | null = null): Promise<ChatTurnResult> {
  const model = MODELS[modelKey];
  if (!model || model.kind !== "text") return { ok: false, code: "unknown_model", error: "Модель недоступна." };
  const user = await repo.getUser(userId);
  if (!user) return { ok: false, code: "unknown_model", error: "Пользователь не найден." };
  if (user.banned) return { ok: false, code: "banned", error: "Доступ ограничен." };

  const remaining = await repo.getWallet(userId, modelKey);
  const hasTokens = remaining >= MIN_TOKENS_FOR_TEXT_REQUEST;
  const canUseFree = !hasTokens && model.referralEligible && user.freeRequests > 0;
  if (!hasTokens && !canUseFree) {
    return { ok: false, code: "no_tokens", error: noTokensMessage(modelKey) };
  }

  const history: api.HistoryMessage[] =
    user.chatMode === "economy"
      ? []
      : (await repo.getDialog(userId, modelKey)).map((d) => ({
          role: d.role as "user" | "assistant",
          content: d.content,
          attachments: (d.attachments as Attachment[] | null) ?? null,
        }));
  history.push({ role: "user", content: text, attachments });

  let answer: string;
  let tokens: number;
  try {
    ({ text: answer, tokens } = await api.chat(model, history));
  } catch (e) {
    console.error("chat failed", modelKey, e);
    if (attachments && attachments.length) {
      // повтор без вложения — часть моделей не переваривает конкретный файл
      try {
        const retry = [...history.slice(0, -1), { role: "user" as const, content: text, attachments: null }];
        ({ text: answer, tokens } = await api.chat(model, retry));
        answer = "⚠️ Не получилось прочитать прикреплённый файл этой моделью, отвечаю только по тексту:\n\n" + answer;
        attachments = null;
      } catch (e2) {
        console.error("chat retry failed", e2);
        return { ok: false, code: "api_error", error: apiErrorText(e2) };
      }
    } else {
      return { ok: false, code: "api_error", error: apiErrorText(e) };
    }
  }

  if (!answer.trim()) {
    return { ok: false, code: "empty", error: "Модель вернула пустой ответ. Попробуй переформулировать запрос." };
  }

  // списание — только после успешного ответа
  let usedFree = false;
  if (hasTokens) {
    await repo.spendWalletClamped(userId, modelKey, tokens);
  } else {
    usedFree = await repo.tryUseFreeRequest(userId);
  }

  if (user.chatMode === "economy") {
    await repo.clearDialog(userId, modelKey);
  }
  await repo.addDialogMessage(userId, modelKey, "user", text, attachments);
  await repo.addDialogMessage(userId, modelKey, "assistant", answer, null, { tokens });
  return { ok: true, kind: "text", answer, tokens, usedFree };
}

export async function runImageTurn(
  userId: number,
  modelKey: string,
  prompt: string,
  ref?: { data: Buffer; mime: string } | null,
): Promise<ChatTurnResult> {
  const model = MODELS[modelKey];
  if (!model || model.kind !== "image") return { ok: false, code: "unknown_model", error: "Модель недоступна." };
  const user = await repo.getUser(userId);
  if (!user) return { ok: false, code: "unknown_model", error: "Пользователь не найден." };
  if (user.banned) return { ok: false, code: "banned", error: "Доступ ограничен." };

  const cost = model.maxTokensPerGeneration;
  // резервируем токены ДО запроса (атомарно), при ошибке — возвращаем
  const reserved = await repo.trySpendWallet(userId, modelKey, cost);
  if (!reserved) return { ok: false, code: "no_tokens", error: noTokensMessage(modelKey) };
  try {
    const img = await api.generateImage(model, prompt, ref ?? null);
    const b64 = img.data.toString("base64");
    await repo.addDialogMessage(userId, modelKey, "user", prompt, null);
    await repo.addDialogMessage(userId, modelKey, "assistant", "", null, { imageB64: `data:${img.mime};base64,${b64}`, tokens: cost });
    return { ok: true, kind: "image", imageB64: b64, mime: img.mime, tokens: cost };
  } catch (e) {
    await repo.addWallet(userId, modelKey, cost); // возврат резерва
    console.error("generateImage failed", e);
    return { ok: false, code: "api_error", error: apiErrorText(e) };
  }
}

function apiErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("FORGETAPI_KEY")) return "⚙️ Сервис ещё не настроен: не задан ключ API. Напиши в поддержку.";
  if (msg.includes("Таймаут")) return "⏳ Модель слишком долго думает — попробуй упростить запрос или повторить позже.";
  if (e instanceof api.ForgetApiError && e.status === 401) return "⚙️ Ключ API недействителен. Администратор уведомлён.";
  if (e instanceof api.ForgetApiError && e.status === 429) return "⏳ Слишком много запросов, попробуй через минуту.";
  return "⚠️ Не удалось получить ответ от модели. Попробуй ещё раз чуть позже.";
}

// ---------- тикеты ----------
export async function openTicket(userId: number, text: string): Promise<number> {
  const id = await repo.createTicket(userId, text);
  const user = await repo.getUser(userId);
  void notifyAdmins(
    `🎫 Новый тикет <b>#${id}</b> от <code>${userId}</code>${user?.username ? ` (@${esc(user.username)})` : ""}:\n\n${esc(text.slice(0, 1500))}`,
  );
  return id;
}

export async function replyTicketAsUser(userId: number, ticketId: number, text: string): Promise<boolean> {
  const t = await repo.getTicket(ticketId);
  if (!t || t.userId !== userId || t.status !== "open") return false;
  await repo.addTicketMessage(ticketId, "user", text);
  void notifyAdmins(`💬 Ответ в тикете <b>#${ticketId}</b> от <code>${userId}</code>:\n\n${esc(text.slice(0, 1500))}`);
  return true;
}

export async function replyTicketAsAdmin(ticketId: number, text: string): Promise<boolean> {
  const t = await repo.getTicket(ticketId);
  if (!t) return false;
  await repo.addTicketMessage(ticketId, "admin", text);
  void sendTelegramMessage(t.userId, `🛟 Ответ поддержки по тикету <b>#${ticketId}</b>:\n\n${esc(text)}`);
  return true;
}

export async function closeTicketByAdmin(ticketId: number): Promise<boolean> {
  const t = await repo.getTicket(ticketId);
  if (!t) return false;
  await repo.closeTicket(ticketId);
  void sendTelegramMessage(t.userId, `✅ Тикет <b>#${ticketId}</b> закрыт. Если вопрос остался — создай новый.`);
  return true;
}

// ---------- рефералка ----------
export function referralLink(userId: number): string {
  return cfg.botUsername ? `https://t.me/${cfg.botUsername}?start=ref${userId}` : `?start=ref${userId}`;
}

// ---------- админ: статистика ----------
export async function adminStats() {
  const [usersTotal, openTickets, payments, purchasesAgg] = await Promise.all([
    repo.userCount(),
    repo.openTicketCount(),
    repo.paymentStats(),
    repo.purchaseStats(),
  ]);
  return {
    users: usersTotal,
    openTickets,
    paymentsCount: payments.count,
    paymentsSum: Math.round(payments.sum * 100) / 100,
    purchasesCount: purchasesAgg.count,
    purchasesSum: Math.round(purchasesAgg.sum * 100) / 100,
    apiKeySet: Boolean((await api.getApiKey()).length),
    plategaConfigured: platega.plategaConfigured(),
  };
}

export async function broadcast(text: string): Promise<{ sent: number; failed: number }> {
  const ids = await repo.allUserIds();
  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    const ok = await sendTelegramMessage(id, text);
    if (ok) sent++;
    else failed++;
    await new Promise((r) => setTimeout(r, 50)); // ~20 сообщений/сек — лимит Telegram
  }
  return { sent, failed };
}

export { publicModel, fmtNum, fmtRub };
