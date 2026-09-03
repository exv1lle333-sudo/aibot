"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, tg, inTelegram, haptic, openLink } from "./tg";
import type { Me, ModelsResponse, Tab } from "./types";
import { Loading, Toast, Button } from "./ui";
import ChatTab from "./ChatTab";
import ModelsTab from "./ModelsTab";
import CabinetTab from "./CabinetTab";
import MoreTab from "./MoreTab";

export interface AppCtx {
  me: Me;
  models: ModelsResponse;
  refresh: () => Promise<void>;
  toast: (text: string, kind?: "ok" | "err") => void;
  setTab: (t: Tab) => void;
  openModel: (key: string | null) => void;
  chatModel: string | null;
  setChatModel: (key: string) => void;
}

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "chat", label: "Чат", icon: "💬" },
  { key: "models", label: "Модели", icon: "🤖" },
  { key: "cabinet", label: "Кабинет", icon: "👤" },
  { key: "more", label: "Ещё", icon: "☰" },
];

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [toastState, setToastState] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [openedModel, setOpenedModel] = useState<string | null>(null);
  const [chatModel, setChatModelState] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notTelegram, setNotTelegram] = useState(false);

  const toast = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    haptic(kind === "ok" ? "success" : "error");
    setToastState({ text, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState(null), 2600);
  }, []);

  const refresh = useCallback(async () => {
    const [m, ms] = await Promise.all([api<Me>("/api/app/me"), api<ModelsResponse>("/api/app/models")]);
    setMe(m);
    setModels(ms);
    setChatModelState((cur) => cur ?? m.activeModel ?? ms.models.find((x) => x.remaining > 0)?.key ?? "gemini-3.1-flash-lite");
  }, []);

  useEffect(() => {
    const w = tg();
    if (w) {
      w.ready();
      w.expand();
      w.disableVerticalSwipes?.();
      try {
        w.setHeaderColor?.("secondary_bg_color");
      } catch {}
    }
    refresh().catch((e) => {
      if (!inTelegram() && e?.status === 401) setNotTelegram(true);
      else setError(e?.message ?? "Не удалось загрузить данные");
    });
  }, [refresh]);

  const setChatModel = useCallback((key: string) => {
    setChatModelState(key);
    api("/api/app/mode", { method: "POST", body: JSON.stringify({ activeModel: key }) }).catch(() => {});
  }, []);

  const openModel = useCallback((key: string | null) => {
    setOpenedModel(key);
    if (key) setTab("models");
  }, []);

  if (notTelegram) return <NotInTelegram />;
  if (error)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-4xl">😵</div>
        <div className="text-[15px]">{error}</div>
        <Button onClick={() => location.reload()}>Обновить</Button>
      </div>
    );
  if (!me || !models) return <Loading />;

  const ctx: AppCtx = { me, models, refresh, toast, setTab, openModel, chatModel, setChatModel };

  return (
    <div className="mx-auto flex h-[100dvh] max-w-lg flex-col bg-tg-secondary">
      {me.config.demo && !inTelegram() && (
        <div className="bg-amber-500/15 px-4 py-1.5 text-center text-[12px] text-amber-700">Демо-режим: открыто вне Telegram (MINIAPP_DEMO=1)</div>
      )}
      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === "chat" && <ChatTab ctx={ctx} />}
        {tab === "models" && <ModelsTab ctx={ctx} openedModel={openedModel} setOpenedModel={setOpenedModel} />}
        {tab === "cabinet" && <CabinetTab ctx={ctx} />}
        {tab === "more" && <MoreTab ctx={ctx} />}
      </main>
      <nav className="flex shrink-0 border-t border-tg-separator bg-tg-section pb-[var(--safe-bottom)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              haptic();
              setTab(t.key);
              if (t.key !== "models") setOpenedModel(null);
            }}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition ${tab === t.key ? "text-tg-link" : "text-tg-hint"}`}
          >
            <span className={`text-[22px] leading-none ${tab === t.key ? "" : "grayscale opacity-70"}`}>{t.icon}</span>
            <span className="font-medium">{t.label}</span>
          </button>
        ))}
      </nav>
      <Toast toast={toastState} />
    </div>
  );
}

function NotInTelegram() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="text-6xl">🤖</div>
      <h1 className="text-2xl font-bold">AI Bot — мини-приложение</h1>
      <p className="text-tg-hint">
        Claude, GPT, Gemini и генерация картинок в одном месте. Приложение работает внутри Telegram — открой бота и нажми кнопку «Приложение».
      </p>
      <Button onClick={() => openLink("https://t.me/")}>Открыть Telegram</Button>
      <p className="text-xs text-tg-hint">Для локальной проверки вне Telegram задай MINIAPP_DEMO=1 в .env</p>
    </div>
  );
}
