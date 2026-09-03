"use client";

import { useEffect, useState } from "react";
import type { AppCtx } from "./App";
import { api, fmtRub, haptic, openLink } from "./tg";
import { Sheet, Button, Input } from "./ui";

const QUICK = [100, 300, 500, 1000, 3000, 5000];

export default function TopupSheet({ ctx, open, onClose, suggested }: { ctx: AppCtx; open: boolean; onClose: () => void; suggested?: number }) {
  const { me, toast, refresh } = ctx;
  const min = me.config.minTopupRub;
  const [amount, setAmount] = useState<string>(String(suggested ?? 500));
  const [loading, setLoading] = useState(false);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(String(suggested ?? 500));
      setPayUrl(null);
    }
  }, [open, suggested]);

  const num = Number(amount.replace(",", "."));
  const valid = Number.isFinite(num) && num >= min;

  async function create() {
    if (!valid) return;
    setLoading(true);
    try {
      const r = await api<{ url: string }>("/api/app/topup", { method: "POST", body: JSON.stringify({ amount: Math.floor(num) }) });
      setPayUrl(r.url);
      haptic("success");
      openLink(r.url);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setLoading(false);
    }
  }

  async function check() {
    setChecking(true);
    try {
      const r = await api<{ credited: number; balanceRub: number }>("/api/app/topup");
      await refresh();
      if (r.credited > 0) {
        toast("✅ Оплата зачислена!");
        onClose();
      } else toast("Оплата пока не найдена. Подожди минуту и проверь снова.", "err");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Пополнение баланса">
      {!payUrl ? (
        <>
          <div className="mb-3 text-[13px] text-tg-hint">Текущий баланс: <b className="text-tg-text">{fmtRub(me.balanceRub)}</b>. Минимум — {min} ₽.</div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {QUICK.filter((q) => q >= min).map((q) => (
              <button
                key={q}
                onClick={() => {
                  haptic();
                  setAmount(String(q));
                }}
                className={`rounded-xl border py-2.5 text-[15px] font-semibold transition ${Number(amount) === q ? "border-tg-link bg-tg-link/10 text-tg-link" : "border-tg-separator bg-tg-section"}`}
              >
                {q} ₽
              </button>
            ))}
          </div>
          <Input type="number" inputMode="numeric" min={min} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Своя сумма, от ${min} ₽`} className="mb-3" />
          <Button className="w-full" disabled={!valid} loading={loading} onClick={create}>
            Перейти к оплате {valid ? fmtRub(Math.floor(num)) : ""}
          </Button>
          <p className="mt-3 text-center text-[12px] text-tg-hint">Оплата через Platega (СБП / карты). После оплаты баланс пополнится автоматически.</p>
        </>
      ) : (
        <>
          <div className="mb-4 rounded-2xl bg-tg-section p-4 text-center">
            <div className="mb-1 text-3xl">💳</div>
            <div className="text-[15px] font-semibold">Счёт на {fmtRub(Math.floor(num))} создан</div>
            <div className="text-[13px] text-tg-hint">Если страница оплаты не открылась — нажми кнопку ниже.</div>
          </div>
          <Button className="mb-2 w-full" onClick={() => openLink(payUrl)}>
            Открыть страницу оплаты
          </Button>
          <Button variant="secondary" className="w-full" loading={checking} onClick={check}>
            🔄 Я оплатил — проверить
          </Button>
        </>
      )}
    </Sheet>
  );
}
