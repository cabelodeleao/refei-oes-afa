import { NextResponse } from "next/server";
import { selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import {
  getAccess,
  MEAL_TYPES,
  type MealType,
  type SquadronAccess,
} from "@/lib/constants";

export const runtime = "nodejs";

interface CadetLite {
  number: string;
  name: string;
  squadron: number;
}
interface SlotRow {
  id: string;
  date: string;
  meal_type: MealType;
  squadrons: SquadronAccess;
  locked: boolean;
}

// GET /api/marks/summary?from=YYYY-MM-DD&to=YYYY-MM-DD  (admin)
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
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
      "id, date, meal_type, squadrons, locked",
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

  // Marcações + dados do cadete. Paginado (podem ser milhares de linhas) e
  // filtrado pelo período via join em meal_slots — evita um IN(...) gigante.
  let marks: Array<{ slot_id: string; cadets: CadetLite }>;
  try {
    marks = await selectAll<{ slot_id: string; cadets: CadetLite }>(
      "meal_marks",
      "id, slot_id, cadets!inner(number, name, squadron), meal_slots!inner(date)",
      (q) => {
        if (from) q = q.gte("meal_slots.date", from);
        if (to) q = q.lte("meal_slots.date", to);
        return q;
      }
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
  }

  // Agrupa cadetes marcados por slot e por esquadrão.
  const bySlot = new Map<string, Map<number, CadetLite[]>>();
  for (const m of marks) {
    const cadet = m.cadets;
    if (!cadet) continue;
    const slotId = m.slot_id;
    if (!bySlot.has(slotId)) bySlot.set(slotId, new Map());
    const sqMap = bySlot.get(slotId)!;
    if (!sqMap.has(cadet.squadron)) sqMap.set(cadet.squadron, []);
    sqMap.get(cadet.squadron)!.push({
      number: cadet.number,
      name: cadet.name,
      squadron: cadet.squadron,
    });
  }

  const result = slotList.map((slot) => {
    const sqMap = bySlot.get(slot.id) ?? new Map<number, CadetLite[]>();
    const counts: Record<number, number> = {};
    const cadetsBySquadron: Record<number, CadetLite[]> = {};
    const access: Record<number, string> = {};
    let total = 0;

    for (const sq of [1, 2, 3, 4]) {
      const state = getAccess(slot.squadrons, sq);
      access[sq] = state;

      if (state === "opcional") {
        // Conta quem marcou voluntariamente (e guarda a lista p/ detalhe).
        const list = (sqMap.get(sq) ?? []).sort((a, b) =>
          a.number.localeCompare(b.number)
        );
        counts[sq] = list.length;
        cadetsBySquadron[sq] = list;
        total += list.length;
      } else if (state === "todos") {
        // Refeição obrigatória -> todos do esquadrão comem.
        total += squadronTotals[sq] ?? 0;
      }
      // "ninguem" não soma nada.
    }

    return {
      id: slot.id,
      date: slot.date,
      meal_type: slot.meal_type,
      squadrons: slot.squadrons,
      access, // estado por esquadrão: opcional | todos | ninguem
      locked: slot.locked,
      counts, // só esquadrões "opcional" (marcações voluntárias)
      total, // opcional (marcados) + todos (headcount)
      cadets: cadetsBySquadron,
    };
  });

  return NextResponse.json({ slots: result, squadronTotals });
}
