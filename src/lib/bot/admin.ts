import type { Bot, InlineKeyboard } from "grammy";
import type { BotCtx } from "./index";
import * as repo from "../repo";
import * as svc from "../services";
import * as kb from "./keyboards";
import { BTN } from "./keyboards";
import { escapeHtml } from "./format";
import { fmtNum, fmtRub } from "../config";
import { MODELS } from "../pricing";

interface Helpers {
  editOrSend: (ctx: BotCtx, text: string, markup?: InlineKeyboard) => Promise<void>;
  setState: (ctx: BotCtx, state: string | null, data?: Record<string, unknown>) => Promise<void>;
  showMain: (ctx: BotCtx, text?: string) => Promise<void>;
  uid: (ctx: BotCtx) => number;
}

const MENU_TEXTS = new Set(Object.values(BTN));

export function registerAdmin(bot: Bot<BotCtx>, h: Helpers) {
  const { editOrSend, setState, showMain, uid } = h;
  const adminOnly = (ctx: BotCtx) => ctx.isAdmin;

  async function showAdmin(ctx: BotCtx) {
    await setState(ctx, null);
    await editOrSend(ctx, "🛠 <b>Админ-панель</b>", kb.adminKb());
  }

  bot.command("admin").filter(adminOnly, (ctx) => showAdmin(ctx));
  bot.callbackQuery("menu:admin").filter(adminOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAdmin(ctx);
  });

  const prompt = async (ctx: BotCtx, state: string, text: string, data: Record<string, unknown> = {}) => {
    await ctx.answerCallbackQuery();
    await setState(ctx, state, data);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb.cancelKb() });
  };

  bot.callbackQuery("admin:give_balance").filter(adminOnly, (ctx) => prompt(ctx, "admin_give_id", "💸 Введи ID пользователя (или @username):"));
  bot.callbackQuery("admin:find_user").filter(adminOnly, (ctx) => prompt(ctx, "admin_find", "🔍 Введи ID или @username:"));
  bot.callbackQuery("admin:ban").filter(adminOnly, (ctx) => prompt(ctx, "admin_ban", "🚫 Введи ID или @username — статус бана переключится:"));
  bot.callbackQuery("admin:write_one").filter(adminOnly, (ctx) => prompt(ctx, "admin_write_id", "✉️ Введи ID пользователя:"));
  bot.callbackQuery("admin:broadcast").filter(adminOnly, (ctx) => prompt(ctx, "admin_broadcast", "📣 Введи текст рассылки (HTML разрешён):"));
  bot.callbackQuery("admin:promo").filter(adminOnly, async (ctx) => {
    const list = await repo.listPromos();
    const txt = list.length
      ? "🎁 <b>Промокоды:</b>\n" + list.map((p) => `${p.active ? "🟢" : "⚪️"} <code>${escapeHtml(p.code)}</code> — ${fmtRub(p.bonusRub)}, ${p.usedCount}/${p.maxUses}`).join("\n")
      : "Промокодов пока нет.";
    await prompt(ctx, "admin_promo", `${txt}\n\nСоздать новый: <code>КОД СУММА КОЛ_ВО</code>\nНапример: <code>SALE2026 200 100</code>\nОтключить: <code>off КОД</code>`);
  });
  bot.callbackQuery("admin:apikey").filter(adminOnly, async (ctx) => {
    const cur = await repo.getSetting("forgetapi_key");
    await prompt(ctx, "admin_apikey", `⚙️ Текущий ключ ForgetAPI: ${cur ? `<code>***${escapeHtml(cur.slice(-4))}</code> (из базы)` : "из .env или не задан"}\n\nПришли новый ключ одним сообщением:`);
  });

  bot.callbackQuery("admin:users").filter(adminOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [total, recent] = await Promise.all([repo.userCount(), repo.recentUsers(15)]);
    const lines = recent.map((u) => `<code>${u.userId}</code> ${u.username ? "@" + escapeHtml(u.username) : ""} — ${fmtRub(u.balanceRub)}${u.banned ? " 🚫" : ""}`);
    await editOrSend(ctx, `👥 Всего пользователей: <b>${total}</b>\n\nПоследние:\n${lines.join("\n")}`, kb.backKb("menu:admin"));
  });

  bot.callbackQuery("admin:payments").filter(adminOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    const txs = await repo.recentTransactions(25);
    const lines = txs.map((t) => `${t.status === "paid" ? "✅" : t.status === "failed" ? "❌" : "⏳"} <code>${t.userId}</code> — ${fmtRub(t.amountRub)} · ${new Date(t.createdAt * 1000).toLocaleDateString("ru-RU")}`);
    await editOrSend(ctx, `🧾 <b>Последние платежи</b>\n\n${lines.join("\n") || "пока нет"}`, kb.backKb("menu:admin"));
  });

  bot.callbackQuery("admin:stats").filter(adminOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = await svc.adminStats();
    await editOrSend(
      ctx,
      `📊 <b>Статистика</b>\n\n` +
        `👥 Пользователей: <b>${s.users}</b>\n` +
        `🎫 Открытых тикетов: <b>${s.openTickets}</b>\n` +
        `💰 Пополнений: <b>${s.paymentsCount}</b> на <b>${fmtRub(s.paymentsSum)}</b>\n` +
        `🛒 Покупок пакетов: <b>${s.purchasesCount}</b> на <b>${fmtRub(s.purchasesSum)}</b>\n\n` +
        `⚙️ Ключ ForgetAPI: ${s.apiKeySet ? "✅ задан" : "❌ не задан"}\n` +
        `💳 Platega: ${s.plategaConfigured ? "✅ настроена" : "❌ не настроена"}`,
      kb.backKb("menu:admin"),
    );
  });

  bot.callbackQuery("admin:tickets").filter(adminOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    const list = await repo.openTickets();
    await editOrSend(ctx, list.length ? `🎫 Открытых тикетов: <b>${list.length}</b>` : "🎫 Открытых тикетов нет.", kb.adminTicketsKb(list));
  });
  bot.callbackQuery(/^admin:ticket:(\d+)$/).filter(adminOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = Number(ctx.match[1]);
    const t = await repo.getTicket(id);
    if (!t) return;
    const msgs = await repo.getTicketMessages(id);
    const body = msgs.map((m) => `${m.sender === "admin" ? "🛟 Админ" : "👤 Юзер"}: ${escapeHtml(m.text)}`).join("\n\n");
    await editOrSend(ctx, `🎫 <b>Тикет #${id}</b> от <code>${t.userId}</code> — ${t.status}\n\n${body}`.slice(0, 4000), kb.adminTicketKb(id));
  });
  bot.callbackQuery(/^admin:ticket_reply:(\d+)$/).filter(adminOnly, (ctx) => prompt(ctx, "admin_ticket_reply", `💬 Ответ в тикет #${ctx.match[1]}:`, { ticketId: Number(ctx.match[1]) }));
  bot.callbackQuery(/^admin:ticket_close:(\d+)$/).filter(adminOnly, async (ctx) => {
    await svc.closeTicketByAdmin(Number(ctx.match[1]));
    await ctx.answerCallbackQuery({ text: "Закрыт" });
    const list = await repo.openTickets();
    await editOrSend(ctx, list.length ? `🎫 Открытых тикетов: <b>${list.length}</b>` : "🎫 Открытых тикетов нет.", kb.adminTicketsKb(list));
  });

  async function resolveUser(q: string) {
    const s = q.trim();
    if (/^\d+$/.test(s)) return repo.getUser(Number(s));
    return repo.findUserByUsername(s);
  }

  function userCard(u: NonNullable<Awaited<ReturnType<typeof repo.getUser>>>, wallets: Record<string, number>) {
    const w = Object.entries(wallets)
      .filter(([k, v]) => MODELS[k] && v > 0)
      .map(([k, v]) => `  ${MODELS[k].title}: ${fmtNum(v)}`)
      .join("\n");
    return (
      `👤 <code>${u.userId}</code> ${u.username ? "@" + escapeHtml(u.username) : ""}\n` +
      `Имя: ${escapeHtml(u.firstName ?? "—")}\nБаланс: <b>${fmtRub(u.balanceRub)}</b>\nБесплатных запросов: ${u.freeRequests}\n` +
      `Реферер: ${u.refBy ?? "—"}\nЗабанен: ${u.banned ? "да 🚫" : "нет"}\nРежим: ${u.chatMode}\n` +
      `Регистрация: ${new Date(u.createdAt * 1000).toLocaleDateString("ru-RU")}\n` +
      (w ? `Токены:\n${w}` : "Токенов нет")
    );
  }

  // ---------- текстовые состояния админа (стоит раньше общего обработчика) ----------
  bot.on("message:text").filter(
    (ctx) => ctx.isAdmin && Boolean(ctx.state.state?.startsWith("admin_")) && !MENU_TEXTS.has(ctx.message.text.trim()),
    async (ctx) => {
      const text = ctx.message.text.trim();
      const st = ctx.state.state!;
      const done = (msg: string) => showMain(ctx, msg);

      switch (st) {
        case "admin_give_id": {
          const u = await resolveUser(text);
          if (!u) return ctx.reply("Пользователь не найден. Попробуй ещё раз:");
          await setState(ctx, "admin_give_amount", { uid: u.userId });
          return ctx.reply(`Пользователь <code>${u.userId}</code>, баланс ${fmtRub(u.balanceRub)}.\nВведи сумму в ₽ (можно отрицательную, чтобы списать):`, { parse_mode: "HTML" });
        }
        case "admin_give_amount": {
          const amount = Number(text.replace(",", "."));
          if (!Number.isFinite(amount) || amount === 0) return ctx.reply("Введи число, например 500 или -100:");
          const target = Number(ctx.state.data.uid);
          await repo.addBalance(target, amount);
          void svc.sendTelegramMessage(target, amount > 0 ? `🎁 Администратор начислил тебе <b>${fmtRub(amount)}</b> на баланс.` : `ℹ️ С твоего баланса списано ${fmtRub(-amount)} администратором.`);
          return done(`✅ Баланс пользователя ${target} изменён на ${fmtRub(amount)}.`);
        }
        case "admin_find": {
          const u = await resolveUser(text);
          if (!u) return ctx.reply("Пользователь не найден. Попробуй ещё раз:");
          await setState(ctx, null);
          await ctx.reply(userCard(u, await repo.getAllWallets(u.userId)), { parse_mode: "HTML", reply_markup: kb.mainKb(uid(ctx)) });
          return;
        }
        case "admin_ban": {
          const u = await resolveUser(text);
          if (!u) return ctx.reply("Пользователь не найден. Попробуй ещё раз:");
          if (ctx.isAdmin && u.userId === uid(ctx)) return ctx.reply("Себя банить нельзя 🙂");
          await repo.setBanned(u.userId, !u.banned);
          return done(`${!u.banned ? "🚫 Забанен" : "✅ Разбанен"}: ${u.userId}`);
        }
        case "admin_write_id": {
          const u = await resolveUser(text);
          if (!u) return ctx.reply("Пользователь не найден. Попробуй ещё раз:");
          await setState(ctx, "admin_write_text", { uid: u.userId });
          return ctx.reply(`Текст сообщения для ${u.userId}:`);
        }
        case "admin_write_text": {
          const ok = await svc.sendTelegramMessage(Number(ctx.state.data.uid), text);
          return done(ok ? "✅ Отправлено." : "❌ Не удалось отправить (пользователь заблокировал бота?).");
        }
        case "admin_broadcast": {
          await ctx.reply("📣 Рассылка запущена...");
          const r = await svc.broadcast(text);
          return done(`✅ Рассылка завершена: отправлено ${r.sent}, ошибок ${r.failed}.`);
        }
        case "admin_ticket_reply": {
          const ok = await svc.replyTicketAsAdmin(Number(ctx.state.data.ticketId), text);
          return done(ok ? "✅ Ответ отправлен пользователю." : "Тикет не найден.");
        }
        case "admin_promo": {
          const parts = text.split(/\s+/);
          if (parts[0]?.toLowerCase() === "off" && parts[1]) {
            await repo.deactivatePromo(parts[1].toUpperCase());
            return done(`⚪️ Промокод ${parts[1].toUpperCase()} отключён.`);
          }
          const [code, sum, uses] = parts;
          const bonus = Number(sum);
          const max = Number(uses);
          if (!code || !bonus || !max || bonus <= 0 || max <= 0) return ctx.reply("Формат: КОД СУММА КОЛ_ВО, например SALE2026 200 100");
          await repo.createPromo(code.toUpperCase(), bonus, Math.floor(max));
          return done(`✅ Промокод <code>${escapeHtml(code.toUpperCase())}</code> на ${fmtRub(bonus)} × ${max} активаций создан.`);
        }
        case "admin_apikey": {
          await repo.setSetting("forgetapi_key", text);
          await ctx.deleteMessage().catch(() => {});
          return done("✅ Ключ ForgetAPI сохранён и уже используется.");
        }
      }
    },
  );
}
