"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string }; start_param?: string };
  colorScheme: "light" | "dark";
  ready: () => void;
  expand: () => void;
  close: () => void;
  openLink: (url: string, opts?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  openInvoice?: (url: string, cb?: (status: string) => void) => void;
  showAlert?: (msg: string, cb?: () => void) => void;
  showConfirm?: (msg: string, cb?: (ok: boolean) => void) => void;
  HapticFeedback?: { impactOccurred: (s: "light" | "medium" | "heavy") => void; notificationOccurred: (t: "success" | "error" | "warning") => void };
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  MainButton?: { show: () => void; hide: () => void; setText: (t: string) => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  disableVerticalSwipes?: () => void;
  platform: string;
  version: string;
}

export function tg(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const w = (window as any).Telegram?.WebApp as TelegramWebApp | undefined;
  return w && w.initData !== undefined ? w : null;
}

export function inTelegram(): boolean {
  const w = tg();
  return Boolean(w && w.initData);
}

export function haptic(kind: "light" | "medium" | "success" | "error" = "light") {
  const h = tg()?.HapticFeedback;
  if (!h) return;
  if (kind === "success" || kind === "error") h.notificationOccurred(kind);
  else h.impactOccurred(kind);
}

export function openLink(url: string) {
  const w = tg();
  if (!w) return window.open(url, "_blank");
  if (/^https:\/\/t\.me\//.test(url)) w.openTelegramLink(url);
  else w.openLink(url);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  data: any;
  constructor(status: number, msg: string, data?: any) {
    super(msg);
    this.status = status;
    this.data = data;
    this.code = data?.code;
  }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const initData = tg()?.initData ?? "";
  if (initData) headers.Authorization = `tma ${initData}`;
  if (init.body && typeof init.body === "string") headers["Content-Type"] = "application/json";
  const r = await fetch(path, { ...init, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data?.error || data?.message || `Ошибка ${r.status}`, data);
  return data as T;
}

export const fmtNum = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
export const fmtRub = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? r.toString() : r.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
};
export const fmtDate = (ts: number) =>
  new Date(ts * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Сжимаем картинку перед отправкой (до 1600px, JPEG). */
export async function compressImage(file: File): Promise<{ dataB64: string; mime: string; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    return { dataB64: dataUrl.split(",")[1], mime: "image/jpeg", preview: dataUrl };
  } catch {
    const b64 = await fileToBase64(file);
    return { dataB64: b64, mime: file.type || "image/jpeg", preview: `data:${file.type};base64,${b64}` };
  } finally {
    URL.revokeObjectURL(url);
  }
}
