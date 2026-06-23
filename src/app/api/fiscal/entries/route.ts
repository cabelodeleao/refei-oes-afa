import { NextResponse } from "next/server";
import { selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import {
  MEAL_TYPES,
  getAccess,
  isOptOutSquadron,
  type MealType,
  type SquadronAccess,
} from "@/lib/constants";
import { todaySaoPaulo } from "@/lib/dates";

export const runtime = "nodejs";

interface SlotRow {
  id: string;
  date: string;
  meal_type: MealType;
  squadrons: SquadronAccess;
}
interface CadetRow {
  id: string;
  number: string;
  name: string;
  squadron: number;
}

// GET /api/fiscal/entries?date=YYYY-MM-DD  (admin)
// Relatório de fiscalização do dia: por refeição, quantos marcaram (esperado)
// vs quantos efetivamente entraram, e a lista de entradas registradas.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const date = new URL(req.url).searchParams.get("date") || todaySaoPaulo();

  let slots: SlotRow[];
  let cadets: CadetRow[];
  try {
    slots = await selectAll<SlotRow>(
      "meal_slots",
      "id, date, meal_type, squadrons",
      (q) => q.eq("date", date)
    );
    cadets = await selectAll<CadetRow>(
      "cadets",
      "id, number, name, squadron",
      (q) => q.gt("squadron", 0)
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar dados" }, { status: 500 });
  }

  slots.sort(
    (a, b) => MEAL_TYPES.indexOf(a.meal_type) - MEAL_TYPES.indexOf(b.meal_type)
  );

  const cadetById = new Map<string, CadetRow>();
  for (const c of cadets) cadetById.set(c.id, c);

  const rosterBySquadron = new Map<number, number>();
  for (const c of cadets) {
    rosterBySquadron.set(c.squadron, (rosterBySquadron.get(c.squadron) ?? 0) + 1);
  }

  const slotIds = slots.map((s) => s.id);

  // Marcações dos slots do dia.
  const optIn = new Map<string, number>(); // "slot|sq" opt-ins (attending=true)
  const optOut = new Map<string, number>(); // "slot|sq" opt-outs (attending=false)
  if (slotIds.length > 0) {
    let marks: Array<{ cadet_id: string; slot_id: string; attending: boolean }>;
    try {
      marks = await selectAll(
        "meal_marks",
        "id, cadet_id, slot_id, attending",
        (q) => q.in("slot_id", slotIds)
      );
    } catch {
      return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
    }
    for (const m of marks) {
      const sq = cadetById.get(m.cadet_id)?.squadron;
      if (!sq) continue;
      const key = `${m.slot_id}|${sq}`;
      if (m.attending) optIn.set(key, (optIn.get(key) ?? 0) + 1);
      else optOut.set(key, (optOut.get(key) ?? 0) + 1);
    }
  }

  // Esperado (quem deveria comer) por slot.
  const expectedOf = (s: SlotRow): number => {
    let total = 0;
    for (const sq of [1, 2, 3, 4]) {
      const state = getAccess(s.squadrons, sq);
      if (state === "opcional") {
        total += optIn.get(`${s.id}|${sq}`) ?? 0;
      } else if (state === "todos") {
        const roster = rosterBySquadron.get(sq) ?? 0;
        total += isOptOutSquadron(sq)
          ? roster - (optOut.get(`${s.id}|${sq}`) ?? 0)
          : roster;
      }
    }
    return total;
  };

  // Entradas registradas dos slots do dia.
  let entries: Array<{ cadet_id: string; slot_id: string; entered_at: string }> =
    [];
  if (slotIds.length > 0) {
    try {
      entries = await selectAll(
        "meal_entries",
        "id, cadet_id, slot_id, entered_at",
        (q) => q.in("slot_id", slotIds)
      );
    } catch {
      return NextResponse.json({ error: "Erro ao buscar entradas" }, { status: 500 });
    }
  }

  const enteredCount = new Map<string, number>();
  for (const e of entries) {
    enteredCount.set(e.slot_id, (enteredCount.get(e.slot_id) ?? 0) + 1);
  }

  const slotMeal = new Map<string, MealType>();
  for (const s of slots) slotMeal.set(s.id, s.meal_type);

  const slotStats = slots.map((s) => {
    const expected = expectedOf(s);
    const entered = enteredCount.get(s.id) ?? 0;
    return {
      id: s.id,
      meal_type: s.meal_type,
      expected,
      entered,
      no_show: Math.max(0, expected - entered),
    };
  });

  const entryList = entries
    .map((e) => {
      const c = cadetById.get(e.cadet_id);
      return {
        slot_id: e.slot_id,
        meal_type: slotMeal.get(e.slot_id) ?? null,
        number: c?.number ?? "—",
        name: c?.name ?? "—",
        squadron: c?.squadron ?? 0,
        entered_at: e.entered_at,
      };
    })
    .sort((a, b) => (a.entered_at < b.entered_at ? 1 : -1));

  return NextResponse.json({ date, slots: slotStats, entries: entryList });
}
