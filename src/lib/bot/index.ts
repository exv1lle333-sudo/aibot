import { Bot, Context, InputFile, InlineKeyboard, GrammyError } from "grammy";
import { cfg, fmtNum, fmtRub, isAdmin } from "../config";
import * as repo from "../repo";
import * as svc from "../services";
import * as api from "../forgetapi";
import type { Attachment } from "../forgetapi";
import { MODELS, CATEGORY_TITLES, sellRubPer1m, packagePrice, MIN_TOKENS_FOR_TEXT_REQUEST } from "../pricing";
import * as kb from "./keyboards";
import { BTN } from "./keyboards";
import { renderChunks, extractFileBlocks, escapeHtml } from "./format";
import { registerAdmin } from "./admin";

export type BotCtx = Context & { state: repo.UserState; isAdmin: boolean };

// ---------- тексты ----------
const T = {
  welcome:
    "👋 <b>Привет!</b> Это ИИ-бот с лучшими нейросетями: Claude, GPT, Gemini и генерация картинок.\n\n" +
    "🤖 <b>Модели</b> — выбрать нейросеть и начать диалог\n" +
    "👤 <b>Кабинет</b> — баланс, токены, пополнение\n" +
    "👥 <b>Рефералы</b> — приглашай друзей и получай бонусы\n\n" +
    "Токены покупаются пакетами отдельно под каждую модель — платишь только за то, чем пользуешься.",
  thinking: "⏳ Думаю...",
  cancelled: "Отменено.",
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md|csv|json|xml|yaml|yml|py|js|ts|tsx|jsx|html|css|sql|sh|java|kt|go|rs|c|cpp|h|php|rb|toml|ini|env|log)$/i;

let _bot: Bot<BotCtx> | null = null;

export function getBot(): Bot<BotCtx> {
  if (_bot) return _bot;
  if (!cfg.botToken) throw new Error("BOT_TOKEN не задан");
  const bot = new Bot<BotCtx>(cfg.botToken);

  // ---------- middleware: пользователь, бан, состояние ----------
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from || from.is_bot) return;
    ctx.isAdmin = isAdmin(from.id);
    const isStart = ctx.message?.text?.startsWith("/start");
    if (!isStart) {
      const { user } = await repo.getOrCreateUser(from.id, from.username, from.first_name);
      if (user.banned && !ctx.isAdmin) {
        if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "🚫 Доступ ограничен", show_alert: true }).catch(() => {});
        return;
      }
    }
    ctx.state = await repo.getState(from.id);
    await next();
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError && /message is not modified|query is too old/.test(e.description)) return;
    console.error("bot error", e);
  });

  // ---------- helpers ----------
  const uid = (ctx: BotCtx) => ctx.from!.id;
  const setState = (ctx: BotCtx, state: string | null, data: Record<string, unknown> = {}) => repo.setState(uid(ctx), state, data);

  async function editOrSend(ctx: BotCtx, text: string, markup?: InlineKeyboard) {
    if (ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: markup, link_preview_options: { is_disabled: true } });
        return;
      } catch {
        /* fallthrough */
      }
    }
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: markup, link_preview_options: { is_disabled: true } });
  }

  async function showMain(ctx: BotCtx, text = "Главное меню 👇") {
    await setState(ctx, null);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb.mainKb(uid(ctx)) });
  }

  async function cabinetText(userId: number) {
    const c = await svc.cabinet(userId);
    if (!c) return "Пользователь не найден";
    let t =
      `👤 <b>Кабинет</b>\n\n` +
      `ID: <code>${c.userId}</code>\n` +
      `Баланс: <b>${fmtRub(c.balanceRub)}</b>\n` +
      `Бесплатных запросов (реферальных): <b>${c.freeRequests}</b>\n`;
    if (c.wallets.length) {
      t += `\n<b>Токены по моделям:</b>\n` + c.wallets.map((w) => `${w.emoji} ${escapeHtml(w.title)} — ${fmtNum(w.remaining)}`).join("\n") + "\n";
    } else {
      t += `\nТокенов пока нет — купи пакет в разделе «🤖 Модели».\n`;
    }
    return t;
  }

  async function showCabinet(ctx: BotCtx) {
    const user = await repo.getUser(uid(ctx));
    await editOrSend(ctx, await cabinetText(uid(ctx)), kb.cabinetKb(user?.chatMode ?? "normal"));
  }

  async function showModels(ctx: BotCtx) {
    await editOrSend(ctx, "🤖 <b>Модели</b>\n\nВыбери категорию:", kb.categoriesKb());
  }

  async function showSupport(ctx: BotCtx) {
    await editOrSend(
      ctx,
      `🛟 <b>Поддержка</b>\n\nЕсли что-то не работает или есть вопрос — создай тикет, мы ответим прямо в боте.${cfg.supportUsername ? `\nКонтакт: ${escapeHtml(cfg.supportUsername)}` : ""}`,
      kb.supportKb(),
    );
  }

  async function showReferral(ctx: BotCtx) {
    const count = await repo.referralCount(uid(ctx));
    const link = svc.referralLink(uid(ctx));
    await editOrSend(
      ctx,
      `👥 <b>Реферальная программа</b>\n\n` +
        `За каждого приглашённого ты получаешь:\n` +
        `• <b>${cfg.referralFreeRequests}</b> бесплатных запросов к ${MODELS["gemini-3.1-flash-lite"].title}\n` +
        `• <b>${cfg.referralCommissionPercent}%</b> от каждой покупки пакета другом — на баланс\n\n` +
        `Твоя ссылка:\n<code>${link}</code>\n\nПриглашено: <b>${count}</b>`,
      kb.backKb(),
    );
  }

  async function sendModelAnswer(ctx: BotCtx, thinkingMsgId: number | null, answer: string) {
    const { files, rest } = extractFileBlocks(answer);
    const chunks = renderChunks(rest || (files.length ? "📎 Файлы во вложении." : answer));
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      try {
        if (i === 0 && thinkingMsgId) {
          await ctx.api.editMessageText(ctx.chat!.id, thinkingMsgId, c.html, { parse_mode: "HTML" });
        } else {
          await ctx.reply(c.html, { parse_mode: "HTML" });
        }
      } catch {
        // если HTML не прошёл валидацию Telegram — шлём как есть
        if (i === 0 && thinkingMsgId) await ctx.api.editMessageText(ctx.chat!.id, thinkingMsgId, c.plain).catch(() => {});
        else await ctx.reply(c.plain).catch(() => {});
      }
    }
    for (const f of files) {
      await ctx.replyWithDocument(new InputFile(Buffer.from(f.content, "utf8"), f.name)).catch(() => {});
    }
  }

  async function downloadFile(ctx: BotCtx, fileId: string): Promise<Buffer | null> {
    const f = await ctx.api.getFile(fileId);
    if (!f.file_path) return null;
    const r = await fetch(`https://api.telegram.org/file/bot${cfg.botToken}/${f.file_path}`);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  }

  async function chatTurn(ctx: BotCtx, text: string, attachments: Attachment[] | null = null, refImage: { data: Buffer; mime: string } | null = null) {
    const modelKey = String(ctx.state.data.modelKey ?? "");
    const model = MODELS[modelKey];
    if (!model) {
      await showMain(ctx, "Модель больше недоступна. Выбери другую в разделе «🤖 Модели».");
      return;
    }
    const thinking = await ctx.reply(T.thinking);
    await ctx.replyWithChatAction(model.kind === "image" ? "upload_photo" : "typing").catch(() => {});
    const typing = setInterval(() => ctx.replyWithChatAction(model.kind === "image" ? "upload_photo" : "typing").catch(() => {}), 5000);
    try {
      const result = model.kind === "image" ? await svc.runImageTurn(uid(ctx), modelKey, text, refImage) : await svc.runTextTurn(uid(ctx), modelKey, text, attachments);
      if (!result.ok) {
        const markup = result.code === "no_tokens" ? new InlineKeyboard().text("🛒 Купить токены", `model:${modelKey}`) : undefined;
        await ctx.api.editMessageText(ctx.chat!.id, thinking.message_id, result.error, { reply_markup: markup }).catch(() => {});
        return;
      }
      if (result.kind === "image") {
        await ctx.api.deleteMessage(ctx.chat!.id, thinking.message_id).catch(() => {});
        await ctx.replyWithPhoto(new InputFile(Buffer.from(result.imageB64, "base64"), result.mime.includes("png") ? "image.png" : "image.jpg"));
      } else {
        await sendModelAnswer(ctx, thinking.message_id, result.answer);
      }
    } finally {
      clearInterval(typing);
    }
  }

  // ---------- команды ----------
  bot.command("start", async (ctx) => {
    const payload = (ctx.match ?? "").toString().trim();
    let refBy: number | null = null;
    if (/^ref\d+$/.test(payload)) refBy = Number(payload.slice(3));
    const { isNew } = await repo.getOrCreateUser(uid(ctx), ctx.from!.username, ctx.from!.first_name, refBy);
    await setState(ctx, null);
    let text = T.welcome;
    if (isNew && cfg.signupBonusTokens > 0) {
      text += `\n\n🎁 <b>Приветственный бонус:</b> ${fmtNum(cfg.signupBonusTokens)} токенов ${MODELS["gemini-3.1-flash-lite"].title} уже на твоём счёте!`;
    }
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb.mainKb(uid(ctx)) });
  });

  bot.command("app", async (ctx) => {
    const url = kb.miniAppUrl();
    if (!url) return ctx.reply("Мини-приложение ещё не подключено (нужен HTTPS-адрес в PUBLIC_BASE_URL).");
    await ctx.reply("🚀 Открыть приложение:", { reply_markup: new InlineKeyboard().webApp("Открыть", url) });
  });

  bot.command("new_chat", async (ctx) => {
    if (ctx.state.state === "chat") {
      const modelKey = String(ctx.state.data.modelKey);
      await repo.clearDialog(uid(ctx), modelKey);
      await ctx.reply("🧹 История диалога очищена. Можешь начать заново.", { reply_markup: kb.chatKb() });
    } else {
      await ctx.reply("Сейчас нет активного диалога. Выбери модель в разделе «🤖 Модели».");
    }
  });

  // ---------- главное меню (reply-кнопки) ----------
  const menuButtons: Record<string, (ctx: BotCtx) => Promise<void>> = {
    [BTN.MODELS]: async (ctx) => {
      await setState(ctx, null);
      await showModels(ctx);
    },
    [BTN.CABINET]: async (ctx) => {
      await setState(ctx, null);
      await showCabinet(ctx);
    },
    [BTN.SUPPORT]: async (ctx) => {
      await setState(ctx, null);
      await showSupport(ctx);
    },
    [BTN.REFERRAL]: async (ctx) => {
      await setState(ctx, null);
      await showReferral(ctx);
    },
    [BTN.CHANNEL]: async (ctx) => {
      await setState(ctx, null);
      if (cfg.channelUrl) await ctx.reply("📢 Наш канал:", { reply_markup: new InlineKeyboard().url("Перейти в канал", cfg.channelUrl) });
    },
    [BTN.ADMIN]: async (ctx) => {
      if (!ctx.isAdmin) return;
      await setState(ctx, null);
      await editOrSend(ctx, "🛠 <b>Админ-панель</b>", kb.adminKb());
    },
    [BTN.CHAT_BACK]: async (ctx) => {
      await showMain(ctx);
    },
    [BTN.CANCEL]: async (ctx) => {
      await showMain(ctx, T.cancelled);
    },
    [BTN.CHAT_CLEAR]: async (ctx) => {
      if (ctx.state.state === "chat") {
        await repo.clearDialog(uid(ctx), String(ctx.state.data.modelKey));
        await ctx.reply("🧹 История диалога очищена.", { reply_markup: kb.chatKb() });
      } else await showMain(ctx);
    },
  };

  // ---------- callback: меню ----------
  bot.callbackQuery("menu:main", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await showMain(ctx);
  });
  bot.callbackQuery("menu:cabinet", async (ctx) => {
    await ctx.answerCallbackQuery();
    await setState(ctx, null);
    await showCabinet(ctx);
  });
  bot.callbackQuery("menu:models", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showModels(ctx);
  });
  bot.callbackQuery("menu:support", async (ctx) => {
    await ctx.answerCallbackQuery();
    await setState(ctx, null);
    await showSupport(ctx);
  });
  bot.callbackQuery("menu:referral", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showReferral(ctx);
  });

  // ---------- режим диалога ----------
  bot.callbackQuery("menu:mode", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await repo.getUser(uid(ctx));
    await editOrSend(
      ctx,
      "⚙️ <b>Режим диалога</b>\n\n<b>Обычный</b> — модель помнит предыдущие сообщения (контекст растёт, токенов уходит больше).\n<b>Экономный</b> — каждое сообщение как отдельный вопрос (дешевле, но без памяти).",
      kb.modeKb(user?.chatMode ?? "normal"),
    );
  });
  bot.callbackQuery(/^mode:set:(normal|economy)$/, async (ctx) => {
    const mode = ctx.match[1] as "normal" | "economy";
    await repo.setChatMode(uid(ctx), mode);
    await ctx.answerCallbackQuery({ text: "Режим сохранён" });
    await showCabinet(ctx);
  });

  // ---------- пополнение ----------
  bot.callbackQuery("balance:topup", async (ctx) => {
    await ctx.answerCallbackQuery();
    await setState(ctx, "topup");
    await editOrSend(ctx, `➕ <b>Пополнение баланса</b>\n\nВыбери сумму кнопкой или просто напиши её числом (от ${cfg.minTopupRub} ₽):`, kb.topupKb());
  });
  bot.callbackQuery(/^topup:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startTopup(ctx, Number(ctx.match[1]));
  });
  bot.callbackQuery("balance:check", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Проверяю..." });
    const n = await svc.reconcilePending(uid(ctx));
    await ctx.reply(n > 0 ? `✅ Зачислено платежей: ${n}` : "Оплаченных платежей пока не найдено. Если ты только что оплатил — подожди минуту.");
  });
  bot.callbackQuery("balance:history", async (ctx) => {
    await ctx.answerCallbackQuery();
    const [txs, purchases] = await Promise.all([repo.userTransactions(uid(ctx), 10), repo.userPurchases(uid(ctx), 10)]);
    let t = "🧾 <b>История</b>\n\n<b>Пополнения:</b>\n";
    t += txs.length ? txs.map((x) => `${statusEmoji(x.status)} ${fmtRub(x.amountRub)} — ${date(x.createdAt)}`).join("\n") : "пока нет";
    t += "\n\n<b>Покупки пакетов:</b>\n";
    t += purchases.length ? purchases.map((p) => `🛒 ${fmtNum(p.tokens)} · ${escapeHtml(MODELS[p.modelKey]?.title ?? p.modelKey)} — ${fmtRub(p.priceRub)}`).join("\n") : "пока нет";
    await editOrSend(ctx, t, kb.backKb("menu:cabinet"));
  });

  async function startTopup(ctx: BotCtx, amount: number) {
    const res = await svc.createTopup(uid(ctx), amount);
    await setState(ctx, null);
    if (!res.ok) return ctx.reply(`❌ ${res.error}`, { reply_markup: kb.mainKb(uid(ctx)) });
    await ctx.reply(`💳 Счёт на <b>${fmtRub(amount)}</b> создан. После оплаты баланс пополнится автоматически.`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().url("Оплатить", res.url).row().text("🔄 Проверить оплату", "balance:check"),
    });
  }

  // ---------- промокод ----------
  bot.callbackQuery("menu:promo", async (ctx) => {
    await ctx.answerCallbackQuery();
    await setState(ctx, "promo");
    await ctx.reply("🎁 Введи промокод:", { reply_markup: kb.cancelKb() });
  });

  // ---------- модели ----------
  bot.callbackQuery(/^models_cat:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const cat = ctx.match[1];
    if (!CATEGORY_TITLES[cat]) return showModels(ctx);
    const wallets = await repo.getAllWallets(uid(ctx));
    await editOrSend(ctx, `${CATEGORY_TITLES[cat]}\n\nВыбери модель (число рядом — твой остаток токенов):`, kb.modelsKb(cat, wallets));
  });

  bot.callbackQuery(/^model:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const m = MODELS[ctx.match[1]];
    if (!m) return showModels(ctx);
    const remaining = Math.floor(await repo.getWallet(uid(ctx), m.key));
    const user = await repo.getUser(uid(ctx));
    let price = `${fmtRub(sellRubPer1m(m))} за 1 000 000 токенов`;
    if (m.kind === "image") price += `\nОдна генерация — ${fmtNum(m.maxTokensPerGeneration)} токенов ≈ ${fmtRub(packagePrice(m.key, m.maxTokensPerGeneration))}`;
    const text =
      `${m.emoji} <b>${escapeHtml(m.title)}</b>\n\n${escapeHtml(m.description)}\n\n` +
      `💰 <b>Цена:</b> ${price}\n` +
      `🎟 <b>Твой остаток:</b> ${fmtNum(remaining)} токенов` +
      (m.referralEligible && user?.freeRequests ? ` + ${user.freeRequests} беспл. запросов` : "") +
      `\n💼 Баланс: ${fmtRub(user?.balanceRub ?? 0)}\n\nПакеты токенов:`;
    await editOrSend(ctx, text, kb.modelCardKb(m.key));
  });

  bot.callbackQuery(/^buy:([^:]+):(\d+)$/, async (ctx) => {
    const modelKey = ctx.match[1];
    const tokens = Number(ctx.match[2]);
    const res = await svc.buyPackage(uid(ctx), modelKey, tokens);
    if (!res.ok) {
      if (res.reason === "not_enough") {
        await ctx.answerCallbackQuery();
        await editOrSend(ctx, `❌ Недостаточно средств: пакет стоит ${fmtRub(res.price ?? 0)}, не хватает <b>${fmtRub(res.missing ?? 0)}</b>.`, kb.notEnoughKb());
      } else await ctx.answerCallbackQuery({ text: "Пакет недоступен", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "✅ Куплено!" });
    await editOrSend(
      ctx,
      `✅ Куплено <b>${fmtNum(res.tokens)}</b> токенов «${escapeHtml(res.title)}» за ${fmtRub(res.price)}.\n\nНажми «💬 Начать диалог», чтобы использовать.`,
      kb.modelCardKb(modelKey),
    );
  });

  bot.callbackQuery(/^chat:clear:(.+)$/, async (ctx) => {
    await repo.clearDialog(uid(ctx), ctx.match[1]);
    await ctx.answerCallbackQuery({ text: "🧹 Очищено" });
  });

  bot.callbackQuery(/^chat:(.+)$/, async (ctx) => {
    const m = MODELS[ctx.match[1]];
    if (!m) return ctx.answerCallbackQuery({ text: "Модель недоступна", show_alert: true });
    const remaining = await repo.getWallet(uid(ctx), m.key);
    const user = await repo.getUser(uid(ctx));
    const need = m.kind === "image" ? m.maxTokensPerGeneration : MIN_TOKENS_FOR_TEXT_REQUEST;
    if (remaining < need && !(m.referralEligible && (user?.freeRequests ?? 0) > 0)) {
      return ctx.answerCallbackQuery({ text: `Нужно минимум ${fmtNum(need)} токенов. Купи пакет ниже 👇`, show_alert: true });
    }
    await ctx.answerCallbackQuery();
    await setState(ctx, "chat", { modelKey: m.key });
    await repo.setActiveModel(uid(ctx), m.key);
    const hint =
      m.kind === "image"
        ? "Опиши картинку, которую хочешь получить. Можно прислать фото как референс с подписью."
        : "Пиши вопрос текстом, голосовым, присылай фото или файлы — модель всё поймёт.";
    await ctx.reply(`${m.emoji} Диалог с <b>${escapeHtml(m.title)}</b> начат.\n\n${hint}`, { parse_mode: "HTML", reply_markup: kb.chatKb() });
  });

  // ---------- тикеты ----------
  bot.callbackQuery("support:tickets", async (ctx) => {
    await ctx.answerCallbackQuery();
    const list = await repo.userTickets(uid(ctx));
    await editOrSend(ctx, list.length ? "🎫 <b>Твои тикеты:</b>" : "🎫 У тебя пока нет тикетов.", kb.ticketsKb(list));
  });
  bot.callbackQuery("ticket:new", async (ctx) => {
    await ctx.answerCallbackQuery();
    await setState(ctx, "ticket_new");
    await ctx.reply("✍️ Опиши проблему или вопрос одним сообщением:", { reply_markup: kb.cancelKb() });
  });
  bot.callbackQuery(/^ticket:view:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = Number(ctx.match[1]);
    const t = await repo.getTicket(id);
    if (!t || t.userId !== uid(ctx)) return;
    const msgs = await repo.getTicketMessages(id);
    const body = msgs.map((m) => `${m.sender === "admin" ? "🛟 Поддержка" : "👤 Ты"}: ${escapeHtml(m.text)}`).join("\n\n");
    await editOrSend(ctx, `🎫 <b>Тикет #${id}</b> — ${t.status === "open" ? "открыт" : "закрыт"}\n\n${body}`.slice(0, 4000), kb.ticketViewKb(id, t.status === "open"));
  });
  bot.callbackQuery(/^ticket:reply:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await setState(ctx, "ticket_reply", { ticketId: Number(ctx.match[1]) });
    await ctx.reply(`💬 Напиши ответ в тикет #${ctx.match[1]}:`, { reply_markup: kb.cancelKb() });
  });

  // ---------- админ-часть ----------
  registerAdmin(bot, { editOrSend, setState, showMain, uid });

  // ---------- текстовые сообщения ----------
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const handler = menuButtons[text];
    if (handler) return handler(ctx);
    if (text.startsWith("/")) return ctx.reply("Неизвестная команда. Нажми /start.");

    const st = ctx.state.state;
    switch (st) {
      case "chat":
        return chatTurn(ctx, text);
      case "topup": {
        const amount = Number(text.replace(",", ".").replace(/[^\d.]/g, ""));
        if (!amount || amount < cfg.minTopupRub) return ctx.reply(`Введи сумму числом, минимум ${cfg.minTopupRub} ₽.`);
        return startTopup(ctx, Math.floor(amount));
      }
      case "promo": {
        const res = await repo.redeemPromo(text, uid(ctx));
        await setState(ctx, null);
        return ctx.reply(`${res.ok ? "✅" : "❌"} ${res.message}`, { reply_markup: kb.mainKb(uid(ctx)) });
      }
      case "ticket_new": {
        const id = await svc.openTicket(uid(ctx), text);
        await setState(ctx, null);
        return ctx.reply(`✅ Тикет <b>#${id}</b> создан. Ответ придёт сюда, в бот.`, { parse_mode: "HTML", reply_markup: kb.mainKb(uid(ctx)) });
      }
      case "ticket_reply": {
        const ok = await svc.replyTicketAsUser(uid(ctx), Number(ctx.state.data.ticketId), text);
        await setState(ctx, null);
        return ctx.reply(ok ? "✅ Сообщение добавлено в тикет." : "Тикет закрыт или не найден.", { reply_markup: kb.mainKb(uid(ctx)) });
      }
      default:
        if (st?.startsWith("admin_") && ctx.isAdmin) return; // обработано в admin.ts (он стоит раньше)
        return ctx.reply("Выбери раздел в меню 👇", { reply_markup: kb.mainKb(uid(ctx)) });
    }
  });

  // ---------- фото ----------
  bot.on("message:photo", async (ctx) => {
    if (ctx.state.state !== "chat") return ctx.reply("Сначала выбери модель в разделе «🤖 Модели», потом присылай фото.");
    const modelKey = String(ctx.state.data.modelKey);
    const model = MODELS[modelKey];
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const data = await downloadFile(ctx, photo.file_id);
    if (!data) return ctx.reply("Не удалось скачать фото.");
    const caption = ctx.message.caption?.trim() || (model?.kind === "image" ? "Сделай вариацию этого изображения" : "Что на этом изображении?");
    if (model?.kind === "image") return chatTurn(ctx, caption, null, { data, mime: "image/jpeg" });
    return chatTurn(ctx, caption, [{ kind: "image", mime_type: "image/jpeg", data_b64: data.toString("base64") }]);
  });

  // ---------- документы ----------
  bot.on("message:document", async (ctx) => {
    if (ctx.state.state !== "chat") return ctx.reply("Сначала выбери модель в разделе «🤖 Модели», потом присылай файлы.");
    const doc = ctx.message.document;
    if ((doc.file_size ?? 0) > MAX_FILE_BYTES) return ctx.reply("Файл слишком большой (макс. 20 МБ).");
    const data = await downloadFile(ctx, doc.file_id);
    if (!data) return ctx.reply("Не удалось скачать файл.");
    const name = doc.file_name ?? "file";
    const mime = doc.mime_type ?? "application/octet-stream";
    const caption = ctx.message.caption?.trim() || "Проанализируй этот файл.";
    const model = MODELS[String(ctx.state.data.modelKey)];
    if (model?.kind === "image") {
      if (mime.startsWith("image/")) return chatTurn(ctx, caption, null, { data, mime });
      return ctx.reply("Для генерации картинок пришли изображение или текстовое описание.");
    }
    let att: Attachment;
    if (mime.startsWith("image/")) att = { kind: "image", mime_type: mime, data_b64: data.toString("base64") };
    else if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXT.test(name)) att = { kind: "text_file", filename: name, text: data.toString("utf8").slice(0, 200_000) };
    else att = { kind: "document", mime_type: mime, filename: name, data_b64: data.toString("base64") };
    return chatTurn(ctx, caption, [att]);
  });

  // ---------- голос ----------
  const voiceHandler = async (ctx: BotCtx, fileId: string, mime: string, name: string) => {
    if (ctx.state.state !== "chat") return ctx.reply("Сначала выбери модель в разделе «🤖 Модели».");
    const data = await downloadFile(ctx, fileId);
    if (!data) return ctx.reply("Не удалось скачать аудио.");
    let text = "";
    try {
      text = await api.transcribe(data, name, mime);
    } catch (e) {
      console.error("transcribe failed", e);
      return ctx.reply("Не удалось распознать голосовое. Напиши текстом, пожалуйста.");
    }
    if (!text) return ctx.reply("В голосовом не удалось разобрать речь.");
    await ctx.reply(`🎤 <i>${escapeHtml(text)}</i>`, { parse_mode: "HTML" });
    return chatTurn(ctx, text);
  };
  bot.on("message:voice", (ctx) => voiceHandler(ctx, ctx.message.voice.file_id, "audio/ogg", "voice.ogg"));
  bot.on("message:audio", (ctx) => voiceHandler(ctx, ctx.message.audio.file_id, ctx.message.audio.mime_type ?? "audio/mpeg", ctx.message.audio.file_name ?? "audio.mp3"));

  bot.on("message", async (ctx) => {
    if (ctx.state.state === "chat") await ctx.reply("Этот тип сообщения не поддерживается. Пришли текст, фото, файл или голосовое.");
  });

  _bot = bot;
  return bot;
}

function statusEmoji(s: string) {
  return s === "paid" ? "✅" : s === "failed" ? "❌" : "⏳";
}
function date(ts: number) {
  return new Date(ts * 1000).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Регистрируем webhook + команды + кнопку меню. */
export async function setupWebhook(): Promise<{ ok: boolean; url: string; error?: string }> {
  const base = cfg.publicBaseUrl;
  if (!base.startsWith("https://")) return { ok: false, url: base, error: "PUBLIC_BASE_URL должен быть https://" };
  const bot = getBot();
  const url = `${base}/api/telegram/webhook`;
  try {
    await bot.api.setWebhook(url, { secret_token: cfg.webhookSecret || undefined, drop_pending_updates: false, allowed_updates: ["message", "callback_query"] });
    await bot.api.setMyCommands([
      { command: "start", description: "Главное меню" },
      { command: "app", description: "Открыть мини-приложение" },
      { command: "new_chat", description: "Очистить историю диалога" },
    ]);
    await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Приложение", web_app: { url: base } } });
    return { ok: true, url };
  } catch (e) {
    return { ok: false, url, error: (e as Error).message };
  }
}
