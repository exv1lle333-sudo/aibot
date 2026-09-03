"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppCtx } from "./App";
import type { ChatMessage, ModelPublic } from "./types";
import { api, ApiError, compressImage, fileToBase64, fmtNum, haptic } from "./tg";
import { Sheet, Row, Card, Spinner, Button, Empty } from "./ui";
import { renderMarkdown } from "./markdown";

export default function ChatTab({ ctx }: { ctx: AppCtx }) {
  const { models, chatModel, setChatModel, toast, openModel, refresh } = ctx;
  const model = useMemo(() => models.models.find((m) => m.key === chatModel) ?? models.models[0], [models, chatModel]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ dataB64: string; mime: string; preview: string } | null>(null);
  const [file, setFile] = useState<{ name: string; mime: string; dataB64: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [remaining, setRemaining] = useState(model?.remaining ?? 0);
  const listRef = useRef<HTMLDivElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const scrollDown = useCallback((smooth = true) => {
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: smooth ? "smooth" : "auto" }));
  }, []);

  useEffect(() => {
    if (!model) return;
    setLoading(true);
    api<{ messages: ChatMessage[]; remaining: number }>(`/api/app/chat?model=${encodeURIComponent(model.key)}`)
      .then((r) => {
        setMessages(r.messages);
        setRemaining(r.remaining);
        scrollDown(false);
      })
      .catch((e) => toast(e.message, "err"))
      .finally(() => setLoading(false));
  }, [model, toast, scrollDown]);

  const canSend = (text.trim() || image || file) && !sending;

  async function send() {
    if (!model || !canSend) return;
    haptic("light");
    const userText = text.trim();
    const tempId = -Date.now();
    const userMsg: ChatMessage = {
      id: tempId,
      role: "user",
      content: userText || (image ? "📷 Фото" : file ? `📎 ${file.name}` : ""),
      imageB64: null,
      tokens: null,
      createdAt: Date.now() / 1000,
      attachments: image ? [{ kind: "image", filename: null, preview: image.preview }] : file ? [{ kind: "document", filename: file.name, preview: null }] : null,
    };
    const pendingMsg: ChatMessage = { id: tempId - 1, role: "assistant", content: "", imageB64: null, tokens: null, createdAt: Date.now() / 1000, attachments: null, pending: true };
    setMessages((m) => [...m, userMsg, pendingMsg]);
    setText("");
    const payload = { modelKey: model.key, text: userText, image, file };
    setImage(null);
    setFile(null);
    setSending(true);
    scrollDown();
    if (taRef.current) taRef.current.style.height = "auto";
    try {
      const r = await api<{ kind: "text" | "image"; answer?: string; image?: string; tokens: number; remaining: number }>("/api/app/chat", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setRemaining(r.remaining);
      setMessages((m) =>
        m.map((x) => (x.id === pendingMsg.id ? { ...x, pending: false, content: r.answer ?? "", imageB64: r.image ?? null, tokens: r.tokens } : x)),
      );
      haptic("success");
      refresh().catch(() => {});
    } catch (e) {
      const err = e as ApiError;
      setMessages((m) => m.map((x) => (x.id === pendingMsg.id ? { ...x, pending: false, error: err.message, content: "" } : x)));
      if (err.code === "no_tokens") toast("Токены закончились — купи пакет", "err");
      else toast(err.message, "err");
    } finally {
      setSending(false);
      scrollDown();
    }
  }

  async function clearHistory() {
    if (!model) return;
    await api(`/api/app/chat?model=${encodeURIComponent(model.key)}`, { method: "DELETE" });
    setMessages([]);
    toast("История очищена");
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFile(null);
    setImage(await compressImage(f));
  }
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast("Файл больше 10 МБ", "err");
    if (f.type.startsWith("image/")) return setImage(await compressImage(f));
    setImage(null);
    setFile({ name: f.name, mime: f.type || "application/octet-stream", dataB64: await fileToBase64(f) });
  }

  if (!model) return <Empty text="Нет доступных моделей" />;
  const noTokens = model.kind === "image" ? remaining < model.maxTokensPerGeneration : remaining < models.minTokensForText && !(model.referralEligible && ctx.me.freeRequests > 0);

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-tg-separator bg-tg-section px-3 py-2">
        <button onClick={() => setPickerOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left active:bg-black/5">
          <span className="text-2xl">{model.emoji}</span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold">{model.title}</span>
            <span className="block truncate text-[12px] text-tg-hint">
              {model.kind === "image" ? `${Math.floor(remaining / model.maxTokensPerGeneration)} генераций` : `${fmtNum(remaining)} токенов`}
              {model.referralEligible && ctx.me.freeRequests > 0 ? ` · ${ctx.me.freeRequests} беспл.` : ""} · нажми, чтобы сменить ▾
            </span>
          </span>
        </button>
        <button onClick={clearHistory} title="Очистить" className="rounded-xl px-2 py-2 text-xl active:bg-black/5">
          🧹
        </button>
      </div>

      {/* messages */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading ? (
          <div className="flex justify-center py-10 text-tg-hint">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-tg-hint">
            <div className="text-5xl">{model.emoji}</div>
            <div className="text-[15px] font-medium text-tg-text">{model.title}</div>
            <div className="text-[13px]">{model.kind === "image" ? "Опиши картинку — и я её нарисую. Можно прикрепить фото как референс." : model.short + ". Задай вопрос, прикрепи фото или файл."}</div>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
      </div>

      {/* no tokens banner */}
      {noTokens && !loading && (
        <div className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-xl bg-amber-500/15 px-3 py-2 text-[13px]">
          <span>Токены для этой модели закончились</span>
          <button onClick={() => openModel(model.key)} className="shrink-0 rounded-lg bg-tg-button px-3 py-1.5 font-semibold text-tg-button-text">
            Купить
          </button>
        </div>
      )}

      {/* composer */}
      <div className="border-t border-tg-separator bg-tg-section px-2 pt-2 pb-2">
        {(image || file) && (
          <div className="mb-2 flex items-center gap-2 px-1">
            {image && <img src={image.preview} alt="" className="h-14 w-14 rounded-lg object-cover" />}
            {file && <div className="rounded-lg bg-tg-secondary px-3 py-2 text-[13px]">📎 {file.name}</div>}
            <button
              onClick={() => {
                setImage(null);
                setFile(null);
              }}
              className="text-tg-hint"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input ref={imgInput} type="file" accept="image/*" hidden onChange={onPickImage} />
          <input ref={fileInput} type="file" hidden onChange={onPickFile} />
          <button onClick={() => imgInput.current?.click()} className="rounded-xl p-2 text-[22px] leading-none active:bg-black/5" title="Фото">
            📷
          </button>
          {model.kind === "text" && (
            <button onClick={() => fileInput.current?.click()} className="rounded-xl p-2 text-[22px] leading-none active:bg-black/5" title="Файл">
              📎
            </button>
          )}
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(140, e.target.scrollHeight) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={model.kind === "image" ? "Опиши картинку..." : "Сообщение..."}
            className="max-h-[140px] min-h-[42px] flex-1 resize-none rounded-2xl bg-tg-secondary px-4 py-2.5 text-[15px] outline-none placeholder:text-tg-hint"
          />
          <button
            onClick={send}
            disabled={!canSend}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-tg-button text-tg-button-text transition disabled:opacity-40 active:scale-95"
          >
            {sending ? <Spinner size={18} /> : <span className="text-lg">➤</span>}
          </button>
        </div>
      </div>

      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} models={models.models} current={model.key} onSelect={(k) => { setChatModel(k); setPickerOpen(false); }} />
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const isUser = m.role === "user";
  const copy = () => {
    navigator.clipboard?.writeText(m.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div className={`mb-2 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.45] ${isUser ? "rounded-br-md bg-tg-button text-tg-button-text" : "rounded-bl-md bg-tg-section"}`}>
        {m.attachments?.map((a, i) =>
          a.preview ? <img key={i} src={a.preview} alt="" className="mb-2 max-h-56 rounded-lg" /> : <div key={i} className="mb-1 text-[13px] opacity-80">📎 {a.filename}</div>,
        )}
        {m.pending ? (
          <span className="inline-flex gap-1 py-1 text-tg-hint">
            <span className="dot">●</span>
            <span className="dot">●</span>
            <span className="dot">●</span>
          </span>
        ) : m.error ? (
          <span className="text-tg-destructive">⚠️ {m.error}</span>
        ) : (
          <>
            {m.imageB64 && <img src={m.imageB64} alt="generated" className="mb-1 w-full rounded-lg" />}
            {m.content && (isUser ? <div className="whitespace-pre-wrap break-words">{m.content}</div> : <div className="msg-content break-words" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />)}
            {!isUser && m.content && (
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-tg-hint">
                <button onClick={copy}>{copied ? "✓ Скопировано" : "Копировать"}</button>
                {m.tokens ? <span>{fmtNum(m.tokens)} ток.</span> : null}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ModelPicker({ open, onClose, models, current, onSelect }: { open: boolean; onClose: () => void; models: ModelPublic[]; current: string; onSelect: (k: string) => void }) {
  const cats = useMemo(() => {
    const map = new Map<string, ModelPublic[]>();
    for (const m of models) map.set(m.categoryTitle, [...(map.get(m.categoryTitle) ?? []), m]);
    return [...map.entries()];
  }, [models]);
  return (
    <Sheet open={open} onClose={onClose} title="Выбор модели">
      {cats.map(([title, list]) => (
        <div key={title} className="mb-3">
          <div className="px-1 pb-1.5 text-[12px] font-medium uppercase text-tg-hint">{title}</div>
          <Card>
            {list.map((m, i) => (
              <Row
                key={m.key}
                icon={m.emoji}
                title={
                  <span className={m.key === current ? "font-semibold text-tg-link" : ""}>
                    {m.title} {m.key === current && "✓"}
                  </span>
                }
                subtitle={m.short}
                right={m.remaining > 0 ? <span className="text-emerald-600">{m.kind === "image" ? `${Math.floor(m.remaining / m.maxTokensPerGeneration)} 🖼` : fmtNum(m.remaining)}</span> : <span className="text-tg-hint">0</span>}
                onClick={() => onSelect(m.key)}
                last={i === list.length - 1}
              />
            ))}
          </Card>
        </div>
      ))}
      <Button variant="secondary" className="w-full" onClick={onClose}>
        Отмена
      </Button>
    </Sheet>
  );
}
