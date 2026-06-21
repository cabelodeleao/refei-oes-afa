"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MEAL_TYPES,
  MEAL_SHORT,
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

const STATE_CHIP: Record<AccessState, string> = {
  opcional: "bg-sky-500 text-white",
  todos: "bg-emerald-500 text-white",
  ninguem: "bg-slate-200 text-slate-400",
};

interface Props {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}

export default function ManageMeals({ from, to, setFrom, setTo }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{
    date: string;
    meal: MealType;
    access: AccessMap;
    existing?: Slot;
  } | null>(null);
  const [toast, setToast] = useState<string>("");

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

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

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

  async function bulkLock(locked: boolean) {
    if (selected.size === 0) return;
    const res = await apiFetch("/api/slots/lock", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot_ids: [...selected], locked }),
    });
    if (res.ok) {
      showToast(locked ? "Refeições bloqueadas" : "Refeições desbloqueadas");
      setSelected(new Set());
      load();
    } else showToast("Erro ao atualizar bloqueio");
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
      showToast("Refeições removidas");
      setSelected(new Set());
      load();
    } else showToast("Erro ao remover");
  }

  async function saveEdit() {
    if (!editing) return;
    if (!hasAnyAccess(editing.access)) {
      showToast("Defina ao menos um esquadrão como Opcional ou Todos");
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
      showToast("Refeição salva");
      setEditing(null);
      load();
    } else showToast("Erro ao salvar");
  }

  return (
    <div className="space-y-6">
      <CreatePanel
        defaultFrom={from}
        defaultTo={to}
        existing={slots}
        onCreated={(msg) => {
          showToast(msg);
          load();
        }}
      />

      {/* Grid de slots existentes */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-navy-800">Refeições criadas</h2>
            <p className="text-xs text-slate-500">
              {formatShortDate(from)} a {formatShortDate(to)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => shiftWeek(-1)}>
              ← Semana
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                const w = startOfWeek(new Date());
                setFrom(toISODate(w));
                setTo(toISODate(addDays(w, 6)));
                setSelected(new Set());
              }}
            >
              Hoje
            </button>
            <button className="btn-secondary" onClick={() => shiftWeek(1)}>
              Semana →
            </button>
          </div>
        </div>

        {/* Filtro manual de período */}
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/50 px-5 py-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">De</span>
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-2 py-1.5"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Até</span>
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-2 py-1.5"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>

        {/* Ações em lote + legenda */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <span className="text-sm text-slate-500">
            {selected.size} selecionada(s)
          </span>
          <button
            className="btn-secondary"
            disabled={selected.size === 0}
            onClick={() => bulkLock(true)}
          >
            🔒 Bloquear
          </button>
          <button
            className="btn-secondary"
            disabled={selected.size === 0}
            onClick={() => bulkLock(false)}
          >
            🔓 Desbloquear
          </button>
          <button
            className="btn-ghost text-red-600"
            disabled={selected.size === 0}
            onClick={bulkDelete}
          >
            Remover
          </button>
          <div className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            <Legend chip="bg-sky-500" label="Opcional" />
            <Legend chip="bg-emerald-500" label="Todos" />
            <Legend chip="bg-slate-300" label="Ninguém" />
          </div>
        </div>

        {/* Tabela grid */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-semibold">Dia</th>
                {MEAL_TYPES.map((mt) => (
                  <th key={mt} className="px-3 py-2.5 font-semibold">
                    {MEAL_SHORT[mt]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {days.map((d) => (
                <tr key={d} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="font-semibold text-navy-800">
                      {formatShortDate(d)}
                    </div>
                    <div className="text-xs capitalize text-slate-400">
                      {weekdayShort(d)}
                    </div>
                  </td>
                  {MEAL_TYPES.map((mt) => {
                    const slot = slotMap.get(`${d}|${mt}`);
                    return (
                      <td key={mt} className="px-3 py-3">
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
              ))}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="px-5 py-4 text-center text-sm text-slate-400">
            Carregando…
          </div>
        )}
      </section>

      {editing && (
        <EditModal
          editing={editing}
          onChange={(access) => setEditing({ ...editing, access })}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-navy-800 px-4 py-2.5 text-sm font-medium text-white shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Legend({ chip, label }: { chip: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded ${chip}`} />
      {label}
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
  const options: { key: AccessState; active: string }[] = [
    { key: "opcional", active: "bg-sky-500 text-white" },
    { key: "todos", active: "bg-emerald-500 text-white" },
    { key: "ninguem", active: "bg-slate-400 text-white" },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-slate-300">
      {options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={`px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${
            i > 0 ? "border-l border-slate-300" : ""
          } ${
            value === o.key ? o.active : "bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          {ACCESS_LABELS[o.key]}
        </button>
      ))}
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
        className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-slate-200 px-2 py-2 text-slate-300 transition hover:border-navy-400 hover:text-navy-500"
        title="Criar refeição"
      >
        +
      </button>
    );
  }
  return (
    <div
      className={`rounded-lg border px-2 py-2 transition ${
        slot.locked ? "border-slate-200 bg-slate-100" : "border-slate-200 bg-white"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleSelect}
          className="h-4 w-4 accent-navy-600"
          title="Selecionar"
        />
        {slot.locked ? (
          <span title="Bloqueado">🔒</span>
        ) : (
          <span title="Aberto" className="text-emerald-500">
            ●
          </span>
        )}
      </div>
      <button
        onClick={onClick}
        className="flex flex-wrap gap-1"
        title="Editar acesso dos esquadrões"
      >
        {ALL_SQUADRONS.map((sq) => {
          const state = getAccess(slot.squadrons, sq);
          return (
            <span
              key={sq}
              className={`chip h-5 w-5 justify-center ${STATE_CHIP[state]}`}
              title={`${sq}º Esq: ${ACCESS_LABELS[state]}`}
            >
              {sq}
            </span>
          );
        })}
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
        <h3 className="text-lg font-bold text-navy-800">
          {MEAL_SHORT[editing.meal]} · {formatShortDate(editing.date)}
        </h3>
        <p className="mt-1 text-sm text-slate-500">
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
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2"
            >
              <span className="font-medium text-slate-700">{sq}º Esquadrão</span>
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
  onCreated: (msg: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [config, setConfig] = useState<
    Record<MealType, { enabled: boolean; access: AccessMap }>
  >({
    cafe: { enabled: false, access: uniformAccess("opcional") },
    almoco: { enabled: true, access: uniformAccess("opcional") },
    janta: { enabled: true, access: uniformAccess("opcional") },
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
      onCreated("Período inválido: a data inicial é depois da final");
      return;
    }
    const enabledMeals = MEAL_TYPES.filter((mt) => config[mt].enabled);
    if (enabledMeals.length === 0) {
      onCreated("Selecione ao menos uma refeição");
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
          onCreated(`Defina ao menos um esquadrão para ${MEAL_SHORT[mt]}`);
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
      if (res.ok) onCreated(`${payload.length} refeição(ões) criada(s)/atualizada(s)`);
      else {
        const data = await res.json();
        onCreated(data.error ?? "Erro ao criar refeições");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4"
      >
        <h2 className="font-bold text-navy-800">➕ Criar refeições</h2>
        <span className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-slate-100 px-5 py-5 animate-fade-in">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-slate-500">Data início</span>
              <input
                type="date"
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-slate-500">Data fim</span>
              <input
                type="date"
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-600">
                Refeições e acesso por esquadrão
              </p>
              <div className="flex gap-2">
                <button
                  className="btn-secondary px-3 py-1.5 text-xs"
                  onClick={() => applyAll("opcional")}
                >
                  Todos opcional
                </button>
                <button
                  className="btn-secondary px-3 py-1.5 text-xs"
                  onClick={() => applyAll("todos")}
                >
                  Todos obrigatório
                </button>
              </div>
            </div>

            {MEAL_TYPES.map((mt) => (
              <div
                key={mt}
                className={`rounded-xl border p-3 transition ${
                  config[mt].enabled
                    ? "border-navy-200 bg-navy-50/40"
                    : "border-slate-200"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-navy-600"
                    checked={config[mt].enabled}
                    onChange={(e) => setMeal(mt, { enabled: e.target.checked })}
                  />
                  {MEAL_SHORT[mt]}
                </label>

                {config[mt].enabled && (
                  <div className="mt-3 space-y-1.5">
                    {ALL_SQUADRONS.map((sq) => (
                      <div
                        key={sq}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="text-sm text-slate-600">{sq}º Esq</span>
                        <AccessSelector
                          value={config[mt].access[sq]}
                          onChange={(v) => setSquadron(mt, sq, v)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <button className="btn-primary w-full sm:w-auto" onClick={create} disabled={busy}>
            {busy ? "Criando…" : "Criar refeições"}
          </button>
        </div>
      )}
    </section>
  );
}
