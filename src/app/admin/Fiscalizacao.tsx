"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import {
  MEAL_LABELS,
  MEAL_SHORT,
  SQUADRON_SHORT,
  type MealType,
} from "@/lib/constants";
import { toISODate } from "@/lib/dates";

interface SlotStat {
  id: string;
  meal_type: MealType;
  expected: number;
  entered: number;
  no_show: number;
}

interface Entry {
  slot_id: string;
  meal_type: MealType | null;
  number: string;
  name: string;
  squadron: number;
  entered_at: string;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Fiscalizacao() {
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [slots, setSlots] = useState<SlotStat[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filterSlot, setFilterSlot] = useState(""); // "" = todas

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/fiscal/entries?date=${date}`);
      const data = await res.json();
      if (res.ok) {
        setSlots(data.slots ?? []);
        setEntries(data.entries ?? []);
      } else {
        setSlots([]);
        setEntries([]);
      }
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // Reseta o filtro quando os slots mudam (troca de dia).
  useEffect(() => {
    setFilterSlot("");
  }, [date]);

  const visibleEntries = useMemo(
    () =>
      filterSlot ? entries.filter((e) => e.slot_id === filterSlot) : entries,
    [entries, filterSlot]
  );

  async function exportXlsx() {
    setExporting(true);
    try {
      const res = await apiFetch(`/api/fiscal/entries/export?date=${date}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Não foi possível gerar o arquivo.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fiscalizacao-${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-slate-500 dark:text-gray-400">
              Dia
            </span>
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            className="btn-secondary"
            onClick={exportXlsx}
            disabled={entries.length === 0 || exporting}
          >
            {exporting ? "Gerando…" : "⬇ Exportar Excel"}
          </button>
        </div>
      </section>

      {/* Cards por refeição: marcaram vs entraram */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {slots.map((s) => (
          <button
            key={s.id}
            onClick={() =>
              setFilterSlot((cur) => (cur === s.id ? "" : s.id))
            }
            className={`card p-4 text-left transition ${
              filterSlot === s.id ? "ring-2 ring-navy-500" : ""
            }`}
          >
            <p className="text-sm font-bold text-navy-800 dark:text-gray-100">
              {MEAL_LABELS[s.meal_type]}
            </p>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-2xl font-black text-emerald-600">
                {s.entered}
              </span>
              <span className="text-sm text-slate-400">
                / {s.expected} marcaram
              </span>
            </div>
            <p className="mt-1 text-xs text-amber-600">
              {s.no_show} faltaram (no-show)
            </p>
          </button>
        ))}
        {!loading && slots.length === 0 && (
          <div className="card p-5 text-sm text-slate-400 dark:text-gray-500 sm:col-span-2 lg:col-span-4">
            Nenhuma refeição cadastrada neste dia.
          </div>
        )}
      </section>

      {/* Tabela de entradas */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 dark:border-gray-700">
          <div>
            <h2 className="font-bold text-navy-800 dark:text-gray-100">
              Entradas registradas
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              {visibleEntries.length}{" "}
              {visibleEntries.length === 1 ? "entrada" : "entradas"}
              {filterSlot && " · filtrado por refeição (toque no card p/ limpar)"}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-navy-900 to-navy-700 text-xs uppercase tracking-wide text-blue-50">
                <th className="px-4 py-3 text-left font-semibold">Número</th>
                <th className="px-4 py-3 text-left font-semibold">Nome</th>
                <th className="px-3 py-3 text-center font-semibold">Esq.</th>
                <th className="px-3 py-3 text-center font-semibold">Refeição</th>
                <th className="px-3 py-3 text-center font-semibold">Horário</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
              {visibleEntries.map((e, i) => (
                <tr
                  key={`${e.slot_id}-${e.number}-${i}`}
                  className="odd:bg-white even:bg-slate-50/50 dark:odd:bg-gray-800 dark:even:bg-gray-800/50"
                >
                  <td className="px-4 py-2.5 font-mono text-slate-500 dark:text-gray-400">
                    {e.number}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-gray-200">
                    {e.name}
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-500 dark:text-gray-400">
                    {SQUADRON_SHORT[e.squadron] ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-500 dark:text-gray-400">
                    {e.meal_type ? MEAL_SHORT[e.meal_type] : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center font-semibold text-navy-700 dark:text-gray-100">
                    {hhmm(e.entered_at)}
                  </td>
                </tr>
              ))}
              {!loading && visibleEntries.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-slate-400 dark:text-gray-500"
                  >
                    Nenhuma entrada registrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="px-5 py-4 text-center text-sm text-slate-400 dark:text-gray-500">
            Carregando…
          </div>
        )}
      </section>
    </div>
  );
}
