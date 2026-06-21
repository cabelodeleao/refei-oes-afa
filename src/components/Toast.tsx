"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  leaving: boolean;
}

interface ToastApi {
  show: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DURATION = 3000; // ms visível antes de sair
const LEAVE = 280; // ms da animação de saída

const STYLES: Record<ToastType, string> = {
  success:
    "bg-emerald-600 text-white ring-emerald-400/40 dark:bg-emerald-600",
  error: "bg-red-600 text-white ring-red-400/40 dark:bg-red-600",
  info: "bg-navy-700 text-white ring-navy-400/40 dark:bg-navy-600",
};

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t))
    );
    const t = setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, LEAVE);
    timers.current.set(id, t);
  }, []);

  const show = useCallback(
    (message: string, type: ToastType = "success") => {
      const id = ++seq.current;
      setToasts((prev) => [...prev, { id, type, message, leaving: false }]);
      const t = setTimeout(() => dismiss(id), DURATION);
      timers.current.set(id, t);
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const api: ToastApi = {
    show,
    success: (m) => show(m, "success"),
    error: (m) => show(m, "error"),
    info: (m) => show(m, "info"),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ring-1 ${
              STYLES[t.type]
            } ${t.leaving ? "animate-toast-out" : "animate-toast-in"}`}
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs"
              aria-hidden
            >
              {ICONS[t.type]}
            </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast deve ser usado dentro de <ToastProvider>");
  }
  return ctx;
}
