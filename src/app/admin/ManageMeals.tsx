"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MEAL_TYPES,
  MEAL_SHORT,
  MEAL_ICONS,
  ALL_SQUADRONS,
  ACCESS_LABELS,
  getAccess,
  type MealType,
  type AccessState,
  type SquadronAccess,
} from "@/lib/constants";
import {
  toISODate,
  startOfWeek,
  addDays,
  dateRange,
  formatShortDate,
  weekdayShort,
  parseISODate,
} from "@/lib/dates";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";

interface Slot {
  id: string;
  date: string;
  meal_type: MealType;
  squadrons: SquadronAccess;
  locked: boolean;
}

// Mapa completo de acesso (sempre os 4 esquadrões), default "ninguem".
type AccessMap = Record<number, AccessState>;

function fullAccess(sq?: SquadronAccess): AccessMap {
  const m: AccessMap = { 1: "ninguem", 2: "ninguem", 3: "ninguem", 4: "ninguem" };
  for (const s of ALL_SQUADRONS) m[s] = getAccess(sq, s);
  return m;
}
function uniformAccess(state: AccessState): AccessMap {
  return { 1: state, 2: state, 3: state, 4: state };
}
function hasAnyAccess(m: AccessMap): boolean {
  return ALL_SQUADRONS.some((sq) => m[sq] !== "ninguem");
}

// Estilo de cada estado: texto + ícone (forma distinta) + cor, com redundância
// proposital para que o significado fique claro mesmo sem enxergar a cor
// (daltônicos / quem nunca viu o sistema). Cores bem distintas entre si:
//   Opcional -> azul escuro, ícone ✓  · Obrigatório -> verde vivo, ícone ★
//   Ninguém  -> cinza, ícone ✕
const STATE_PILL: Record<
  AccessState,
  { cls: string; icon: string; abbr: string; label: string }
> = {
  opcional: {
    cls: "bg-blue-700 text-white",
    icon: "✓",
    abbr: "Opc",
    label: "Opcional",
  },
  todos: {
    cls: "bg-green-500 text-white",
    icon: "★",
    abbr: "Obr",
    label: "Obrigatório",
  },
  ninguem: {
    cls: "bg-slate-300 text-slate-700 dark:bg-gray-600 dark:text-gray-100",
    icon: "✕",
    abbr: "Não",
    label: "Ninguém",
  },
};

interface Props {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}

export default function ManageMeals({ from, to, setFrom, setTo }: Props) {
  const toast = useToast();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{
    date: string;
    meal: MealType;
    access: AccessMap;
    existing?: Slot;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/slots?from=${from}&to=${to}`);
      const data = await res.json();
      if (res.ok) setSlots(data.slots ?? []);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  function shiftWeek(dir: number) {
    setSelected(new Set());
    setFrom(toISODate(addDays(parseISODate(from), dir * 7)));
    setTo(toISODate(addDays(parseISODate(to), dir * 7)));
  }

  const slotMap = useMemo(() => {
    const m = new Map<string, Slot>();
    for (const s of slots) m.set(`${s.date}|${s.meal_type}`, s);
    return m;
  }, [slots]);

  const days = useMemo(() => dateRange(from, to), [from, to]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // IDs das refeições que EXISTEM em um dia (para a caixa "selecionar o dia").
  function daySlotIds(d: string): string[] {
    const ids: string[] = [];
    for (const mt of MEAL_TYPES) {
      const slot = slotMap.get(`${d}|${mt}`);
      if (slot) ids.push(slot.id);
    }
    return ids;
  }

  // Marca/desmarca todas as refeições existentes de um dia em lote.
  function toggleSelectDay(ids: string[], check: boolean) {
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of ids) (check ? n.add(id) : n.delete(id));
      return n;
    });
  }

  async function bulkLock(locked: boolean) {
    if (selected.size === 0) return;
    const res = await apiFetch("/api/slots/lock", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot_ids: [...selected], locked }),
    });
    if (res.ok) {
      toast.success(locked ? "Refeições bloqueadas!" : "Refeições desbloqueadas!");
      setSelected(new Set());
      load();
    } else toast.error("Erro ao atualizar bloqueio.");
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Remover ${selected.size} refeição(ões)? As marcações serão apagadas.`))
      return;
    const res = await apiFetch("/api/slots", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot_ids: [...selected] }),
    });
    if (res.ok) {
      toast.success("Refeições removidas!");
      setSelected(new Set());
      load();
    } else toast.error("Erro ao remover.");
  }

  async function saveEdit() {
    if (!editing) return;
    if (!hasAnyAccess(editing.access)) {
      toast.error("Defina ao menos um esquadrão como Opcional ou Todos.");
      return;
    }
    const res = await apiFetch("/api/slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slots: [
          {
            date: editing.date,
            meal_type: editing.meal,
            squadrons: editing.access,
          },
        ],
      }),
    });
    if (res.ok) {
      toast.success("Refeição salva!");
      setEditing(null);
      load();
    } else toast.error("Erro ao salvar.");
  }

  return (
    // Meio-termo: aproveita bem a tela, mas com um teto p/ não esticar demais
    // as células (e suas pílulas) em monitores largos.
    <div className="space-y-4 2xl:max-w-[1600px]">
      {/* Duas colunas no desktop: form (esq.) | tabela (dir.). Uma no mobile. */}
      <div className="grid items-start gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
        <CreatePanel
          defaultFrom={from}
          defaultTo={to}
          existing={slots}
          onCreated={(msg, ok = true) => {
            if (ok) {
              toast.success(msg);
              load();
            } else {
              toast.error(msg);
            }
          }}
        />

        {/* Grid de slots existentes */}
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-gray-700">
            <div>
              <h2 className="font-bold text-navy-800 dark:text-gray-100">
                Refeições criadas
              </h2>
              <p className="text-xs text-slate-500">
                {formatShortDate(from)} a {formatShortDate(to)}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => shiftWeek(-1)}>
                ←
              </button>
              <button
                className="btn-ghost px-2.5 py-1.5 text-xs"
                onClick={() => {
                  const w = startOfWeek(new Date());
                  setFrom(toISODate(w));
                  setTo(toISODate(addDays(w, 6)));
                  setSelected(new Set());
                }}
              >
                Hoje
              </button>
              <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => shiftWeek(1)}>
                →
              </button>
            </div>
          </div>

          {/* Filtro manual de período */}
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-800/40">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-500 dark:text-gray-400">De</span>
              <input
                type="date"
                className="rounded-lg border border-slate-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-500 dark:text-gray-400">Até</span>
              <input
                type="date"
                className="rounded-lg border border-slate-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>

          {/* Ações em lote (sem legenda: os badges já são autoexplicativos) */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-gray-700">
            <span className="text-xs text-slate-500 dark:text-gray-400">
              {selected.size} selec.
            </span>
            <button
              className="btn-secondary px-2.5 py-1.5 text-xs"
              disabled={selected.size === 0}
              onClick={() => bulkLock(true)}
            >
              🔒 Bloquear
            </button>
            <button
              className="btn-secondary px-2.5 py-1.5 text-xs"
              disabled={selected.size === 0}
              onClick={() => bulkLock(false)}
            >
              🔓 Desbloquear
            </button>
            <button
              className="btn-ghost px-2.5 py-1.5 text-xs text-red-600"
              disabled={selected.size === 0}
              onClick={bulkDelete}
            >
              Remover
            </button>
          </div>

          {/* Grade MOBILE (tabela compacta com scroll) — escondida no desktop */}
          <div className="overflow-x-auto lg:hidden">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-gray-700/40 dark:text-gray-400">
                  <th className="px-3 py-2 font-semibold">Dia</th>
                  {MEAL_TYPES.map((mt) => (
                    <th key={mt} className="px-2 py-2 font-semibold">
                      {MEAL_SHORT[mt]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
                {days.map((d) => {
                  const dayIds = daySlotIds(d);
                  return (
                  <tr key={d} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-start gap-2">
                        <DaySelectCheckbox
                          ids={dayIds}
                          selected={selected}
                          onToggle={toggleSelectDay}
                          className="mt-0.5 h-3.5 w-3.5"
                        />
                        <div>
                          <div className="text-sm font-semibold text-navy-800 dark:text-gray-100">
                            {formatShortDate(d)}
                          </div>
                          <div className="text-xs capitalize text-slate-400 dark:text-gray-500">
                            {weekdayShort(d)}
                          </div>
                        </div>
                      </div>
                    </td>
                    {MEAL_TYPES.map((mt) => {
                      const slot = slotMap.get(`${d}|${mt}`);
                      return (
                        <td key={mt} className="px-2 py-2">
                          <GridCell
                            slot={slot}
                            checked={slot ? selected.has(slot.id) : false}
                            onToggleSelect={() => slot && toggleSelect(slot.id)}
                            onClick={() =>
                              setEditing({
                                date: d,
                                meal: mt,
                                access: slot
                                  ? fullAccess(slot.squadrons)
                                  : uniformAccess("opcional"),
                                existing: slot,
                              })
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Grade DESKTOP (esquadrões por extenso). Colunas flexíveis (1fr)
              que se dividem igualmente pelo espaço disponível — as 4 refeições
              cabem na tela sem scroll horizontal; minmax(0,1fr) deixa encolher. */}
          <div className="hidden px-4 py-4 lg:block">
            {/* Cabeçalho de colunas */}
            <div className="grid grid-cols-[72px_repeat(4,minmax(0,1fr))] gap-2.5 px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">
              <div>Dia</div>
              {MEAL_TYPES.map((mt) => (
                <div key={mt}>{MEAL_SHORT[mt]}</div>
              ))}
            </div>

            <div className="space-y-2">
              {days.map((d) => {
                const dayIds = daySlotIds(d);
                return (
                  <div
                    key={d}
                    className="grid grid-cols-[72px_repeat(4,minmax(0,1fr))] gap-2.5"
                  >
                    <div className="flex flex-col justify-center gap-1 px-1">
                      <DaySelectCheckbox
                        ids={dayIds}
                        selected={selected}
                        onToggle={toggleSelectDay}
                        className="h-4 w-4"
                      />
                      <div className="text-base font-bold leading-tight text-navy-800 dark:text-gray-100">
                        {formatShortDate(d)}
                      </div>
                      <div className="text-xs capitalize text-slate-400 dark:text-gray-500">
                        {weekdayShort(d)}
                      </div>
                    </div>
                    {MEAL_TYPES.map((mt) => {
                      const slot = slotMap.get(`${d}|${mt}`);
                      return (
                        <DesktopCell
                          key={mt}
                          slot={slot}
                          checked={slot ? selected.has(slot.id) : false}
                          onToggleSelect={() => slot && toggleSelect(slot.id)}
                          onClick={() =>
                            setEditing({
                              date: d,
                              meal: mt,
                              access: slot
                                ? fullAccess(slot.squadrons)
                                : uniformAccess("opcional"),
                              existing: slot,
                            })
                          }
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {loading && (
            <div className="px-5 py-4 text-center text-sm text-slate-400">
              Carregando…
            </div>
          )}
        </section>
      </div>

      {editing && (
        <EditModal
          editing={editing}
          onChange={(access) => setEditing({ ...editing, access })}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

// Badge autoexplicativo de um esquadrão: número + ícone + texto, com a cor só
// reforçando. O tooltip mostra o significado por extenso ao passar o mouse.
function SquadronBadge({ sq, state }: { sq: number; state: AccessState }) {
  const p = STATE_PILL[state];
  return (
    <span
      className={`flex items-center justify-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-bold leading-none ${p.cls}`}
      title={`${sq}º Esquadrão: ${p.label}`}
    >
      <span className="opacity-90">{sq}</span>
      <span aria-hidden>{p.icon}</span>
      <span>{p.abbr}</span>
    </span>
  );
}

function AccessSelector({
  value,
  onChange,
  disabled,
}: {
  value: AccessState;
  onChange: (v: AccessState) => void;
  disabled?: boolean;
}) {
  // Mesmas cores/ícones dos badges do grid (consistência visual).
  const options: AccessState[] = ["opcional", "todos", "ninguem"];
  return (
    <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-slate-300 dark:ring-gray-600">
      {options.map((key, i) => {
        const p = STATE_PILL[key];
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(key)}
            title={p.label}
            className={`px-2 py-1 text-xs font-semibold transition disabled:opacity-40 ${
              i > 0 ? "border-l border-slate-300 dark:border-gray-600" : ""
            } ${
              value === key
                ? p.cls
                : "bg-white text-slate-500 hover:bg-slate-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            }`}
          >
            <span aria-hidden className="mr-0.5">
              {p.icon}
            </span>
            {ACCESS_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function GridCell({
  slot,
  checked,
  onToggleSelect,
  onClick,
}: {
  slot?: Slot;
  checked: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  if (!slot) {
    return (
      <button
        onClick={onClick}
        className="flex h-full min-h-[44px] w-full items-center justify-center rounded-lg border border-dashed border-slate-200 px-2 py-1.5 text-slate-300 transition hover:border-navy-400 hover:text-navy-500 dark:border-gray-600 dark:text-gray-600 dark:hover:border-navy-400 dark:hover:text-navy-300"
        title="Criar refeição"
      >
        +
      </button>
    );
  }
  return (
    <div
      className={`rounded-lg border px-1.5 py-1.5 transition ${
        slot.locked
          ? "border-slate-200 bg-slate-100 dark:border-gray-600 dark:bg-gray-700/50"
          : "border-slate-200 bg-white dark:border-gray-600 dark:bg-gray-700"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleSelect}
          className="h-3.5 w-3.5 accent-navy-600"
          title="Selecionar"
        />
        {slot.locked ? (
          <span className="text-xs" title="Bloqueado">
            🔒
          </span>
        ) : (
          <span title="Aberto" className="text-xs text-emerald-500">
            ●
          </span>
        )}
      </div>
      <button
        onClick={onClick}
        className="grid w-full grid-cols-2 gap-1"
        title="Editar acesso dos esquadrões"
      >
        {ALL_SQUADRONS.map((sq) => (
          <SquadronBadge key={sq} sq={sq} state={getAccess(slot.squadrons, sq)} />
        ))}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

// Linha de esquadrão POR EXTENSO (desktop): "Nº Esq — Estado", a cor reforça o
// estado (verde = obrigatório, azul = opcional, cinza = ninguém). Como o nome
// do esquadrão está escrito, não depende da cor para se identificar.
const STATE_ROW: Record<AccessState, string> = {
  todos:
    "bg-emerald-50 text-emerald-700 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/40",
  opcional:
    "bg-blue-50 text-blue-700 ring-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/40",
  ninguem:
    "text-slate-400 ring-slate-200 dark:text-gray-500 dark:ring-gray-600",
};

function SquadronRow({ sq, state }: { sq: number; state: AccessState }) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATE_ROW[state]}`}
      title={`${sq}º Esquadrão: ${STATE_PILL[state].label}`}
    >
      {/* Compacta: rótulo + estado lado a lado, sem vão no meio. */}
      <span className="opacity-90">{sq}º Esq</span>
      <span>{STATE_PILL[state].label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------

// Caixa que seleciona/desseleciona TODAS as refeições existentes de um dia.
// Estado indeterminado quando apenas algumas do dia estão selecionadas.
function DaySelectCheckbox({
  ids,
  selected,
  onToggle,
  className = "",
}: {
  ids: string[];
  selected: Set<string>;
  onToggle: (ids: string[], check: boolean) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const count = ids.filter((id) => selected.has(id)).length;
  const all = ids.length > 0 && count === ids.length;
  const some = count > 0 && !all;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={all}
      disabled={ids.length === 0}
      onChange={() => onToggle(ids, !all)}
      className={`accent-navy-600 disabled:opacity-30 ${className}`}
      title={
        ids.length === 0
          ? "Sem refeições neste dia"
          : "Selecionar todas as refeições do dia"
      }
    />
  );
}

function DesktopCell({
  slot,
  checked,
  onToggleSelect,
  onClick,
}: {
  slot?: Slot;
  checked: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  if (!slot) {
    return (
      <button
        onClick={onClick}
        className="flex min-h-[132px] w-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-2xl text-slate-300 transition hover:border-navy-400 hover:text-navy-500 dark:border-gray-600 dark:text-gray-600 dark:hover:border-navy-400 dark:hover:text-navy-300"
        title="Criar refeição"
      >
        ＋
      </button>
    );
  }
  return (
    <div
      className={`flex h-full min-w-0 flex-col gap-2 rounded-xl border p-2.5 transition ${
        slot.locked
          ? "border-slate-200 bg-slate-50 dark:border-gray-600 dark:bg-gray-700/40"
          : "border-slate-200 bg-white dark:border-gray-600 dark:bg-gray-700/60"
      }`}
    >
      <div className="flex items-center justify-between">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleSelect}
          className="h-4 w-4 accent-navy-600"
          title="Selecionar"
        />
        {slot.locked ? (
          <span className="text-sm" title="Bloqueado">
            🔒
          </span>
        ) : (
          <span
            className="h-2 w-2 rounded-full bg-emerald-500"
            title="Aberto"
            aria-hidden
          />
        )}
      </div>
      <button
        onClick={onClick}
        className="flex min-w-0 flex-col gap-1 text-left"
        title="Editar acesso dos esquadrões"
      >
        {ALL_SQUADRONS.map((sq) => (
          <SquadronRow key={sq} sq={sq} state={getAccess(slot.squadrons, sq)} />
        ))}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EditModal({
  editing,
  onChange,
  onClose,
  onSave,
}: {
  editing: { date: string; meal: MealType; access: AccessMap; existing?: Slot };
  onChange: (access: AccessMap) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  function setSquadron(sq: number, state: AccessState) {
    onChange({ ...editing.access, [sq]: state });
  }
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md p-5 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-navy-800 dark:text-gray-100">
          {MEAL_SHORT[editing.meal]} · {formatShortDate(editing.date)}
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-gray-400">
          {editing.existing
            ? "Defina o acesso de cada esquadrão a esta refeição."
            : "Esta refeição ainda não existe — será criada."}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn-secondary px-3 py-1.5 text-xs"
            onClick={() => onChange(uniformAccess("opcional"))}
          >
            Todos opcional
          </button>
          <button
            className="btn-secondary px-3 py-1.5 text-xs"
            onClick={() => onChange(uniformAccess("todos"))}
          >
            Todos obrigatório
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {ALL_SQUADRONS.map((sq) => (
            <div
              key={sq}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-gray-700"
            >
              <span className="font-medium text-slate-700 dark:text-gray-200">
                {sq}º Esquadrão
              </span>
              <AccessSelector
                value={editing.access[sq]}
                onChange={(v) => setSquadron(sq, v)}
              />
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={onSave}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CreatePanel({
  defaultFrom,
  defaultTo,
  existing,
  onCreated,
}: {
  defaultFrom: string;
  defaultTo: string;
  existing: Slot[];
  onCreated: (msg: string, ok?: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [config, setConfig] = useState<
    Record<MealType, { enabled: boolean; access: AccessMap }>
  >({
    cafe: { enabled: false, access: uniformAccess("opcional") },
    almoco: { enabled: false, access: uniformAccess("opcional") },
    janta: { enabled: false, access: uniformAccess("opcional") },
    ceia: { enabled: false, access: uniformAccess("opcional") },
  });
  const [busy, setBusy] = useState(false);

  function setMeal(
    mt: MealType,
    patch: Partial<{ enabled: boolean; access: AccessMap }>
  ) {
    setConfig((c) => ({ ...c, [mt]: { ...c[mt], ...patch } }));
  }

  function setSquadron(mt: MealType, sq: number, state: AccessState) {
    setMeal(mt, { access: { ...config[mt].access, [sq]: state } });
  }

  function applyAll(state: AccessState) {
    setConfig((c) => {
      const next = { ...c };
      for (const mt of MEAL_TYPES) {
        next[mt] = { ...c[mt], access: uniformAccess(state) };
      }
      return next;
    });
  }

  async function create() {
    if (from > to) {
      onCreated("Período inválido: a data inicial é depois da final", false);
      return;
    }
    const enabledMeals = MEAL_TYPES.filter((mt) => config[mt].enabled);
    if (enabledMeals.length === 0) {
      onCreated("Selecione ao menos uma refeição", false);
      return;
    }

    const payload: Array<{
      date: string;
      meal_type: MealType;
      squadrons: AccessMap;
    }> = [];
    for (const d of dateRange(from, to)) {
      for (const mt of enabledMeals) {
        if (!hasAnyAccess(config[mt].access)) {
          onCreated(`Defina ao menos um esquadrão para ${MEAL_SHORT[mt]}`, false);
          return;
        }
        payload.push({ date: d, meal_type: mt, squadrons: config[mt].access });
      }
    }

    const existingKeys = new Set(existing.map((s) => `${s.date}|${s.meal_type}`));
    const conflicts = payload.filter((p) =>
      existingKeys.has(`${p.date}|${p.meal_type}`)
    ).length;
    if (conflicts > 0) {
      if (
        !confirm(
          `${conflicts} refeição(ões) já existem nesse período e terão o acesso sobrescrito. Continuar?`
        )
      )
        return;
    }

    setBusy(true);
    try {
      const res = await apiFetch("/api/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: payload }),
      });
      if (res.ok)
        onCreated(`${payload.length} refeição(ões) criada(s)!`);
      else {
        const data = await res.json();
        onCreated(data.error ?? "Erro ao criar refeições", false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <h2 className="font-bold text-navy-800 dark:text-gray-100">
          ➕ Criar refeições
        </h2>
        <span
          className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4 animate-fade-in dark:border-gray-700">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-slate-500 dark:text-gray-400">Data início</span>
              <input
                type="date"
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-slate-500 dark:text-gray-400">Data fim</span>
              <input
                type="date"
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-600 dark:text-gray-300">
                Refeições e acesso
              </p>
              <div className="flex gap-2">
                <button
                  className="btn-secondary px-2.5 py-1 text-xs"
                  onClick={() => applyAll("opcional")}
                >
                  Todos opcional
                </button>
                <button
                  className="btn-secondary px-2.5 py-1 text-xs"
                  onClick={() => applyAll("todos")}
                >
                  Todos obrigatório
                </button>
              </div>
            </div>

            {/* Refeições: 2x2 no mobile, linhas finas empilhadas no desktop. */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              {MEAL_TYPES.map((mt) => (
                <label
                  key={mt}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    config[mt].enabled
                      ? "border-navy-300 bg-navy-50 text-navy-800 dark:border-navy-500/50 dark:bg-navy-500/15 dark:text-gray-100"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-navy-600"
                    checked={config[mt].enabled}
                    onChange={(e) => setMeal(mt, { enabled: e.target.checked })}
                  />
                  <span aria-hidden>{MEAL_ICONS[mt]}</span>
                  {MEAL_SHORT[mt]}
                </label>
              ))}
            </div>

            {/* Acesso por esquadrão das refeições marcadas (expande abaixo). */}
            {MEAL_TYPES.filter((mt) => config[mt].enabled).map((mt) => (
              <div
                key={mt}
                className="rounded-xl border border-navy-200 bg-navy-50/40 p-2.5 animate-fade-in dark:border-navy-500/40 dark:bg-navy-500/10"
              >
                <p className="mb-1.5 text-xs font-semibold text-navy-700 dark:text-gray-200">
                  {MEAL_ICONS[mt]} {MEAL_SHORT[mt]} — acesso por esquadrão
                </p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                  {ALL_SQUADRONS.map((sq) => (
                    <div
                      key={sq}
                      className="flex flex-wrap items-center justify-between gap-1.5"
                    >
                      <span className="text-xs text-slate-600 dark:text-gray-300">
                        {sq}º Esq
                      </span>
                      <AccessSelector
                        value={config[mt].access[sq]}
                        onChange={(v) => setSquadron(mt, sq, v)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button className="btn-primary w-full" onClick={create} disabled={busy}>
            {busy ? "Criando…" : "Criar refeições"}
          </button>
        </div>
      )}
    </section>
  );
}
