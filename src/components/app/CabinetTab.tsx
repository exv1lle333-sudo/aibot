"use client";

import { useEffect, useState } from "react";
import type { AppCtx } from "./App";
import { api, fmtDate, fmtNum, fmtRub, haptic, openLink } from "./tg";
import { Card, Row, SectionTitle, Sheet, Button, Input, Badge, Loading, Empty } from "./ui";
import TopupSheet from "./TopupSheet";

export default function CabinetTab({ ctx }: { ctx: AppCtx }) {
  const { me, toast, refresh, openModel } = ctx;
  const [topup, setTopup] = useState(false);
  const [promo, setPromo] = useState(false);
  const [history, setHistory] = useState(false);

  async function toggleMode() {
    const next = me.chatMode === "normal" ? "economy" : "normal";
    haptic();
    await api("/api/app/mode", { method: "POST", body: JSON.stringify({ chatMode: next }) });
    await refresh();
    toast(next === "economy" ? "Экономный режим: без истории" : "Обычный режим: с историей");
  }

  return (
    <div className="h-full overflow-y-auto pb-4">
      <div className="px-4 pt-4">
        <div className="rounded-3xl bg-gradient-to-br from-tg-button to-tg-button/70 p-5 text-tg-button-text shadow-lg">
          <div className="text-[13px] opacity-80">
            {me.firstName ?? "Пользователь"} {me.username ? `· @${me.username}` : ""} · ID {me.userId}
          </div>
          <div className="mt-1 text-[34px] font-bold leading-tight">{fmtRub(me.balanceRub)}</div>
          <div className="text-[13px] opacity-80">баланс для покупки пакетов</div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setTopup(true)} className="flex-1 rounded-xl bg-white/20 py-2.5 text-[14px] font-semibold backdrop-blur active:bg-white/30">
              ➕ Пополнить
            </button>
            <button onClick={() => setPromo(true)} className="flex-1 rounded-xl bg-white/20 py-2.5 text-[14px] font-semibold backdrop-blur active:bg-white/30">
              🎁 Промокод
            </button>
          </div>
        </div>
      </div>

      <SectionTitle>Мои токены</SectionTitle>
      <div className="px-4">
        <Card>
          {me.wallets.length === 0 && <Row title={<span className="text-tg-hint">Токенов пока нет — выбери модель в каталоге</span>} onClick={() => openModel(null)} last />}
          {me.wallets.map((w, i) => (
            <Row
              key={w.modelKey}
              icon={w.emoji}
              title={w.title}
              right={<Badge color="green">{fmtNum(w.remaining)}</Badge>}
              onClick={() => openModel(w.modelKey)}
              last={i === me.wallets.length - 1 && me.freeRequests === 0}
            />
          ))}
          {me.freeRequests > 0 && <Row icon="🎟" title="Бесплатные запросы" subtitle="Gemini 3.1 Flash Lite, за рефералов" right={<Badge color="blue">{me.freeRequests}</Badge>} last />}
        </Card>
      </div>

      <SectionTitle>Настройки</SectionTitle>
      <div className="px-4">
        <Card>
          <Row
            icon="⚙️"
            title="Режим диалога"
            subtitle={me.chatMode === "economy" ? "Экономный — без истории, дешевле" : "Обычный — модель помнит контекст"}
            right={
              <span className={`relative inline-block h-7 w-12 rounded-full transition ${me.chatMode === "economy" ? "bg-emerald-500" : "bg-tg-hint/30"}`}>
                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${me.chatMode === "economy" ? "left-[22px]" : "left-0.5"}`} />
              </span>
            }
            onClick={toggleMode}
          />
          <Row icon="🧾" title="История платежей и покупок" onClick={() => setHistory(true)} last />
        </Card>
      </div>

      <TopupSheet ctx={ctx} open={topup} onClose={() => setTopup(false)} />
      <PromoSheet ctx={ctx} open={promo} onClose={() => setPromo(false)} />
      <HistorySheet open={history} onClose={() => setHistory(false)} />
    </div>
  );
}

function PromoSheet({ ctx, open, onClose }: { ctx: AppCtx; open: boolean; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  async function redeem() {
    if (!code.trim()) return;
    setLoading(true);
    try {
      const r = await api<{ ok: boolean; message: string }>("/api/app/promo", { method: "POST", body: JSON.stringify({ code }) });
      ctx.toast(r.message);
      await ctx.refresh();
      setCode("");
      onClose();
    } catch (e) {
      ctx.toast((e as Error).message, "err");
    } finally {
      setLoading(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Промокод">
      <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Введи промокод" className="mb-3 uppercase" autoCapitalize="characters" />
      <Button className="w-full" loading={loading} disabled={!code.trim()} onClick={redeem}>
        Активировать
      </Button>
    </Sheet>
  );
}

interface HistoryData {
  transactions: { id: string; amountRub: number; status: string; createdAt: number; paymentUrl: string | null }[];
  purchases: { id: number; title: string; tokens: number; priceRub: number; createdAt: number }[];
}

function HistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<HistoryData | null>(null);
  useEffect(() => {
    if (!open) {
      setData(null);
      return;
    }
    let alive = true;
    api<HistoryData>("/api/app/history")
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ transactions: [], purchases: [] }));
    return () => {
      alive = false;
    };
  }, [open]);
  const st = (s: string) => (s === "paid" ? <Badge color="green">оплачен</Badge> : s === "failed" ? <Badge color="red">отменён</Badge> : <Badge color="amber">ожидает</Badge>);
  return (
    <Sheet open={open} onClose={onClose} title="История">
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-1.5 text-[12px] font-medium uppercase text-tg-hint">Пополнения</div>
          <Card className="mb-4">
            {data.transactions.length === 0 && <Empty icon="💳" text="Пополнений пока не было" />}
            {data.transactions.map((t, i) => (
              <Row
                key={t.id}
                title={fmtRub(t.amountRub)}
                subtitle={fmtDate(t.createdAt)}
                right={
                  <span className="flex items-center gap-2">
                    {st(t.status)}
                    {t.paymentUrl && (
                      <button onClick={() => openLink(t.paymentUrl!)} className="text-tg-link text-[13px]">
                        Оплатить
                      </button>
                    )}
                  </span>
                }
                last={i === data.transactions.length - 1}
              />
            ))}
          </Card>
          <div className="mb-1.5 text-[12px] font-medium uppercase text-tg-hint">Покупки пакетов</div>
          <Card>
            {data.purchases.length === 0 && <Empty icon="🛒" text="Покупок пока не было" />}
            {data.purchases.map((p, i) => (
              <Row key={p.id} title={`${fmtNum(p.tokens)} · ${p.title}`} subtitle={fmtDate(p.createdAt)} right={<b className="text-tg-text">{fmtRub(p.priceRub)}</b>} last={i === data.purchases.length - 1} />
            ))}
          </Card>
        </>
      )}
    </Sheet>
  );
}
