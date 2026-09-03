import { InlineKeyboard, Keyboard } from "grammy";
import { cfg, fmtNum, isAdmin } from "../config";
import { CATEGORY_TITLES, MODELS, categoriesWithModels, listPackages, modelsInCategory } from "../pricing";

export const BTN = {
  MODELS: "🤖 Модели",
  CABINET: "👤 Кабинет",
  SUPPORT: "🛟 Поддержка",
  REFERRAL: "👥 Рефералы",
  CHANNEL: "📢 Наш канал",
  APP: "🚀 Открыть приложение",
  ADMIN: "🛠 Админ-панель",
  CHAT_CLEAR: "🧹 Очистить диалог",
  CHAT_BACK: "⬅️ В главное меню",
  CANCEL: "❌ Отмена",
};

export function miniAppUrl(): string | null {
  const u = cfg.publicBaseUrl;
  return u.startsWith("https://") ? u : null;
}

export function mainKb(userId: number) {
  const kb = new Keyboard().text(BTN.MODELS).text(BTN.CABINET).row().text(BTN.SUPPORT).text(BTN.REFERRAL).row();
  const app = miniAppUrl();
  if (app) kb.webApp(BTN.APP, app);
  if (cfg.channelUrl) kb.text(BTN.CHANNEL);
  if (app || cfg.channelUrl) kb.row();
  if (isAdmin(userId)) kb.text(BTN.ADMIN).row();
  return kb.resized().persistent();
}

export function chatKb() {
  return new Keyboard().text(BTN.CHAT_CLEAR).text(BTN.CHAT_BACK).resized().persistent();
}

export function cancelKb() {
  return new Keyboard().text(BTN.CANCEL).resized();
}

export function backKb(target = "menu:main") {
  return new InlineKeyboard().text("⬅️ Назад", target);
}

export function cabinetKb(chatMode: string) {
  return new InlineKeyboard()
    .text("➕ Пополнить баланс", "balance:topup")
    .row()
    .text("🧾 История платежей", "balance:history")
    .text("🎁 Промокод", "menu:promo")
    .row()
    .text(`⚙️ Режим: ${chatMode === "economy" ? "экономный" : "обычный"}`, "menu:mode");
}

export function topupKb() {
  const kb = new InlineKeyboard();
  const sums = [100, 300, 500, 1000, 3000, 5000].filter((s) => s >= cfg.minTopupRub);
  sums.forEach((s, i) => {
    kb.text(`${fmtNum(s)} ₽`, `topup:${s}`);
    if (i % 3 === 2) kb.row();
  });
  return kb.row().text("🔄 Проверить оплату", "balance:check").row().text("⬅️ Назад", "menu:cabinet");
}

export function modeKb(current: string) {
  return new InlineKeyboard()
    .text(`${current === "normal" ? "✅ " : ""}Обычный (с историей)`, "mode:set:normal")
    .row()
    .text(`${current === "economy" ? "✅ " : ""}Экономный (без истории)`, "mode:set:economy")
    .row()
    .text("⬅️ Назад", "menu:cabinet");
}

export function categoriesKb() {
  const kb = new InlineKeyboard();
  for (const c of categoriesWithModels()) kb.text(CATEGORY_TITLES[c], `models_cat:${c}`).row();
  return kb;
}

export function modelsKb(category: string, wallets: Record<string, number>) {
  const kb = new InlineKeyboard();
  for (const m of modelsInCategory(category)) {
    const rem = Math.floor(wallets[m.key] ?? 0);
    kb.text(`${m.emoji} ${m.title}${rem > 0 ? ` · ${fmtNum(rem)}` : ""}`, `model:${m.key}`).row();
  }
  return kb.text("⬅️ Назад", "menu:models");
}

export function modelCardKb(modelKey: string) {
  const m = MODELS[modelKey];
  const kb = new InlineKeyboard().text("💬 Начать диалог", `chat:${modelKey}`).row();
  const packs = listPackages(modelKey);
  packs.forEach((p, i) => {
    const label = m.kind === "image" && p.tokens < 1_000_000 ? `${p.tokens / m.maxTokensPerGeneration} 🖼 · ${fmtNum(p.price)} ₽` : `${fmtNum(p.tokens)} · ${fmtNum(p.price)} ₽`;
    kb.text(label, `buy:${modelKey}:${p.tokens}`);
    if (i % 2 === 1) kb.row();
  });
  if (packs.length % 2 === 1) kb.row();
  return kb.text("⬅️ Назад", `models_cat:${m.category}`);
}

export function notEnoughKb() {
  return new InlineKeyboard().text("➕ Пополнить баланс", "balance:topup").row().text("⬅️ Назад", "menu:models");
}

export function supportKb() {
  const kb = new InlineKeyboard();
  if (cfg.userAgreementUrl) kb.url("📄 Пользовательское соглашение", cfg.userAgreementUrl).row();
  if (cfg.privacyPolicyUrl) kb.url("🔒 Политика конфиденциальности", cfg.privacyPolicyUrl).row();
  return kb.text("🎫 Мои тикеты", "support:tickets").row().text("✍️ Новый тикет", "ticket:new");
}

export function ticketsKb(list: { id: number; status: string }[]) {
  const kb = new InlineKeyboard();
  for (const t of list.slice(0, 10)) kb.text(`${t.status === "open" ? "🟢" : "⚪️"} Тикет #${t.id}`, `ticket:view:${t.id}`).row();
  return kb.text("✍️ Новый тикет", "ticket:new").row().text("⬅️ Назад", "menu:support");
}

export function ticketViewKb(id: number, open: boolean) {
  const kb = new InlineKeyboard();
  if (open) kb.text("💬 Ответить", `ticket:reply:${id}`).row();
  return kb.text("⬅️ К тикетам", "support:tickets");
}

export function adminKb() {
  return new InlineKeyboard()
    .text("💸 Выдать баланс", "admin:give_balance")
    .text("🔍 Найти пользователя", "admin:find_user")
    .row()
    .text("🚫 Бан / разбан", "admin:ban")
    .text("✉️ Написать одному", "admin:write_one")
    .row()
    .text("📣 Рассылка", "admin:broadcast")
    .text("🎫 Тикеты", "admin:tickets")
    .row()
    .text("👥 Пользователи", "admin:users")
    .text("🧾 Платежи", "admin:payments")
    .row()
    .text("🎁 Промокоды", "admin:promo")
    .text("📊 Статистика", "admin:stats")
    .row()
    .text("⚙️ Ключ ForgetAPI", "admin:apikey");
}

export function adminTicketsKb(list: { id: number; userId: number }[]) {
  const kb = new InlineKeyboard();
  for (const t of list.slice(0, 15)) kb.text(`#${t.id} · ${t.userId}`, `admin:ticket:${t.id}`).row();
  return kb.text("⬅️ Назад", "menu:admin");
}

export function adminTicketKb(id: number) {
  return new InlineKeyboard().text("💬 Ответить", `admin:ticket_reply:${id}`).text("✅ Закрыть", `admin:ticket_close:${id}`).row().text("⬅️ Назад", "admin:tickets");
}
