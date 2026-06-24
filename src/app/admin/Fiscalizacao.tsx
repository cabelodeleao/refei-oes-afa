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
  not_marked: number;
  duplicated: number;
  no_qr: number;
  scanned: boolean; // a refeição já foi fiscalizada (houve alguma leitura)?
}

interface ListItem {
  slot_id: string;
  meal_type: MealType | null;
  number: string;
  name: string;
  squadron: number;
  at: string; // "" para no-show
  flagged_person?: string | null; // duplicados: pessoa flagrada (fraude)
  fiscal_note?: string | null; // duplicados / sem QR: observação do fiscal
}

type Category =
  | "entered"
  | "notMarked"
  | "duplicates"
  | "noShows"
  | "noQr";

const CATEGORIES: {
  key: Category;
  label: string;
  short: string;
  accent: string; // cor do contador / aba ativa
  dot: string;
}[] = [
  {
    key: "entered",
    label: "Entraram",
    short: "Entraram",
    accent: "text-emerald-600",
    dot: "bg-emerald-500",
  },
  {
    key: "notMarked",
    label: "Entraram sem marcar",
    short: "Sem marcar",
    accent: "text-red-600",
    dot: "bg-red-500",
  },
  {
    key: "duplicates",
    label: "QR reutilizado",
    short: "QR reutilizado",
    accent: "text-amber-600",
    dot: "bg-amber-500",
  },
  {
    key: "noShows",
    label: "Faltaram",
    short: "Faltaram",
    accent: "text-slate-500",
    dot: "bg-slate-400",
  },
  {
    key: "noQr",
    label: "Sem QR",
    short: "Sem QR",
    accent: "text-purple-600",
    dot: "bg-purple-500",
  },
];

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Fiscalizacao() {
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [slots, setSlots] = useState<SlotStat[]>([]);
  const [lists, setLists] = useState<Record<Category, ListItem[]>>({
    entered: [],
    notMarked: [],
    duplicates: [],
    noShows: [],
    noQr: [],
  });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filterSlot, setFilterSlot] = useState(""); // "" = todas
  const [category, setCategory] = useState<Category>("entered");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/fiscal/entries?date=${date}`);
      const data = await res.json();
      if (res.ok) {
        setSlots(data.slots ?? []);
        setLists({
          entered: data.entries ?? [],
          notMarked: data.notMarked ?? [],
          duplicates: data.duplicates ?? [],
          noShows: data.noShows ?? [],
          noQr: data.noQr ?? [],
        });
      } else {
        setSlots([]);
        setLists({
          entered: [],
          notMarked: [],
          duplicates: [],
          noShows: [],
          noQr: [],
        });
      }
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // Reseta filtros ao trocar de dia.
  useEffect(() => {
    setFilterSlot("");
  }, [date]);

  // Total de itens por categoria, respeitando o filtro de refeição.
  const counts = useMemo(() => {
    const filter = (items: ListItem[]) =>
      filterSlot ? items.filter((i) => i.slot_id === filterSlot) : items;
    return {
      entered: filter(lists.entered).length,
      notMarked: filter(lists.notMarked).length,
      duplicates: filter(lists.duplicates).length,
      noShows: filter(lists.noShows).length,
      noQr: filter(lists.noQr).length,
    } as Record<Category, number>;
  }, [lists, filterSlot]);

  const visibleItems = useMemo(() => {
    const items = lists[category];
    return filterSlot ? items.filter((i) => i.slot_id === filterSlot) : items;
  }, [lists, category, filterSlot]);

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

  const totalAll =
    counts.entered +
    counts.notMarked +
    counts.duplicates +
    counts.noShows +
    counts.noQr;
  const showTime = category !== "noShows";
  const isDup = category === "duplicates";
  const isNoQr = category === "noQr";

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
            disabled={totalAll === 0 || exporting}
          >
            {exporting ? "Gerando…" : "⬇ Exportar Excel"}
          </button>
        </div>
      </section>

      {/* Cards por refeição: filtro por refeição */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {slots.map((s) => {
          const pct =
            s.expected > 0 ? Math.round((s.entered / s.expected) * 100) : null;
          return (
            <button
              key={s.id}
              onClick={() => setFilterSlot((cur) => (cur === s.id ? "" : s.id))}
              className={`card p-4 text-left transition ${
                filterSlot === s.id ? "ring-2 ring-navy-500" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-navy-800 dark:text-gray-100">
                  {MEAL_LABELS[s.meal_type]}
                </p>
                {s.duplicated > 0 && (
                  <span title="QR reutilizado registrado — possível fraude">
                    ⚠️
                  </span>
                )}
              </div>

              {s.scanned ? (
                <div className="mt-2.5 space-y-1 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="text-slate-500 dark:text-gray-400">
                      Marcaram
                    </span>
                    <span className="font-semibold text-navy-800 dark:text-gray-100">
                      {s.expected}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium text-emerald-600">
                      Compareceram
                    </span>
                    <span className="font-bold text-emerald-600">
                      {s.entered}
                      {pct !== null && (
                        <span className="ml-1 text-xs font-semibold opacity-80">
                          ({pct}%)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium text-orange-600">Faltaram</span>
                    <span className="font-bold text-orange-600">
                      {s.no_show}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 space-y-1 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="text-slate-500 dark:text-gray-400">
                      Marcaram
                    </span>
                    <span className="font-semibold text-navy-800 dark:text-gray-100">
                      {s.expected}
                    </span>
                  </div>
                  <p className="pt-0.5 text-xs italic text-slate-400 dark:text-gray-500">
                    Sem fiscalização registrada
                  </p>
                </div>
              )}
            </button>
          );
        })}
        {!loading && slots.length === 0 && (
          <div className="card p-5 text-sm text-slate-400 dark:text-gray-500 sm:col-span-2 lg:col-span-4">
            Nenhuma refeição cadastrada neste dia.
          </div>
        )}
      </section>

      {/* Abas de categoria */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3 dark:border-gray-700">
          {CATEGORIES.map((cat) => {
            const active = category === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setCategory(cat.key)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  active
                    ? "bg-navy-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${cat.dot}`} />
                <span className="hidden sm:inline">{cat.label}</span>
                <span className="sm:hidden">{cat.short}</span>
                <span
                  className={`rounded-full px-1.5 text-xs font-bold ${
                    active
                      ? "bg-white/20 text-white"
                      : "bg-white text-slate-600 dark:bg-gray-800 dark:text-gray-200"
                  }`}
                >
                  {counts[cat.key]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            {(() => {
              const cat = CATEGORIES.find((c) => c.key === category)!;
              return (
                <span
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold ${cat.accent}`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${cat.dot}`} />
                  {cat.label}
                </span>
              );
            })()}
            <span className="text-xs text-slate-400 dark:text-gray-500">
              · {visibleItems.length}{" "}
              {visibleItems.length === 1 ? "registro" : "registros"}
              {filterSlot && " · filtrado por refeição (toque no card p/ limpar)"}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table
            className={`w-full border-collapse text-sm ${
              isDup ? "min-w-[760px]" : isNoQr ? "min-w-[620px]" : "min-w-[520px]"
            }`}
          >
            <thead>
              <tr className="bg-gradient-to-r from-navy-900 to-navy-700 text-xs uppercase tracking-wide text-blue-50">
                <th className="px-4 py-3 text-left font-semibold">Número</th>
                <th className="px-4 py-3 text-left font-semibold">
                  {isDup ? "Dono do QR" : "Nome"}
                </th>
                <th className="px-3 py-3 text-center font-semibold">Esq.</th>
                <th className="px-3 py-3 text-center font-semibold">Refeição</th>
                {showTime && (
                  <th className="px-3 py-3 text-center font-semibold">Horário</th>
                )}
                {isDup && (
                  <>
                    <th className="px-3 py-3 text-left font-semibold">
                      Quem usou (flagrado)
                    </th>
                    <th className="px-3 py-3 text-left font-semibold">Obs.</th>
                  </>
                )}
                {isNoQr && (
                  <th className="px-3 py-3 text-left font-semibold">Obs.</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
              {visibleItems.map((e, i) => {
                const flagged = isDup && !!e.flagged_person;
                return (
                  <tr
                    key={`${e.slot_id}-${e.number}-${i}`}
                    className={
                      flagged
                        ? "bg-red-50 dark:bg-red-500/10"
                        : "odd:bg-white even:bg-slate-50/50 dark:odd:bg-gray-800 dark:even:bg-gray-800/50"
                    }
                  >
                    <td className="px-4 py-2.5 font-mono text-slate-500 dark:text-gray-400">
                      {e.number}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-gray-200">
                      {flagged && (
                        <span className="mr-1" title="Possível fraude de QR">
                          🚨
                        </span>
                      )}
                      {e.name}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-500 dark:text-gray-400">
                      {SQUADRON_SHORT[e.squadron] ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-500 dark:text-gray-400">
                      {e.meal_type ? MEAL_SHORT[e.meal_type] : "—"}
                    </td>
                    {showTime && (
                      <td className="px-3 py-2.5 text-center font-semibold text-navy-700 dark:text-gray-100">
                        {e.at ? hhmm(e.at) : "—"}
                      </td>
                    )}
                    {isDup && (
                      <>
                        <td className="px-3 py-2.5 font-medium text-red-700 dark:text-red-300">
                          {e.flagged_person || (
                            <span className="font-normal text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 dark:text-gray-400">
                          {e.fiscal_note || (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </>
                    )}
                    {isNoQr && (
                      <td className="px-3 py-2.5 text-slate-500 dark:text-gray-400">
                        {e.fiscal_note || (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {!loading && visibleItems.length === 0 && (
                <tr>
                  <td
                    colSpan={(showTime ? 5 : 4) + (isDup ? 2 : 0) + (isNoQr ? 1 : 0)}
                    className="px-4 py-8 text-center text-slate-400 dark:text-gray-500"
                  >
                    Nenhum registro nesta categoria.
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
