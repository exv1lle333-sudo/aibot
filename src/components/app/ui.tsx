"use client";

import { useEffect, type ReactNode, type ButtonHTMLAttributes } from "react";
import { tg } from "./tg";

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl bg-tg-section shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${onClick ? "active:opacity-70 transition-opacity cursor-pointer" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="px-4 pt-4 pb-1.5 text-[13px] font-medium uppercase tracking-wide text-tg-hint">{children}</div>;
}

export function Row({
  icon,
  title,
  subtitle,
  right,
  onClick,
  last,
  danger,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  last?: boolean;
  danger?: boolean;
}) {
  return (
    <div onClick={onClick} className={`flex items-center gap-3 px-4 py-3 ${onClick ? "active:bg-black/5 cursor-pointer" : ""} ${last ? "" : "border-b border-tg-separator"}`}>
      {icon && <div className="flex h-8 w-8 shrink-0 items-center justify-center text-xl">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[15px] ${danger ? "text-tg-destructive" : ""}`}>{title}</div>
        {subtitle && <div className="truncate text-[13px] text-tg-hint">{subtitle}</div>}
      </div>
      {right !== undefined && <div className="shrink-0 text-[15px] text-tg-hint">{right}</div>}
      {onClick && right === undefined && <span className="text-tg-hint">›</span>}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  loading,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; loading?: boolean }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";
  const styles = {
    primary: "bg-tg-button text-tg-button-text",
    secondary: "bg-tg-secondary text-tg-text",
    ghost: "bg-transparent text-tg-link",
    danger: "bg-tg-destructive/10 text-tg-destructive",
  }[variant];
  return (
    <button className={`${base} ${styles} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Spinner size={18} /> : children}
    </button>
  );
}

export function Spinner({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ text = "Загрузка..." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-tg-hint">
      <Spinner size={28} />
      <div className="text-sm">{text}</div>
    </div>
  );
}

export function Empty({ icon = "🗒", text }: { icon?: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-tg-hint">
      <div className="text-4xl">{icon}</div>
      <div className="text-sm">{text}</div>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const w = tg();
    const bb = w?.BackButton;
    if (bb) {
      bb.show();
      bb.onClick(onClose);
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      if (bb) {
        bb.offClick(onClose);
        bb.hide();
      }
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="sheet-enter max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-tg-secondary pb-[calc(16px+var(--safe-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-tg-secondary px-4 pt-3 pb-2">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-tg-hint/40" />
          <div className="flex items-center justify-between">
            <div className="text-[17px] font-semibold">{title}</div>
            <button onClick={onClose} className="rounded-full bg-tg-section px-3 py-1 text-sm text-tg-hint">
              Закрыть
            </button>
          </div>
        </div>
        <div className="px-4">{children}</div>
      </div>
    </div>
  );
}

export function Input({ className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-xl border border-tg-separator bg-tg-section px-4 py-3 text-[15px] outline-none placeholder:text-tg-hint focus:border-tg-link ${className}`}
      {...rest}
    />
  );
}

export function Textarea({ className = "", ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full resize-none rounded-xl border border-tg-separator bg-tg-section px-4 py-3 text-[15px] outline-none placeholder:text-tg-hint focus:border-tg-link ${className}`}
      {...rest}
    />
  );
}

export function Toast({ toast }: { toast: { text: string; kind: "ok" | "err" } | null }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
      <div className={`max-w-sm rounded-xl px-4 py-2.5 text-sm text-white shadow-lg ${toast.kind === "ok" ? "bg-emerald-600" : "bg-red-600"}`}>{toast.text}</div>
    </div>
  );
}

export function Badge({ children, color = "gray" }: { children: ReactNode; color?: "gray" | "green" | "blue" | "red" | "amber" }) {
  const c = {
    gray: "bg-tg-secondary text-tg-hint",
    green: "bg-emerald-500/15 text-emerald-600",
    blue: "bg-tg-link/15 text-tg-link",
    red: "bg-red-500/15 text-red-600",
    amber: "bg-amber-500/15 text-amber-600",
  }[color];
  return <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${c}`}>{children}</span>;
}
