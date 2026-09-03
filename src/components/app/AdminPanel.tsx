"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AppCtx } from "./App";
import { api, fmtDate, fmtNum, fmtRub, haptic } from "./tg";
import { Sheet, Card, Row, Button, Input, Textarea, Badge, Loading, Empty } from "./ui";

type Section = "menu" | "stats" | "user" | "broadcast" | "tickets" | "payments" | "promos" | "apikey" | "users";

interface AdminUser {
  userId: number;
  username: string | null;
  firstName: string | null;
  balanceRub: number;
  freeRequests: number;
  banned: boolean;
  refBy: number | null;
  chatMode: string;
  createdAt: number;
  referrals: number;
  wallets: { modelKey: string; title: string; remaining: number }[];
}

export default function AdminPanel({ ctx, open, onClose }: { ctx: AppCtx; open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<Section>("menu");
  useEffect(() => {
    if (!open) setSection("menu");
  }, [open]);
  const titles: Record<Section, string> = {
    menu: "Админ-панель",
    stats: "Статистика",
    user: "Пользователь",
    users: "Пользователи",
    broadcast: "Рассылка",
    tickets: "Тикеты",
    payments: "Платежи",
    promos: "Промокоды",
    apikey: "Ключ ForgetAPI",
  };
  const back = () => (section === "menu" ? onClose() : setSection("menu"));
  const go = (s: Section) => {
    haptic();
    setSection(s);
  };
  return (
    <Sheet open={open} onClose={back} title={titles[section]}>
      {section === "menu" && (
        <Card>
          <Row icon="📊" title="Статистика" onClick={() => go("stats")} />
          <Row icon="🔍" title="Найти пользователя" subtitle="Баланс, токены, бан, сообщение" onClick={() => go("user")} />
          <Row icon="👥" title="Пользователи" subtitle="Последние регистрации" onClick={() => go("users")} />
          <Row icon="🎫" title="Тикеты" onClick={() => go("tickets")} />
          <Row icon="🧾" title="Платежи" onClick={() => go("payments")} />
          <Row icon="📣" title="Рассылка" onClick={() => go("broadcast")} />
          <Row icon="🎁" title="Промокоды" onClick={() => go("promos")} />
          <Row icon="⚙️" title="Ключ ForgetAPI" onClick={() => go("apikey")} last />
        </Card>
      )}
      {section === "stats" && <Stats />}
      {section === "user" && <UserTool ctx={ctx} />}
      {section === "users" && <Users />}
      {section === "tickets" && <Tickets ctx={ctx} />}
      {section === "payments" && <Payments />}
      {section === "broadcast" && <Broadcast ctx={ctx} />}
      {section === "promos" && <Promos ctx={ctx} />}
      {section === "apikey" && <ApiKey ctx={ctx} />}
    </Sheet>
  );
}

function useSection<T>(section: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = () => api<T>(`/api/app/admin?section=${section}`).then(setData).catch((e) => setErr(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), deps);
  return { data, err, reload, setData };
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl bg-tg-section p-3">
      <div className="text-[12px] text-tg-hint">{label}</div>
      <div className="text-[20px] font-bold">{value}</div>
    </div>
  );
}

function Stats() {
  const { data, err } = useSection<{ users: number; openTickets: number; paymentsCount: number; paymentsSum: number; purchasesCount: number; purchasesSum: number; apiKeySet: boolean; plategaConfigured: boolean }>("stats");
  if (err) return <Empty icon="⚠️" text={err} />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Stat label="Пользователей" value={data.users} />
        <Stat label="Открытых тикетов" value={data.openTickets} />
        <Stat label="Пополнений" value={`${data.paymentsCount} · ${fmtRub(data.paymentsSum)}`} />
        <Stat label="Покупок пакетов" value={`${data.purchasesCount} · ${fmtRub(data.purchasesSum)}`} />
      </div>
      <Card>
        <Row title="Ключ ForgetAPI" right={data.apiKeySet ? <Badge color="green">задан</Badge> : <Badge color="red">не задан</Badge>} />
        <Row title="Platega" right={data.plategaConfigured ? <Badge color="green">настроена</Badge> : <Badge color="red">не настроена</Badge>} last />
      </Card>
    </>
  );
}

function UserCard({ u }: { u: AdminUser }) {
  return (
    <Card className="mb-3">
      <Row title={<span className="font-semibold">{u.firstName ?? "—"} {u.username ? `@${u.username}` : ""}</span>} subtitle={`ID ${u.userId} · с ${fmtDate(u.createdAt)}`} right={u.banned ? <Badge color="red">бан</Badge> : <Badge color="green">активен</Badge>} />
      <Row title="Баланс" right={<b className="text-tg-text">{fmtRub(u.balanceRub)}</b>} />
      <Row title="Бесплатных запросов" right={u.freeRequests} />
      <Row title="Рефералов / реферер" right={`${u.referrals} / ${u.refBy ?? "—"}`} />
      <Row title="Токены" subtitle={u.wallets.length ? u.wallets.map((w) => `${w.title}: ${fmtNum(w.remaining)}`).join(" · ") : "нет"} last />
    </Card>
  );
}

function UserTool({ ctx }: { ctx: AppCtx }) {
  const [q, setQ] = useState("");
  const [u, setU] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [tokens, setTokens] = useState("");
  const [modelKey, setModelKey] = useState(ctx.models.models[0]?.key ?? "");
  const [msg, setMsg] = useState("");

  async function find() {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const r = await api<{ user: AdminUser }>(`/api/app/admin?section=user&q=${encodeURIComponent(q.trim())}`);
      setU(r.user);
    } catch (e) {
      ctx.toast((e as Error).message, "err");
      setU(null);
    } finally {
      setLoading(false);
    }
  }
  async function act(body: Record<string, unknown>, okText: string) {
    try {
      const r = await api<{ user?: AdminUser; ok?: boolean }>("/api/app/admin", { method: "POST", body: JSON.stringify({ ...body, user: String(u!.userId) }) });
      if (r.user) setU(r.user);
      ctx.toast(okText);
    } catch (e) {
      ctx.toast((e as Error).message, "err");
    }
  }
  return (
    <>
      <div className="mb-3 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ID или @username" onKeyDown={(e) => e.key === "Enter" && find()} />
        <Button loading={loading} onClick={find}>
          Найти
        </Button>
      </div>
      {u && (
        <>
          <UserCard u={u} />
          <div className="mb-2 text-[12px] font-medium uppercase text-tg-hint">Баланс (₽, можно отрицательное)</div>
          <div className="mb-3 flex gap-2">
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" />
            <Button disabled={!Number(amount)} onClick={() => act({ action: "give_balance", amount: Number(amount) }, "Баланс изменён")}>
              Начислить
            </Button>
          </div>
          <div className="mb-2 text-[12px] font-medium uppercase text-tg-hint">Выдать токены</div>
          <div className="mb-3 flex gap-2">
            <select value={modelKey} onChange={(e) => setModelKey(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-tg-separator bg-tg-section px-3 py-3 text-[14px]">
              {ctx.models.models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.title}
                </option>
              ))}
            </select>
            <Input type="number" value={tokens} onChange={(e) => setTokens(e.target.value)} placeholder="10000" className="!w-28" />
            <Button disabled={!(Number(tokens) > 0)} onClick={() => act({ action: "give_tokens", modelKey, tokens: Number(tokens) }, "Токены выданы")}>
              ОК
            </Button>
          </div>
          <div className="mb-2 text-[12px] font-medium uppercase text-tg-hint">Сообщение от бота</div>
          <Textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Текст (HTML разрешён)" className="mb-2" />
          <div className="mb-3 flex gap-2">
            <Button className="flex-1" disabled={!msg.trim()} onClick={() => act({ action: "message", text: msg }, "Отправлено").then(() => setMsg(""))}>
              Отправить
            </Button>
            <Button variant={u.banned ? "secondary" : "danger"} className="flex-1" onClick={() => act({ action: "ban" }, u.banned ? "Разбанен" : "Забанен")}>
              {u.banned ? "Разбанить" : "Забанить"}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function Users() {
  const { data, err } = useSection<{ total: number; users: AdminUser[] }>("users");
  if (err) return <Empty icon="⚠️" text={err} />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="mb-2 text-[13px] text-tg-hint">Всего: <b className="text-tg-text">{data.total}</b></div>
      <Card>
        {data.users.map((u, i) => (
          <Row key={u.userId} title={`${u.firstName ?? ""} ${u.username ? "@" + u.username : ""}`.trim() || String(u.userId)} subtitle={`ID ${u.userId} · ${fmtDate(u.createdAt)}`} right={<span>{fmtRub(u.balanceRub)}{u.banned ? " 🚫" : ""}</span>} last={i === data.users.length - 1} />
        ))}
      </Card>
    </>
  );
}

function Payments() {
  const { data, err } = useSection<{ transactions: { id: string; userId: number; amountRub: number; status: string; createdAt: number }[] }>("payments");
  if (err) return <Empty icon="⚠️" text={err} />;
  if (!data) return <Loading />;
  if (!data.transactions.length) return <Empty icon="💳" text="Платежей пока нет" />;
  return (
    <Card>
      {data.transactions.map((t, i) => (
        <Row
          key={t.id}
          title={fmtRub(t.amountRub)}
          subtitle={`ID ${t.userId} · ${fmtDate(t.createdAt)}`}
          right={t.status === "paid" ? <Badge color="green">оплачен</Badge> : t.status === "failed" ? <Badge color="red">отменён</Badge> : <Badge color="amber">ожидает</Badge>}
          last={i === data.transactions.length - 1}
        />
      ))}
    </Card>
  );
}

interface AdminTicket {
  id: number;
  userId: number;
  status: string;
  createdAt: number;
  messages: { id: number; sender: string; text: string; createdAt: number }[];
  user: { username: string | null; firstName: string | null } | null;
}

function Tickets({ ctx }: { ctx: AppCtx }) {
  const { data, err, reload } = useSection<{ tickets: AdminTicket[] }>("tickets");
  const [active, setActive] = useState<AdminTicket | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (err) return <Empty icon="⚠️" text={err} />;
  if (!data) return <Loading />;

  async function reply() {
    if (!active || !text.trim()) return;
    setBusy(true);
    try {
      await api("/api/app/admin", { method: "POST", body: JSON.stringify({ action: "ticket_reply", ticketId: active.id, text }) });
      ctx.toast("Ответ отправлен");
      setText("");
      await reload();
      setActive(null);
    } catch (e) {
      ctx.toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (!active) return;
    setBusy(true);
    await api("/api/app/admin", { method: "POST", body: JSON.stringify({ action: "ticket_close", ticketId: active.id }) }).catch(() => {});
    ctx.toast("Тикет закрыт");
    await reload();
    setActive(null);
    setBusy(false);
  }

  if (active) {
    return (
      <>
        <button onClick={() => setActive(null)} className="mb-2 text-[14px] text-tg-link">
          ‹ К списку
        </button>
        <div className="mb-2 text-[13px] text-tg-hint">
          Тикет #{active.id} · пользователь {active.userId} {active.user?.username ? `(@${active.user.username})` : ""}
        </div>
        <div className="mb-3 space-y-2">
          {active.messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === "admin" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[14px] ${m.sender === "admin" ? "bg-tg-button text-tg-button-text" : "bg-tg-section"}`}>
                <div className="whitespace-pre-wrap">{m.text}</div>
                <div className="mt-0.5 text-[10px] opacity-60">{fmtDate(m.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответ пользователю..." className="mb-2" />
        <div className="flex gap-2">
          <Button className="flex-1" loading={busy} disabled={!text.trim()} onClick={reply}>
            Ответить
          </Button>
          <Button variant="danger" loading={busy} onClick={close}>
            Закрыть
          </Button>
        </div>
      </>
    );
  }
  if (!data.tickets.length) return <Empty icon="🎫" text="Открытых тикетов нет" />;
  return (
    <Card>
      {data.tickets.map((t, i) => (
        <Row key={t.id} title={`#${t.id} · ${t.user?.firstName ?? t.userId}`} subtitle={t.messages[t.messages.length - 1]?.text.slice(0, 70)} onClick={() => setActive(t)} last={i === data.tickets.length - 1} />
      ))}
    </Card>
  );
}

function Broadcast({ ctx }: { ctx: AppCtx }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    const w = window as unknown as { Telegram?: { WebApp?: { showConfirm?: (m: string, cb: (ok: boolean) => void) => void } } };
    const confirmFn = w.Telegram?.WebApp?.showConfirm;
    const ok = await new Promise<boolean>((res) => (confirmFn ? confirmFn("Отправить рассылку всем пользователям?", res) : res(confirm("Отправить рассылку всем пользователям?"))));
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ sent: number; failed: number }>("/api/app/admin", { method: "POST", body: JSON.stringify({ action: "broadcast", text }) });
      ctx.toast(`Отправлено ${r.sent}, ошибок ${r.failed}`);
      setText("");
    } catch (e) {
      ctx.toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Текст рассылки (HTML: <b>, <i>, <a href>)" className="mb-2" />
      <Button className="w-full" loading={busy} disabled={!text.trim()} onClick={send}>
        📣 Отправить всем
      </Button>
      <p className="mt-2 text-center text-[12px] text-tg-hint">Отправка идёт ~20 сообщений в секунду, на большой базе займёт время — не закрывай окно.</p>
    </>
  );
}

function Promos({ ctx }: { ctx: AppCtx }) {
  const { data, err, setData } = useSection<{ promos: { code: string; bonusRub: number; maxUses: number; usedCount: number; active: boolean }[] }>("promos");
  const [code, setCode] = useState("");
  const [bonus, setBonus] = useState("");
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  if (err) return <Empty icon="⚠️" text={err} />;
  if (!data) return <Loading />;
  async function create() {
    setBusy(true);
    try {
      const r = await api<{ promos: typeof data extends null ? never : NonNullable<typeof data>["promos"] }>("/api/app/admin", {
        method: "POST",
        body: JSON.stringify({ action: "promo_create", code, bonusRub: Number(bonus), maxUses: Number(max) }),
      });
      setData({ promos: r.promos });
      ctx.toast("Промокод создан");
      setCode("");
      setBonus("");
      setMax("");
    } catch (e) {
      ctx.toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }
  async function off(c: string) {
    const r = await api<{ promos: NonNullable<typeof data>["promos"] }>("/api/app/admin", { method: "POST", body: JSON.stringify({ action: "promo_off", code: c }) });
    setData({ promos: r.promos });
  }
  return (
    <>
      <div className="mb-2 grid grid-cols-3 gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="КОД" />
        <Input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="₽" />
        <Input type="number" value={max} onChange={(e) => setMax(e.target.value)} placeholder="Активаций" />
      </div>
      <Button className="mb-4 w-full" loading={busy} disabled={!code || !(Number(bonus) > 0) || !(Number(max) > 0)} onClick={create}>
        Создать промокод
      </Button>
      {data.promos.length === 0 ? (
        <Empty icon="🎁" text="Промокодов пока нет" />
      ) : (
        <Card>
          {data.promos.map((p, i) => (
            <Row
              key={p.code}
              title={<span className="font-mono">{p.code}</span>}
              subtitle={`${fmtRub(p.bonusRub)} · ${p.usedCount}/${p.maxUses}`}
              right={
                p.active ? (
                  <button onClick={() => off(p.code)} className="text-[13px] text-tg-destructive">
                    Отключить
                  </button>
                ) : (
                  <Badge>выкл</Badge>
                )
              }
              last={i === data.promos.length - 1}
            />
          ))}
        </Card>
      )}
    </>
  );
}

function ApiKey({ ctx }: { ctx: AppCtx }) {
  const { data, reload } = useSection<{ fromDb: boolean; tail: string | null }>("apikey");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api("/api/app/admin", { method: "POST", body: JSON.stringify({ action: "set_apikey", key }) });
      ctx.toast("Ключ сохранён");
      setKey("");
      await reload();
    } catch (e) {
      ctx.toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card className="mb-3">
        <Row title="Текущий ключ" subtitle={data ? (data.fromDb ? `из базы, ···${data.tail}` : "из .env (FORGETAPI_KEY) или не задан") : "..."} last />
      </Card>
      <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Новый ключ ForgetAPI" className="mb-2" />
      <Button className="w-full" loading={busy} disabled={!key.trim()} onClick={save}>
        Сохранить
      </Button>
      <p className="mt-2 text-center text-[12px] text-tg-hint">Ключ из базы имеет приоритет над .env и применяется сразу, без перезапуска.</p>
    </>
  );
}
