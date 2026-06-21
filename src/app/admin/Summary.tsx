"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MEAL_SHORT,
  ALL_SQUADRONS,
  SQUADRON_SHORT,
  SQUADRON_LABELS,
  type MealType,
  type AccessState,
} from "@/lib/constants";
import { formatShortDate, weekdayShort } from "@/lib/dates";
import { apiFetch } from "@/lib/client";

interface CadetLite {
  number: string;
  name: string;
}

interface SummarySlot {
  id: string;
  date: string;
  meal_type: MealType;
  access: Record<number, AccessState>;
  locked: boolean;
  counts: Record<number, number>;
  total: number;
}

interface Props {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}

export default function Summary({ from, to, setFrom, setTo }: Props) {
  const [slots, setSlots] = useState<SummarySlot[]>([]);
  const [squadronTotals, setSquadronTotals] = useState<Record<number, number>>(
    {}
  );
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<{
    slot: SummarySlot;
    squadron: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/marks/summary?from=${from}&to=${to}`);
      const data = await res.json();
      if (res.ok) {
        setSlots(data.slots ?? []);
        setSquadronTotals(data.squadronTotals ?? {});
      }
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  // Exporta o Excel (.xlsx) gerado no servidor, com abas por esquadrão.
  async function exportXlsx() {
    setExporting(true);
    try {
      const res = await apiFetch(`/api/marks/export?from=${from}&to=${to}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Não foi possível gerar o arquivo.");
        return;
      }
      const blob = await res.blob();
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `refeicoes-afa-${today}.xlsx`;
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
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-slate-500">De</span>
              <input
                type="date"
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-slate-500">Até</span>
              <input
                type="date"
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <button
            className="btn-secondary"
            onClick={exportXlsx}
            disabled={slots.length === 0 || exporting}
          >
            {exporting ? "Gerando…" : "⬇ Exportar Excel"}
          </button>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-bold text-navy-800">Resumo de marcações</h2>
          <p className="text-xs text-slate-500">
            Clique em um número para ver os cadetes que marcaram “Sim”.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded ring-1 ring-slate-300" />
              Opcional — marcaram voluntariamente
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-emerald-100 ring-1 ring-emerald-300" />
              Todos — obrigatória (efetivo do esquadrão)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-slate-100 ring-1 ring-slate-300" />
              Ninguém — esquadrão sem a refeição
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 text-left font-semibold">Refeição</th>
                {ALL_SQUADRONS.map((sq) => (
                  <th key={sq} className="px-3 py-2.5 text-center font-semibold">
                    {SQUADRON_SHORT[sq]}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {slots.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-navy-800">
                      {formatShortDate(s.date)} · {MEAL_SHORT[s.meal_type]}
                    </div>
                    <div className="text-xs capitalize text-slate-400">
                      {weekdayShort(s.date)}
                      {s.locked && " · 🔒"}
                    </div>
                  </td>
                  {ALL_SQUADRONS.map((sq) => {
                    const state = s.access[sq] ?? "ninguem";

                    if (state === "todos") {
                      // Refeição obrigatória: todos do esquadrão comem.
                      const headcount = squadronTotals[sq] ?? 0;
                      return (
                        <td key={sq} className="px-3 py-3 text-center">
                          <span
                            className="inline-block rounded-lg bg-emerald-100 px-2 py-1 font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200"
                            title="Obrigatória — todos do esquadrão"
                          >
                            {headcount}
                          </span>
                        </td>
                      );
                    }

                    if (state === "ninguem") {
                      return (
                        <td key={sq} className="px-3 py-3 text-center">
                          <span
                            className="inline-block rounded-lg bg-slate-100 px-2 py-1 text-slate-400 ring-1 ring-inset ring-slate-200"
                            title="Esquadrão sem essa refeição"
                          >
                            -
                          </span>
                        </td>
                      );
                    }

                    // opcional
                    const count = s.counts[sq] ?? 0;
                    return (
                      <td key={sq} className="px-3 py-3 text-center">
                        {count > 0 ? (
                          <button
                            className="rounded-lg px-2 py-1 font-semibold text-navy-700 hover:bg-navy-50"
                            onClick={() => setDetail({ slot: s, squadron: sq })}
                          >
                            {count}
                          </button>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-center font-bold text-navy-800">
                    {s.total}
                  </td>
                </tr>
              ))}
              {!loading && slots.length === 0 && (
                <tr>
                  <td colSpan={ALL_SQUADRONS.length + 2} className="px-4 py-8 text-center text-slate-400">
                    Nenhuma refeição no período selecionado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="px-5 py-4 text-center text-sm text-slate-400">Carregando…</div>
        )}
      </section>

      {detail && (
        <CadetListModal
          slot={detail.slot}
          squadron={detail.squadron}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function CadetListModal({
  slot,
  squadron,
  onClose,
}: {
  slot: SummarySlot;
  squadron: number;
  onClose: () => void;
}) {
  const [cadets, setCadets] = useState<CadetLite[] | null>(null);
  const [error, setError] = useState("");

  // Carrega a lista de cadetes sob demanda (não vem no resumo).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiFetch(
          `/api/marks/detail?slot_id=${slot.id}&squadron=${squadron}`
        );
        const data = await res.json();
        if (!active) return;
        if (res.ok) setCadets(data.cadets ?? []);
        else setError(data.error ?? "Erro ao carregar");
      } catch {
        if (active) setError("Erro de conexão");
      }
    })();
    return () => {
      active = false;
    };
  }, [slot.id, squadron]);

  const expected = slot.counts[squadron] ?? 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[80vh] w-full max-w-md flex-col p-5 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3">
          <h3 className="text-lg font-bold text-navy-800">
            {MEAL_SHORT[slot.meal_type]} · {formatShortDate(slot.date)}
          </h3>
          <p className="text-sm text-slate-500">
            {SQUADRON_LABELS[squadron]} — {expected} marcaram “Sim”
          </p>
        </div>
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {error ? (
            <p className="py-6 text-center text-sm text-red-600">{error}</p>
          ) : cadets === null ? (
            <p className="py-6 text-center text-sm text-slate-400">Carregando…</p>
          ) : cadets.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              Nenhum cadete marcou “Sim”.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {cadets.map((c) => (
                <li key={c.number} className="flex items-center gap-3 py-2.5">
                  <span className="font-mono text-sm text-slate-500">
                    {c.number}
                  </span>
                  <span className="font-medium text-slate-700">{c.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="btn-secondary mt-4" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}
