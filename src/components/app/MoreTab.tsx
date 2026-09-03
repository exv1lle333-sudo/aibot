"use client";

import { useEffect, useState } from "react";
import type { AppCtx } from "./App";
import { api, fmtDate, haptic, openLink, tg } from "./tg";
import { Card, Row, SectionTitle, Sheet, Button, Textarea, Badge, Loading, Empty } from "./ui";
import AdminPanel from "./AdminPanel";

export default function MoreTab({ ctx }: { ctx: AppCtx }) {
  const { me } = ctx;
  const [support, setSupport] = useState(false);
  const [referral, setReferral] = useState(false);
  const [admin, setAdmin] = useState(false);
  const c = me.config;

  return (
    <div className="h-full overflow-y-auto pb-4">
      <div className="px-4 pt-4">
        <h1 className="text-[22px] font-bold">Ещё</h1>
      </div>
      <SectionTitle>Помощь</SectionTitle>
      <div className="px-4">
        <Card>
          <Row icon="🛟" title="Поддержка" subtitle="Тикеты — ответим прямо в боте" onClick={() => setSupport(true)} />
          <Row icon="👥" title="Рефералы" subtitle={`Приглашено: ${me.referrals}`} onClick={() => setReferral(true)} last={!c.channelUrl} />
          {c.channelUrl && <Row icon="📢" title="Наш канал" onClick={() => openLink(c.channelUrl)} last />}
        </Card>
      </div>
      {(c.userAgreementUrl || c.privacyPolicyUrl) && (
        <>
          <SectionTitle>Документы</SectionTitle>
          <div className="px-4">
            <Card>
              {c.userAgreementUrl && <Row icon="📄" title="Пользовательское соглашение" onClick={() => openLink(c.userAgreementUrl)} last={!c.privacyPolicyUrl} />}
              {c.privacyPolicyUrl && <Row icon="🔒" title="Политика конфиденциальности" onClick={() => openLink(c.privacyPolicyUrl)} last />}
            </Card>
          </div>
        </>
      )}
      {me.isAdmin && (
        <>
          <SectionTitle>Администрирование</SectionTitle>
          <div className="px-4">
            <Card>
              <Row icon="🛠" title="Админ-панель" subtitle="Пользователи, платежи, тикеты, промокоды" onClick={() => setAdmin(true)} last />
            </Card>
          </div>
        </>
      )}
      <p className="mt-6 text-center text-[12px] text-tg-hint">ID {me.userId}{c.botUsername ? ` · @${c.botUsername}` : ""}</p>

      <SupportSheet ctx={ctx} open={support} onClose={() => setSupport(false)} />
      <ReferralSheet ctx={ctx} open={referral} onClose={() => setReferral(false)} />
      {me.isAdmin && <AdminPanel ctx={ctx} open={admin} onClose={() => setAdmin(false)} />}
    </div>
  );
}

// ---------------- рефералы ----------------
function ReferralSheet({ ctx, open, onClose }: { ctx: AppCtx; open: boolean; onClose: () => void }) {
  const { me, toast } = ctx;
  const link = me.referralLink;
  const share = () => {
    haptic();
    const text = "Попробуй ИИ-бота: Claude, GPT, Gemini и генерация картинок в Telegram 🤖";
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    tg() ? tg()!.openTelegramLink(url) : window.open(url, "_blank");
  };
  const copy = () => navigator.clipboard?.writeText(link).then(() => toast("Ссылка скопирована"));
  return (
    <Sheet open={open} onClose={onClose} title="Реферальная программа">
      <div className="mb-4 rounded-2xl bg-tg-section p-4">
        <div className="mb-2 text-[15px] font-semibold">За каждого приглашённого:</div>
        <div className="text-[14px]">🎟 <b>{me.config.referralFreeRequests}</b> бесплатных запросов к Gemini 3.1 Flash Lite</div>
        <div className="text-[14px]">💸 <b>{me.config.referralCommissionPercent}%</b> от каждой его покупки — на твой баланс</div>
      </div>
      <div className="mb-3 rounded-2xl bg-tg-section p-4 text-center">
        <div className="text-[13px] text-tg-hint">Приглашено</div>
        <div className="text-[32px] font-bold">{me.referrals}</div>
      </div>
      <div className="mb-3 break-all rounded-xl bg-tg-section px-3 py-2.5 font-mono text-[13px]">{link}</div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={copy}>
          Копировать
        </Button>
        <Button className="flex-1" onClick={share}>
          Поделиться
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------- поддержка ----------------
interface Ticket {
  id: number;
  status: string;
  createdAt: number;
  messages: { id: number; sender: string; text: string; createdAt: number }[];
}

function SupportSheet({ ctx, open, onClose }: { ctx: AppCtx; open: boolean; onClose: () => void }) {
  const { toast, me } = ctx;
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [active, setActive] = useState<Ticket | null>(null);
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);

  const load = () => api<{ tickets: Ticket[] }>("/api/app/tickets").then((r) => setTickets(r.tickets)).catch((e) => toast(e.message, "err"));
  useEffect(() => {
    if (open) load();
    else {
      setActive(null);
      setCreating(false);
      setText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api("/api/app/tickets", { method: "POST", body: JSON.stringify({ text, ticketId: active?.id }) });
      toast(active ? "Сообщение отправлено" : "Тикет создан — ответ придёт в бот");
      setText("");
      setCreating(false);
      const r = await api<{ tickets: Ticket[] }>("/api/app/tickets");
      setTickets(r.tickets);
      if (active) setActive(r.tickets.find((t) => t.id === active.id) ?? null);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSending(false);
    }
  }

  const title = active ? `Тикет #${active.id}` : creating ? "Новый тикет" : "Поддержка";
  const back = () => (active ? setActive(null) : creating ? setCreating(false) : onClose());

  return (
    <Sheet open={open} onClose={back} title={title}>
      {active ? (
        <>
          <div className="mb-3 space-y-2">
            {active.messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[14px] ${m.sender === "user" ? "bg-tg-button text-tg-button-text" : "bg-tg-section"}`}>
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  <div className="mt-0.5 text-[10px] opacity-60">{m.sender === "admin" ? "Поддержка · " : ""}{fmtDate(m.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
          {active.status === "open" ? (
            <>
              <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Написать в тикет..." className="mb-2" />
              <Button className="w-full" loading={sending} disabled={!text.trim()} onClick={submit}>
                Отправить
              </Button>
            </>
          ) : (
            <div className="rounded-xl bg-tg-section p-3 text-center text-[13px] text-tg-hint">Тикет закрыт. Если вопрос остался — создай новый.</div>
          )}
        </>
      ) : creating ? (
        <>
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Опиши проблему или вопрос как можно подробнее..." className="mb-2" autoFocus />
          <Button className="w-full" loading={sending} disabled={!text.trim()} onClick={submit}>
            Создать тикет
          </Button>
        </>
      ) : (
        <>
          <Button className="mb-3 w-full" onClick={() => setCreating(true)}>
            ✍️ Новый тикет
          </Button>
          {me.config.supportUsername && <p className="mb-3 text-center text-[12px] text-tg-hint">Контакт: {me.config.supportUsername}</p>}
          {!tickets ? (
            <Loading />
          ) : tickets.length === 0 ? (
            <Empty icon="🎫" text="Обращений пока нет" />
          ) : (
            <Card>
              {tickets.map((t, i) => (
                <Row
                  key={t.id}
                  title={`Тикет #${t.id}`}
                  subtitle={t.messages[t.messages.length - 1]?.text.slice(0, 60)}
                  right={t.status === "open" ? <Badge color="green">открыт</Badge> : <Badge>закрыт</Badge>}
                  onClick={() => setActive(t)}
                  last={i === tickets.length - 1}
                />
              ))}
            </Card>
          )}
        </>
      )}
    </Sheet>
  );
}
