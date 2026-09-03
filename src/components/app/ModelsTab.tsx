"use client";

import { useMemo, useState } from "react";
import type { AppCtx } from "./App";
import type { ModelPublic } from "./types";
import { api, ApiError, fmtNum, fmtRub, haptic } from "./tg";
import { Card, Row, SectionTitle, Sheet, Button, Badge } from "./ui";
import TopupSheet from "./TopupSheet";

export default function ModelsTab({ ctx, openedModel, setOpenedModel }: { ctx: AppCtx; openedModel: string | null; setOpenedModel: (k: string | null) => void }) {
  const { models, me } = ctx;
  const grouped = useMemo(
    () => models.categories.map((c) => ({ ...c, list: models.models.filter((m) => m.category === c.key) })).filter((c) => c.list.length),
    [models],
  );
  const opened = models.models.find((m) => m.key === openedModel) ?? null;

  return (
    <div className="h-full overflow-y-auto pb-4">
      <div className="px-4 pt-4">
        <h1 className="text-[22px] font-bold">Модели</h1>
        <p className="text-[13px] text-tg-hint">Баланс: <b className="text-tg-text">{fmtRub(me.balanceRub)}</b>. Токены покупаются отдельно под каждую модель.</p>
      </div>
      {grouped.map((c) => (
        <div key={c.key}>
          <SectionTitle>{c.title}</SectionTitle>
          <div className="px-4">
            <Card>
              {c.list.map((m, i) => (
                <Row
                  key={m.key}
                  icon={m.emoji}
                  title={m.title}
                  subtitle={m.short}
                  right={
                    m.remaining > 0 ? (
                      <Badge color="green">{m.kind === "image" ? `${Math.floor(m.remaining / m.maxTokensPerGeneration)} 🖼` : fmtNum(m.remaining)}</Badge>
                    ) : (
                      <span className="text-[13px]">{m.kind === "image" ? `от ${fmtRub(m.pricePerGeneration ?? 0)}/шт` : `${fmtRub(m.packages[0].price)}+`}</span>
                    )
                  }
                  onClick={() => {
                    haptic();
                    setOpenedModel(m.key);
                  }}
                  last={i === c.list.length - 1}
                />
              ))}
            </Card>
          </div>
        </div>
      ))}
      <ModelSheet ctx={ctx} model={opened} onClose={() => setOpenedModel(null)} />
    </div>
  );
}

function ModelSheet({ ctx, model, onClose }: { ctx: AppCtx; model: ModelPublic | null; onClose: () => void }) {
  const { me, toast, refresh, setChatModel, setTab } = ctx;
  const [buying, setBuying] = useState<number | null>(null);
  const [topup, setTopup] = useState<number | null>(null);

  if (!model) return null;

  async function buy(tokens: number, price: number) {
    if (!model) return;
    if (me.balanceRub < price) {
      haptic("error");
      setTopup(Math.max(me.config.minTopupRub, Math.ceil(price - me.balanceRub)));
      return;
    }
    setBuying(tokens);
    try {
      await api("/api/app/buy", { method: "POST", body: JSON.stringify({ modelKey: model.key, tokens }) });
      await refresh();
      toast(`Куплено ${fmtNum(tokens)} токенов`);
    } catch (e) {
      const err = e as ApiError;
      if (err.data?.reason === "not_enough") setTopup(Math.max(me.config.minTopupRub, Math.ceil(err.data.missing ?? 0)));
      else toast(err.message, "err");
    } finally {
      setBuying(null);
    }
  }

  const gens = (t: number) => Math.round(t / model.maxTokensPerGeneration);

  return (
    <Sheet open={Boolean(model)} onClose={onClose} title={`${model.emoji} ${model.title}`}>
      <p className="mb-3 text-[14px] leading-relaxed text-tg-text/90">{model.description}</p>
      <Card className="mb-3">
        <Row title="Цена за 1 000 000 токенов" right={<b className="text-tg-text">{fmtRub(model.sellRubPer1m)}</b>} />
        {model.kind === "image" && <Row title="Одна генерация" subtitle={`${fmtNum(model.maxTokensPerGeneration)} токенов`} right={<b className="text-tg-text">≈ {fmtRub(model.pricePerGeneration ?? 0)}</b>} />}
        <Row
          title="Твой остаток"
          right={<b className={model.remaining > 0 ? "text-emerald-600" : "text-tg-hint"}>{model.kind === "image" ? `${gens(model.remaining)} генераций` : `${fmtNum(model.remaining)} ток.`}</b>}
        />
        <Row title="Баланс" right={<b className="text-tg-text">{fmtRub(me.balanceRub)}</b>} last />
      </Card>

      <Button
        className="mb-4 w-full"
        onClick={() => {
          setChatModel(model.key);
          onClose();
          setTab("chat");
        }}
      >
        💬 Начать диалог
      </Button>

      <div className="mb-2 text-[13px] font-medium uppercase text-tg-hint">Пакеты токенов</div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {model.packages.map((p) => {
          const enough = me.balanceRub >= p.price;
          return (
            <button
              key={p.tokens}
              onClick={() => buy(p.tokens, p.price)}
              disabled={buying !== null}
              className={`flex flex-col items-start rounded-2xl border p-3 text-left transition active:scale-[0.98] ${enough ? "border-tg-link/40 bg-tg-section" : "border-tg-separator bg-tg-section opacity-80"}`}
            >
              <span className="text-[15px] font-semibold">{model.kind === "image" && p.tokens < 1_000_000 ? `${gens(p.tokens)} 🖼` : fmtNum(p.tokens)}</span>
              <span className="text-[12px] text-tg-hint">{model.kind === "image" && p.tokens < 1_000_000 ? `${fmtNum(p.tokens)} ток.` : "токенов"}</span>
              <span className={`mt-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold ${enough ? "bg-tg-button text-tg-button-text" : "bg-tg-secondary text-tg-hint"}`}>
                {buying === p.tokens ? "..." : fmtRub(p.price)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mb-2 text-center text-[12px] text-tg-hint">Не хватает баланса? Нажми на пакет — предложим пополнить на недостающую сумму.</p>
      <TopupSheet ctx={ctx} open={topup !== null} suggested={topup ?? undefined} onClose={() => setTopup(null)} />
    </Sheet>
  );
}
