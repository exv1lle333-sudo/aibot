(function () {
  "use strict";

  const tg = window.Telegram ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor("secondary_bg_color"); } catch (e) {}
  }

  const screensEl = document.getElementById("screens");
  const topTitle = document.getElementById("topTitle");
  const btnBack = document.getElementById("btnBack");
  const tabs = document.querySelectorAll(".tab");

  let state = { profile: null, models: null, minTopup: 100, history: [] };
  let navStack = ["home"];

  // ---------------- API helper ----------------

  async function api(path, body) {
    const initData = tg ? tg.initData : "";
    const opts = {
      method: path.startsWith("/api/models") || path.startsWith("/api/support") ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
    };
    if (opts.method === "POST") {
      opts.body = JSON.stringify(Object.assign({ initData }, body || {}));
    }
    const res = await fetch(path, opts);
    let data;
    try { data = await res.json(); } catch (e) { data = { ok: false, error: "bad_response" }; }
    return data;
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.getElementById("app").appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function haptic(kind) {
    if (tg && tg.HapticFeedback) {
      try { tg.HapticFeedback.impactOccurred(kind || "light"); } catch (e) {}
    }
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function fmtRub(n) {
    return (Math.round(n * 100) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ₽";
  }
  function fmtTok(n) {
    return Math.round(n).toLocaleString("ru-RU");
  }

  // ---------------- navigation ----------------

  function go(screen, opts) {
    opts = opts || {};
    if (opts.replace) navStack[navStack.length - 1] = screen; else navStack.push(screen);
    render(screen, opts.params);
  }

  function goBack() {
    if (navStack.length > 1) {
      navStack.pop();
      render(navStack[navStack.length - 1]);
    }
  }

  btnBack.addEventListener("click", goBack);

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      navStack = [btn.dataset.screen];
      render(btn.dataset.screen);
      haptic("light");
    });
  });

  function setActiveTab(screen) {
    const root = { home: "home", profile: "profile", balance: "balance", purchase: "purchase", chat: "chat" }[screen] || null;
    tabs.forEach((b) => b.classList.toggle("active", b.dataset.screen === root));
  }

  // ---------------- screens ----------------

  const SCREENS = {};

  SCREENS.home = {
    title: "exvl",
    showBack: false,
    render: () => `
      <div class="menu-grid">
        <div class="menu-item" data-go="chat"><span class="emoji">💬</span><span class="label">Начать чат</span></div>
        <div class="menu-item" data-go="purchase"><span class="emoji">🛒</span><span class="label">Покупка</span></div>
        <div class="menu-item" data-go="profile"><span class="emoji">👤</span><span class="label">Профиль</span></div>
        <div class="menu-item" data-go="balance"><span class="emoji">💰</span><span class="label">Баланс</span></div>
        <div class="menu-item" data-go="promo"><span class="emoji">🎁</span><span class="label">Промокод</span></div>
        <div class="menu-item" data-go="support"><span class="emoji">🛟</span><span class="label">Поддержка</span></div>
        <div class="menu-item" data-go="referral"><span class="emoji">👥</span><span class="label">Рефералы</span></div>
        <div class="menu-item" data-open-channel="1"><span class="emoji">📢</span><span class="label">Наш канал</span></div>
      </div>`,
    after: (el) => {
      el.querySelectorAll("[data-go]").forEach((n) => n.addEventListener("click", () => go(n.dataset.go)));
      const ch = el.querySelector("[data-open-channel]");
      if (ch) ch.addEventListener("click", async () => {
        const r = await api("/api/support");
        if (r.ok && r.channel_url && tg) tg.openTelegramLink(r.channel_url);
      });
    },
  };

  SCREENS.chat = {
    title: "Чат с моделями",
    showBack: true,
    render: () => `
      <div class="card">
        <p class="hint">Сам диалог с нейросетями идёт прямо в чате с ботом (текст, фото, голосовые,
        файлы) — в мини-аппе это меню профиля/баланса/покупок. Закрой мини-апп и выбери модель
        через кнопку «💬 Начать чат» в чате с ботом.</p>
        <button class="btn" id="btnCloseToChat">Вернуться в чат</button>
      </div>`,
    after: (el) => {
      el.querySelector("#btnCloseToChat").addEventListener("click", () => { if (tg) tg.close(); });
    },
  };

  SCREENS.profile = {
    title: "Профиль",
    showBack: false,
    render: () => `<div class="spinner">Загрузка…</div>`,
    after: async (el) => {
      const r = await api("/api/profile");
      if (!r.ok) { el.innerHTML = `<div class="empty-state">Не удалось загрузить профиль</div>`; return; }
      state.profile = r;
      const walletsHtml = r.wallets.map((w) => `
        <div class="row"><span class="label">${esc(w.title)}</span><span class="value">${fmtTok(w.remaining)} ток.</span></div>
      `).join("");
      el.innerHTML = `
        <div class="card">
          <div class="row"><span class="label">ID</span><span class="value">${esc(r.user_id)}</span></div>
          <div class="row"><span class="label">Username</span><span class="value">${esc(r.username ? "@" + r.username : "—")}</span></div>
          <div class="row"><span class="label">Баланс</span><span class="value">${fmtRub(r.balance_rub)}</span></div>
          <div class="row"><span class="label">Бесплатных запросов</span><span class="value">${esc(r.free_requests)}</span></div>
        </div>
        <h2 class="section-title">Токены по моделям</h2>
        <div class="card">${walletsHtml || '<span class="hint">Пока пусто</span>'}</div>
      `;
    },
  };

  SCREENS.balance = {
    title: "Баланс",
    showBack: false,
    render: () => `<div class="spinner">Загрузка…</div>`,
    after: async (el) => {
      const r = await api("/api/profile");
      const min = state.models ? state.models.min_topup_rub : 100;
      el.innerHTML = `
        <div class="card">
          <div class="row"><span class="label">Текущий баланс</span><span class="value">${r.ok ? fmtRub(r.balance_rub) : "—"}</span></div>
        </div>
        <h2 class="section-title">Пополнить баланс</h2>
        <div class="card">
          <p class="hint">Минимум ${min} ₽. Быстрый выбор или своя сумма.</p>
          <div class="quick-amounts">
            ${[100, 300, 500, 1000, 3000, 5000].map((a) => `<button data-amt="${a}">${a} ₽</button>`).join("")}
          </div>
          <input class="field" type="number" min="${min}" id="topupAmount" placeholder="Своя сумма, ₽">
          <button class="btn" id="btnTopup">Пополнить</button>
        </div>
        <h2 class="section-title">История платежей</h2>
        <div class="card" id="historyBox"><div class="hint">Загрузка…</div></div>
      `;
      el.querySelectorAll("[data-amt]").forEach((b) => b.addEventListener("click", () => {
        document.getElementById("topupAmount").value = b.dataset.amt;
      }));
      el.querySelector("#btnTopup").addEventListener("click", async () => {
        const amount = parseFloat(document.getElementById("topupAmount").value);
        if (!amount || amount < min) { toast(`Минимум ${min} ₽`); return; }
        const res = await api("/api/balance/topup", { amount });
        if (!res.ok) { toast("Не получилось создать платёж"); return; }
        if (tg && tg.openLink) tg.openLink(res.url); else window.open(res.url, "_blank");
      });

      const hist = await api("/api/balance/history");
      const box = el.querySelector("#historyBox");
      if (hist.ok && hist.history.length) {
        const statusMap = { paid: "✅ оплачено", pending: "⏳ ожидание", failed: "❌ ошибка" };
        box.innerHTML = hist.history.map((tx) => `
          <div class="row"><span class="label">${fmtRub(tx.amount_rub)}</span><span class="value">${statusMap[tx.status] || esc(tx.status)}</span></div>
        `).join("");
      } else {
        box.innerHTML = `<span class="hint">История платежей пуста</span>`;
      }
    },
  };

  SCREENS.purchase = {
    title: "Покупка",
    showBack: false,
    render: () => `<div class="spinner">Загрузка моделей…</div>`,
    after: async (el) => {
      const r = await api("/api/models");
      if (!r.ok) { el.innerHTML = `<div class="empty-state">Не удалось загрузить модели</div>`; return; }
      state.models = r;
      el.innerHTML = `<div class="card" style="padding:0">` + r.models.map((m) => `
        <div class="model-card" data-model="${esc(m.key)}" style="border-bottom:1px solid var(--border); cursor:pointer;">
          <div>
            <div class="name">${esc(m.title)}</div>
            <div class="price">${Math.round(m.sell_rub_per_1m).toLocaleString("ru-RU")} ₽ / 1 000 000 токенов</div>
          </div>
          <div class="chev">›</div>
        </div>
      `).join("") + `</div>`;
      el.querySelectorAll("[data-model]").forEach((n) => n.addEventListener("click", () => renderModelCard(n.dataset.model)));
    },
  };

  function renderModelCard(key) {
    const el = document.querySelector(".screen.active");
    const m = state.models.models.find((x) => x.key === key);
    if (!m || !el) return;
    el.innerHTML = `
      <div class="card">
        <div class="name" style="font-size:17px; margin-bottom:6px;">${esc(m.title)}</div>
        <p class="hint">${esc(m.description)}</p>
        <div class="row"><span class="label">Цена</span><span class="value">${Math.round(m.sell_rub_per_1m).toLocaleString("ru-RU")} ₽ / 1М ток.</span></div>
      </div>
      <h2 class="section-title">Выбери пакет</h2>
      <div class="pkg-grid">
        ${m.packages.map((p) => `
          <div class="pkg-btn" data-amount="${p.amount}">
            <div class="amt">${fmtTok(p.amount)} ток.</div>
            <div class="price">${p.price} ₽</div>
          </div>
        `).join("")}
      </div>
      <button class="btn secondary" id="btnBackToModels" style="margin-top:16px;">⬅️ К моделям</button>
    `;
    el.querySelector("#btnBackToModels").addEventListener("click", () => render("purchase"));
    el.querySelectorAll("[data-amount]").forEach((n) => n.addEventListener("click", async () => {
      const amount = parseInt(n.dataset.amount, 10);
      const res = await api("/api/buy", { model_key: key, amount });
      if (!res.ok) {
        if (res.error === "not_enough_balance") {
          toast(`Не хватает ${res.missing} ₽. Пополни баланс.`);
        } else {
          toast("Не получилось купить пакет");
        }
        return;
      }
      haptic("medium");
      toast(`Куплено: ${fmtTok(amount)} ток. для ${res.title}`);
      go("profile", { replace: true });
    }));
  }

  SCREENS.promo = {
    title: "Промокод",
    showBack: true,
    render: () => `
      <div class="card">
        <p class="hint">Введи промокод, чтобы получить бонус на баланс.</p>
        <input class="field" id="promoInput" placeholder="Промокод">
        <button class="btn" id="btnPromo">Активировать</button>
      </div>`,
    after: (el) => {
      el.querySelector("#btnPromo").addEventListener("click", async () => {
        const code = document.getElementById("promoInput").value.trim();
        if (!code) return;
        const r = await api("/api/promo", { code });
        toast(r.message || (r.ok ? "Готово" : "Ошибка"));
        if (r.ok) { haptic("medium"); document.getElementById("promoInput").value = ""; }
      });
    },
  };

  SCREENS.support = {
    title: "Поддержка",
    showBack: true,
    render: () => `
      <div class="card">
        <div class="row" data-go-doc="user_agreement_url"><span class="label">📄 Пользовательское соглашение</span><span class="chev">›</span></div>
        <div class="row" data-go-doc="privacy_policy_url"><span class="label">🔒 Политика конфиденциальности</span><span class="chev">›</span></div>
      </div>
      <h2 class="section-title">Тикеты</h2>
      <div class="card">
        <button class="btn" id="btnNewTicket">✍️ Новое обращение</button>
      </div>
      <div id="ticketsBox"><div class="spinner">Загрузка…</div></div>
    `,
    after: async (el) => {
      el.querySelectorAll("[data-go-doc]").forEach((n) => n.addEventListener("click", async () => {
        const r = await api("/api/support");
        const url = r[n.dataset.goDoc];
        if (url && tg) tg.openLink(url); else toast("Документ не добавлен");
      }));
      el.querySelector("#btnNewTicket").addEventListener("click", renderNewTicket);
      const r = await api("/api/tickets");
      const box = el.querySelector("#ticketsBox");
      if (r.ok && r.tickets.length) {
        box.innerHTML = `<div class="card" style="padding:0 16px">` + r.tickets.map((t) => `
          <div class="ticket-row" data-ticket="${t.id}">
            <span><span class="dot ${t.status}"></span>Тикет #${t.id}</span>
            <span class="chev">›</span>
          </div>
        `).join("") + `</div>`;
        box.querySelectorAll("[data-ticket]").forEach((n) => n.addEventListener("click", () => renderTicketView(parseInt(n.dataset.ticket, 10))));
      } else {
        box.innerHTML = `<div class="empty-state">Обращений пока нет</div>`;
      }
    },
  };

  function renderNewTicket() {
    const el = document.querySelector(".screen.active");
    el.innerHTML = `
      <div class="card">
        <p class="hint">Опиши свой вопрос — админ ответит в этом же разделе.</p>
        <textarea class="field" id="ticketText" placeholder="Текст обращения"></textarea>
        <button class="btn" id="btnSendTicket">Отправить</button>
        <button class="btn secondary" id="btnCancelTicket">Отмена</button>
      </div>`;
    el.querySelector("#btnCancelTicket").addEventListener("click", () => render("support"));
    el.querySelector("#btnSendTicket").addEventListener("click", async () => {
      const text = document.getElementById("ticketText").value.trim();
      if (!text) return;
      const r = await api("/api/ticket/new", { text });
      if (r.ok) { toast(`Тикет #${r.ticket_id} создан`); render("support"); }
      else toast("Не получилось отправить");
    });
  }

  function renderTicketView(ticketId) {
    const el = document.querySelector(".screen.active");
    el.innerHTML = `<div class="spinner">Загрузка…</div>`;
    api("/api/ticket/view", { ticket_id: ticketId }).then((r) => {
      if (!r.ok) { el.innerHTML = `<div class="empty-state">Тикет не найден</div>`; return; }
      const msgsHtml = r.messages.map((m) => `<div class="msg ${m.sender}">${esc(m.text)}</div>`).join("");
      el.innerHTML = `
        <div class="card">${msgsHtml}</div>
        ${r.ticket.status === "open" ? `
          <textarea class="field" id="replyText" placeholder="Ответить в поддержку"></textarea>
          <button class="btn" id="btnSendReply">Отправить</button>
        ` : `<p class="hint">Тикет закрыт.</p>`}
        <button class="btn secondary" id="btnBackTickets">⬅️ К тикетам</button>
      `;
      const back = document.getElementById("btnBackTickets");
      if (back) back.addEventListener("click", () => render("support"));
      const send = document.getElementById("btnSendReply");
      if (send) send.addEventListener("click", async () => {
        const text = document.getElementById("replyText").value.trim();
        if (!text) return;
        const res = await api("/api/ticket/reply", { ticket_id: ticketId, text });
        if (res.ok) renderTicketView(ticketId); else toast("Не получилось отправить");
      });
    });
  }

  SCREENS.referral = {
    title: "Рефералы",
    showBack: true,
    render: () => `<div class="spinner">Загрузка…</div>`,
    after: async (el) => {
      const r = await api("/api/referral");
      if (!r.ok) { el.innerHTML = `<div class="empty-state">Не удалось загрузить</div>`; return; }
      el.innerHTML = `
        <div class="card">
          <p class="hint">За каждого друга — ${r.free_requests_per_ref} бесплатных запросов к GPT-5.6 Luna
          и ${r.commission_percent}% с каждой его покупки на твой баланс.</p>
          <div class="row"><span class="label">Приглашено</span><span class="value">${r.count}</span></div>
        </div>
        <div class="card">
          <p class="hint" style="word-break:break-all">${esc(r.link)}</p>
          <button class="btn" id="btnCopyLink">Скопировать ссылку</button>
          <button class="btn secondary" id="btnShareLink">Поделиться</button>
        </div>
      `;
      el.querySelector("#btnCopyLink").addEventListener("click", () => {
        navigator.clipboard.writeText(r.link).then(() => toast("Ссылка скопирована"));
      });
      el.querySelector("#btnShareLink").addEventListener("click", () => {
        if (tg) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(r.link)}`);
      });
    },
  };

  // ---------------- render engine ----------------

  function render(screenName, params) {
    const def = SCREENS[screenName];
    if (!def) return;
    topTitle.textContent = def.title;
    btnBack.hidden = navStack.length <= 1;
    setActiveTab(screenName);

    let el = document.getElementById("scr-" + screenName);
    if (!el) {
      el = document.createElement("div");
      el.id = "scr-" + screenName;
      el.className = "screen";
      screensEl.appendChild(el);
    }
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    el.innerHTML = typeof def.render === "function" ? def.render(params) : def.render;
    el.classList.add("active");
    if (def.after) def.after(el, params);

    if (tg) {
      if (navStack.length > 1) {
        tg.BackButton.show();
        tg.BackButton.onClick(goBack);
      } else {
        tg.BackButton.hide();
      }
    }
  }

  render("home");
})();
