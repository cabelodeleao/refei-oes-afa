import { NextResponse } from "next/server";
import { selectAll } from "@/lib/supabase";
import { getSession, canViewSummary } from "@/lib/auth";
import {
  getAccess,
  MEAL_TYPES,
  type MealType,
  type SquadronAccess,
} from "@/lib/constants";
import {
  effectiveLocked,
  nowSaoPauloStamp,
  type LockOverride,
} from "@/lib/dates";

export const runtime = "nodejs";

interface SlotRow {
  id: string;
  date: string;
  meal_type: MealType;
  squadrons: SquadronAccess;
  lock_override: LockOverride;
}

// GET /api/marks/summary?from=YYYY-MM-DD&to=YYYY-MM-DD  (admin e rancho)
export async function GET(req: Request) {
  const session = await getSession();
  if (!canViewSummary(session)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let slotList: SlotRow[];
  let squadronTotals: Record<number, number>;
  try {
    // Paginado: o intervalo pode ter > 1000 slots.
    slotList = await selectAll<SlotRow>(
      "meal_slots",
      "id, date, meal_type, squadrons, lock_override",
      (q) => {
        if (from) q = q.gte("date", from);
        if (to) q = q.lte("date", to);
        return q;
      }
    );
    slotList.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return MEAL_TYPES.indexOf(a.meal_type) - MEAL_TYPES.indexOf(b.meal_type);
    });

    // Total de cadetes por esquadrão (exclui admin, squadron 0). Paginado.
    squadronTotals = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const cadetRows = await selectAll<{ squadron: number }>(
      "cadets",
      "id, squadron",
      (q) => q.gt("squadron", 0)
    );
    for (const c of cadetRows) {
      if (squadronTotals[c.squadron] !== undefined) squadronTotals[c.squadron] += 1;
    }
  } catch {
    return NextResponse.json({ error: "Erro ao buscar dados" }, { status: 500 });
  }

  if (slotList.length === 0) {
    return NextResponse.json({ slots: [], squadronTotals });
  }

  // Marcações: só precisamos do esquadrão de cada cadete para CONTAR (a lista
  // de nomes é carregada sob demanda em /api/marks/detail). Paginado e filtrado
  // pelo período via join em meal_slots — evita um IN(...) gigante.
  let marks: Array<{
    slot_id: string;
    attending: boolean;
    late_marking: boolean;
    late_approved: boolean;
    cadets: { squadron: number };
  }>;
  try {
    marks = await selectAll(
      "meal_marks",
      "id, slot_id, attending, late_marking, late_approved, cadets!inner(squadron), meal_slots!inner(date)",
      (q) => {
        if (from) q = q.gte("meal_slots.date", from);
        if (to) q = q.lte("meal_slots.date", to);
        return q;
      }
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
  }

  // Por slot/esquadrão: opt-ins (attending=true) e opt-outs (attending=false).
  // Marcações de última hora PENDENTES (não aprovadas) NÃO entram no quantitativo
  // — só contam depois que o admin aprova. `pendingLate` guarda quantas há por
  // slot/esquadrão para descontá-las das duas fórmulas de contagem abaixo.
  const optIn = new Map<string, number>(); // "slotId|sq" -> nº de "Sim" (opcional)
  const optOut = new Map<string, number>(); // "slotId|sq" -> nº de "Não" (opt-out)
  const pendingLate = new Map<string, number>(); // "slotId|sq" -> nº última hora pendente
  for (const m of marks) {
    const squadron = m.cadets?.squadron;
    if (!squadron) continue;
    const key = `${m.slot_id}|${squadron}`;
    const target = m.attending ? optIn : optOut;
    target.set(key, (target.get(key) ?? 0) + 1);
    if (m.attending && m.late_marking && !m.late_approved) {
      pendingLate.set(key, (pendingLate.get(key) ?? 0) + 1);
    }
  }

  const now = nowSaoPauloStamp();
  const result = slotList.map((slot) => {
    const counts: Record<number, number> = {};
    const access: Record<number, string> = {};
    let total = 0;

    for (const sq of [1, 2, 3, 4]) {
      const state = getAccess(slot.squadrons, sq);
      access[sq] = state;
      const key = `${slot.id}|${sq}`;

      if (state === "opcional") {
        // Quem marcou voluntariamente (opt-in), menos as de última hora pendentes.
        const n = (optIn.get(key) ?? 0) - (pendingLate.get(key) ?? 0);
        counts[sq] = n;
        total += n;
      } else if (state === "todos") {
        // Obrigatória: todos comem menos quem desmarcou (opt-out) e menos as
        // de última hora ainda pendentes (elas voltaram como attending=true).
        const n =
          (squadronTotals[sq] ?? 0) -
          (optOut.get(key) ?? 0) -
          (pendingLate.get(key) ?? 0);
        counts[sq] = n;
        total += n;
      }
      // "ninguem" não soma nada (sem entrada em counts).
    }

    return {
      id: slot.id,
      date: slot.date,
      meal_type: slot.meal_type,
      squadrons: slot.squadrons,
      access, // estado por esquadrão: opcional | todos | ninguem
      locked: effectiveLocked(slot.lock_override, slot.date, now),
      counts, // nº a exibir por esquadrão (opcional=opt-in; todos=efetivo - opt-outs)
      total,
    };
  });

  return NextResponse.json({ slots: result, squadronTotals });
}
