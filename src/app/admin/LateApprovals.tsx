"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MEAL_SHORT,
  SQUADRON_SHORT,
  type MealType,
} from "@/lib/constants";
import { formatShortDate, weekdayShort } from "@/lib/dates";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";

interface LateMark {
  id: string; // id da linha em meal_marks (p/ aprovação individual)
  number: string;
  name: string;
  squadron: number;
  late_marked_at: string | null;
  approved: boolean;
  reason: "punido" | "outro" | null;
  note: string | null;
}

// Texto da justificativa: "Punido" ou o texto livre quando o motivo é "outro".
function reasonText(m: LateMark): string {
  if (m.reason === "punido") return "Punido";
  if (m.reason === "outro") return m.note?.trim() || "Outro";
  return "—";
}
interface LateSlot {
  slot_id: string;
  date: string;
  meal_type: MealType;
  pending: number;
  approved: number;
  marks: LateMark[];
}

interface Props {
  from: string;
  to: string;
  // Chamado após uma aprovação, para o Resumo recalcular o quantitativo (que
  // passa a incluir as marcações recém-aprovadas).
  onApproved?: () => void;
}

// Horário da marcação no fuso de Brasília: "dd/mm HH:mm".
function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

export default function LateApprovals({ from, to, onApproved }: Props) {
  const toast = useToast();
  const [slots, setSlots] = useState<LateSlot[]>([]);
  const [totals, setTotals] = useState({ pending: 0, approved: 0 });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/marks/late?from=${from}&to=${to}`);
      const data = await res.json();
      if (res.ok) {
        setSlots(data.slots ?? []);
        setTotals({
          pending: data.totalPending ?? 0,
          approved: data.totalApproved ?? 0,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  // Aprova por refeição (slot_ids: uma ou todas) ou individual (mark_ids).
  async function approve(payload: { slot_ids?: string[]; mark_ids?: string[] }) {
    const count =
      (payload.slot_ids?.length ?? 0) + (payload.mark_ids?.length ?? 0);
    if (count === 0) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/marks/late/approve", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          `${data.approved ?? 0} marcação(ões) de última hora aprovada(s)!`
        );
        load();
        onApproved?.();
      } else {
        toast.error(data.error ?? "Erro ao aprovar.");
      }
    } finally {
      setBusy(false);
    }
  }

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const pendingSlotIds = slots.filter((s) => s.pending > 0).map((s) => s.slot_id);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-gray-700">
        <div>
          <h2 className="font-bold text-navy-800 dark:text-gray-100">
            ⏰ Marcações de última hora
          </h2>
          <p className="text-xs text-slate-500 dark:text-gray-400">
            Marcadas na segunda chance (após o prazo). Só valem para a
            fiscalização depois de aprovadas — libera o horário extra do rancho.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/40">
            {totals.pending} pendente{totals.pending === 1 ? "" : "s"}
          </span>
          <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/40">
            {totals.approved} aprovada{totals.approved === 1 ? "" : "s"}
          </span>
          <button
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-40"
            disabled={busy || pendingSlotIds.length === 0}
            onClick={() => approve({ slot_ids: pendingSlotIds })}
            title="Aprovar todas as pendentes de todas as refeições do período"
          >
            ✓ Aprovar todas (todas as refeições)
          </button>
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-6 text-center text-sm text-slate-400 dark:text-gray-500">
          Carregando…
        </div>
      ) : slots.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-slate-400 dark:text-gray-500">
          Nenhuma marcação de última hora no período selecionado.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-gray-700">
          {slots.map((s) => {
            const isOpen = open.has(s.slot_id);
            return (
              <li key={s.slot_id}>
                {/* Retângulo inteiro clicável: abre/fecha a lista de solicitações. */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-gray-800/40"
                  onClick={() => toggleOpen(s.slot_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleOpen(s.slot_id);
                    }
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2 text-left">
                    <span
                      className={`text-slate-400 transition-transform ${
                        isOpen ? "rotate-90" : ""
                      }`}
                    >
                      ▸
                    </span>
                    <span>
                      <span className="font-semibold text-navy-800 dark:text-gray-100">
                        {formatShortDate(s.date)} · {MEAL_SHORT[s.meal_type]}
                      </span>
                      <span className="ml-2 text-xs capitalize text-slate-400 dark:text-gray-500">
                        {weekdayShort(s.date)}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.pending > 0 && (
                      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/40">
                        {s.pending} pendente{s.pending === 1 ? "" : "s"}
                      </span>
                    )}
                    {s.approved > 0 && (
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/40">
                        {s.approved} aprovada{s.approved === 1 ? "" : "s"}
                      </span>
                    )}
                    {s.pending > 0 && (
                      <button
                        className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation(); // não fecha/abre o retângulo
                          approve({ slot_ids: [s.slot_id] });
                        }}
                        title="Aprovar todas as pendentes desta refeição"
                      >
                        ✓ Aprovar todas desta refeição
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="overflow-x-auto border-t border-slate-100 bg-slate-50/60 px-5 py-2 dark:border-gray-700 dark:bg-gray-800/40">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-gray-500">
                          <th className="py-1.5 pr-3 font-semibold">Número</th>
                          <th className="py-1.5 pr-3 font-semibold">Nome</th>
                          <th className="py-1.5 pr-3 font-semibold">Esq.</th>
                          <th className="py-1.5 pr-3 font-semibold">Justificativa</th>
                          <th className="py-1.5 pr-3 font-semibold">Marcou às</th>
                          <th className="py-1.5 pr-3 font-semibold">Situação</th>
                          <th className="py-1.5 font-semibold">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
                        {s.marks.map((m) => (
                          <tr key={m.id}>
                            <td className="py-1.5 pr-3 font-mono text-slate-500 dark:text-gray-400">
                              {m.number}
                            </td>
                            <td className="py-1.5 pr-3 font-medium text-slate-700 dark:text-gray-200">
                              {m.name}
                            </td>
                            <td className="py-1.5 pr-3 text-slate-500 dark:text-gray-400">
                              {SQUADRON_SHORT[m.squadron] ?? "—"}
                            </td>
                            <td className="py-1.5 pr-3 text-slate-600 dark:text-gray-300">
                              {m.reason === "outro" ? (
                                <span title={reasonText(m)}>
                                  <span className="font-semibold">Outro:</span>{" "}
                                  {reasonText(m)}
                                </span>
                              ) : (
                                reasonText(m)
                              )}
                            </td>
                            <td className="py-1.5 pr-3 text-slate-500 dark:text-gray-400">
                              {formatStamp(m.late_marked_at)}
                            </td>
                            <td className="py-1.5 pr-3">
                              {m.approved ? (
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                  ✓ Aprovada
                                </span>
                              ) : (
                                <span className="font-semibold text-amber-600 dark:text-amber-400">
                                  ⏳ Pendente
                                </span>
                              )}
                            </td>
                            <td className="py-1.5">
                              {!m.approved && (
                                <button
                                  className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
                                  disabled={busy}
                                  onClick={() => approve({ mark_ids: [m.id] })}
                                  title="Aprovar apenas este cadete"
                                >
                                  Aprovar
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
