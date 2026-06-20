"use client";

import { useEffect, useMemo, useState } from "react";
import Toggle from "@/components/Toggle";
import ChangePassword from "@/components/ChangePassword";
import LogoutButton from "@/components/LogoutButton";
import {
  MEAL_TYPES,
  MEAL_LABELS,
  SQUADRON_LABELS,
  type MealType,
  type AccessState,
} from "@/lib/constants";
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
}

export default function CadeteClient({ user }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/slots");
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

  async function toggle(slot: Slot, next: boolean) {
    if (slot.locked || slot.access !== "opcional" || pending.has(slot.id)) return;
    // Atualização otimista
    setSlots((prev) =>
      prev.map((s) => (s.id === slot.id ? { ...s, marked: next } : s))
    );
    setPending((p) => new Set(p).add(slot.id));
    try {
      const res = await fetch("/api/marks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot_id: slot.id, marked: next }),
      });
      if (!res.ok) {
        // reverte
        setSlots((prev) =>
          prev.map((s) => (s.id === slot.id ? { ...s, marked: !next } : s))
        );
      }
    } catch {
      setSlots((prev) =>
        prev.map((s) => (s.id === slot.id ? { ...s, marked: !next } : s))
      );
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
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight">
              {user.name}
            </p>
            <p className="text-xs text-blue-100/80">
              {user.number} · {SQUADRON_LABELS[user.squadron] ?? "—"}
            </p>
          </div>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Refeições
        </h2>

        {loading && (
          <div className="card p-8 text-center text-slate-500">Carregando…</div>
        )}

        {error && !loading && (
          <div className="card p-6 text-center text-red-600">{error}</div>
        )}

        {!loading && !error && days.length === 0 && (
          <div className="card p-8 text-center text-slate-500">
            Nenhuma refeição disponível no momento
          </div>
        )}

        {!loading &&
          days.map(({ date, daySlots }) => (
            <section key={date} className="card overflow-hidden animate-fade-in">
              <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3">
                <h3 className="font-semibold capitalize text-navy-800">
                  {formatLongDate(date)}
                </h3>
              </div>
              <ul className="divide-y divide-slate-100">
                {MEAL_TYPES.filter((mt) =>
                  daySlots.some((s) => s.meal_type === mt)
                ).map((mt) => {
                  const slot = daySlots.find((s) => s.meal_type === mt)!;
                  const mandatory = slot.access === "todos";
                  return (
                    <li
                      key={slot.id}
                      className={`flex items-center justify-between gap-4 px-5 py-3.5 ${
                        slot.locked ? "bg-slate-50" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p
                          className={`font-medium ${
                            slot.locked ? "text-slate-400" : "text-slate-700"
                          }`}
                        >
                          {MEAL_LABELS[mt]}
                        </p>
                        <p className="text-xs">
                          {mandatory ? (
                            <span className="font-semibold text-emerald-600">
                              Obrigatória — todos do esquadrão
                            </span>
                          ) : slot.locked ? (
                            <span className="text-slate-400">
                              🔒 Bloqueado ·{" "}
                              {slot.marked ? "você marcou Sim" : "você marcou Não"}
                            </span>
                          ) : (
                            <span
                              className={
                                slot.marked
                                  ? "font-semibold text-emerald-600"
                                  : "text-slate-400"
                              }
                            >
                              {slot.marked ? "Sim" : "Não"}
                            </span>
                          )}
                        </p>
                      </div>
                      {mandatory ? (
                        <span className="chip shrink-0 bg-emerald-100 px-2.5 py-1 text-emerald-700">
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

        <div className="pt-2">
          <ChangePassword />
        </div>

        <p className="pb-6 pt-2 text-center text-xs text-slate-400">
          Refeições AFA
        </p>
      </main>
    </div>
  );
}
