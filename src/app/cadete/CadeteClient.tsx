"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Toggle from "@/components/Toggle";
import ChangePassword from "@/components/ChangePassword";
import LogoutButton from "@/components/LogoutButton";
import ThemeToggle from "@/components/ThemeToggle";
import { apiFetch } from "@/lib/client";
import {
  MEAL_TYPES,
  MEAL_LABELS,
  MEAL_ICONS,
  SQUADRON_LABELS,
  isOptOutSquadron,
  type MealType,
  type AccessState,
} from "@/lib/constants";
import MenuBanner from "@/components/MenuBanner";
import MyQrCode from "@/components/MyQrCode";
import { useToast } from "@/components/Toast";
import { formatLongDate } from "@/lib/dates";

interface Slot {
  id: string;
  date: string;
  meal_type: MealType;
  access: Exclude<AccessState, "ninguem">; // "opcional" | "todos"
  locked: boolean;
  marked: boolean;
}

interface Props {
  user: { name: string; number: string; squadron: number };
  qrToken: string | null;
}

export default function CadeteClient({ user, qrToken }: Props) {
  const toast = useToast();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  // Toast de "salvo" com debounce: ao marcar várias refeições em sequência,
  // mostra um único toast ~700ms após a última gravação bem-sucedida.
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  function notifySaved() {
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(
      () => toast.success("Refeições salvas com sucesso! ✓"),
      700
    );
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/slots");
        const data = await res.json();
        if (res.ok) setSlots(data.slots ?? []);
        else setError(data.error ?? "Erro ao carregar refeições");
      } catch {
        setError("Erro de conexão");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Agrupa por data, mantendo ordem cronológica.
  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, daySlots]) => ({ date, daySlots }));
  }, [slots]);

  // 3º/4º esquadrão podem desmarcar refeições "todos" (opt-out).
  const optOut = isOptOutSquadron(user.squadron);

  // Pode alternar: opcional sempre; "todos" só p/ 3º/4º; nunca se bloqueado.
  function canToggle(slot: Slot): boolean {
    if (slot.locked) return false;
    if (slot.access === "opcional") return true;
    return optOut; // access === "todos"
  }

  async function toggle(slot: Slot, next: boolean) {
    if (!canToggle(slot) || pending.has(slot.id)) return;
    // Atualização otimista
    setSlots((prev) =>
      prev.map((s) => (s.id === slot.id ? { ...s, marked: next } : s))
    );
    setPending((p) => new Set(p).add(slot.id));
    try {
      const res = await apiFetch("/api/marks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot_id: slot.id, marked: next }),
      });
      if (!res.ok) {
        // reverte
        setSlots((prev) =>
          prev.map((s) => (s.id === slot.id ? { ...s, marked: !next } : s))
        );
        clearTimeout(savedTimer.current);
        toast.error("Não foi possível salvar. Tente novamente.");
      } else {
        notifySaved();
      }
    } catch {
      setSlots((prev) =>
        prev.map((s) => (s.id === slot.id ? { ...s, marked: !next } : s))
      );
      clearTimeout(savedTimer.current);
      toast.error("Erro de conexão.");
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(slot.id);
        return n;
      });
    }
  }

  return (
    <div className="min-h-[100dvh]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-gradient-to-r from-navy-800 to-navy-600 text-white shadow-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight">
              {user.name}
            </p>
            <p className="text-xs text-blue-100/80">
              {user.number} · {SQUADRON_LABELS[user.squadron] ?? "—"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5 pb-24">
        <MenuBanner />

        <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-400">
          Refeições
        </h2>

        {loading && (
          <div className="card p-8 text-center text-slate-500 dark:text-gray-400">
            Carregando…
          </div>
        )}

        {error && !loading && (
          <div className="card p-6 text-center text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && days.length === 0 && (
          <div className="card p-8 text-center text-slate-500 dark:text-gray-400">
            Nenhuma refeição disponível no momento
          </div>
        )}

        {/* Grade responsiva de dias: 1 / 2 / 3 colunas. */}
        {!loading && days.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {days.map(({ date, daySlots }, i) => (
              <section
                key={date}
                className="card overflow-hidden animate-fade-in-up"
                style={{ animationDelay: `${Math.min(i * 50, 360)}ms` }}
              >
                <div className="border-b border-slate-100 bg-gradient-to-r from-navy-50 to-white px-3 py-2 dark:border-gray-700 dark:from-gray-700/40 dark:to-gray-800">
                  <h3 className="text-sm font-semibold capitalize text-navy-800 dark:text-gray-100">
                    {formatLongDate(date)}
                  </h3>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-gray-700">
                  {MEAL_TYPES.filter((mt) =>
                    daySlots.some((s) => s.meal_type === mt)
                  ).map((mt) => {
                    const slot = daySlots.find((s) => s.meal_type === mt)!;
                    // "todos" estrito (1º/2º) = obrigatória sem desmarcar.
                    // "todos" opt-out (3º/4º) = pré-marcada, mas pode desmarcar.
                    const strict = slot.access === "todos" && !optOut;
                    const optOutMeal = slot.access === "todos" && optOut;
                    return (
                      <li
                        key={slot.id}
                        className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${
                          slot.locked
                            ? "bg-slate-50 dark:bg-gray-700/30"
                            : "hover:bg-slate-50/60 dark:hover:bg-gray-700/40"
                        }`}
                      >
                        <span
                          className={`shrink-0 text-base leading-none ${
                            slot.locked ? "opacity-50 grayscale" : ""
                          }`}
                          aria-hidden
                        >
                          {slot.locked ? "🔒" : MEAL_ICONS[mt]}
                        </span>

                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm font-medium leading-tight ${
                              slot.locked
                                ? "text-slate-400 dark:text-gray-500"
                                : "text-slate-700 dark:text-gray-200"
                            }`}
                          >
                            {MEAL_LABELS[mt]}
                          </p>
                          {slot.locked ? (
                            <p className="text-[11px] leading-tight text-slate-400">
                              Bloqueado · {slot.marked ? "Sim" : "Não"}
                            </p>
                          ) : optOutMeal ? (
                            <p
                              className={`text-[11px] leading-tight ${
                                slot.marked
                                  ? "text-emerald-600"
                                  : "font-medium text-amber-600"
                              }`}
                            >
                              {slot.marked
                                ? "Obrigatória (pode desmarcar)"
                                : "Desmarcou — não vai comer"}
                            </p>
                          ) : null}
                        </div>

                        {strict ? (
                          <span className="chip shrink-0 bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                            Obrigatória
                          </span>
                        ) : (
                          <Toggle
                            on={slot.marked}
                            disabled={slot.locked || pending.has(slot.id)}
                            onChange={(next) => toggle(slot, next)}
                            label={`${MEAL_LABELS[mt]} ${formatLongDate(date)}`}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="pt-2">
          <ChangePassword />
        </div>

        <p className="pt-2 text-center text-xs text-slate-400 dark:text-gray-600">
          Refeições AFA
        </p>
      </main>

      {/* QR code: botão flutuante + modal em tela cheia */}
      <MyQrCode token={qrToken} name={user.name} number={user.number} />
    </div>
  );
}
