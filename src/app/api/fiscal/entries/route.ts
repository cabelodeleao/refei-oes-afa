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
interface ListItem {
  slot_id: string;
  meal_type: MealType | null;
  number: string;
  name: string;
  squadron: number;
  at: string; // horário do evento (entered_at / scanned_at). "" p/ no-show.
}

// GET /api/fiscal/entries?date=YYYY-MM-DD  (admin)
// Relatório de fiscalização do dia. Para cada refeição retorna contadores e
// quatro listas de cadetes:
//   - entries:   entraram normalmente (autorizado, em meal_entries)
//   - notMarked: tentaram entrar sem direito/sem marcar (scan 'nao_marcou')
//   - duplicates: passaram o QR mais de uma vez (scan 'duplicado')
//   - noShows:   marcaram/eram esperados mas NUNCA passaram o QR
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
  const slotMeal = new Map<string, MealType>();
  for (const s of slots) slotMeal.set(s.id, s.meal_type);

  // Marcações dos slots do dia: agregados (p/ "esperado") e por cadete (p/ no-show).
  const optIn = new Map<string, number>(); // "slot|sq" opt-ins (attending=true)
  const optOut = new Map<string, number>(); // "slot|sq" opt-outs (attending=false)
  const markByCadetSlot = new Map<string, boolean>(); // "slot|cadet" -> attending
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
      markByCadetSlot.set(`${m.slot_id}|${m.cadet_id}`, m.attending);
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

  // Um cadete é "esperado" naquele slot? (mesma regra do scan)
  const isExpected = (s: SlotRow, c: CadetRow): boolean => {
    const state = getAccess(s.squadrons, c.squadron);
    if (state === "ninguem") return false;
    const attending = markByCadetSlot.get(`${s.id}|${c.id}`);
    if (state === "opcional") return attending === true;
    // "todos": opt-out (3º/4º) pode ter desmarcado; 1º/2º é estrito.
    if (isOptOutSquadron(c.squadron)) return attending !== false;
    return true;
  };

  // Entradas registradas (oficial) dos slots do dia.
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
  const enteredSet = new Set<string>(); // "slot|cadet"
  for (const e of entries) {
    enteredCount.set(e.slot_id, (enteredCount.get(e.slot_id) ?? 0) + 1);
    enteredSet.add(`${e.slot_id}|${e.cadet_id}`);
  }

  // Tentativas de leitura (log completo): nao_marcou e duplicado.
  let attempts: Array<{
    cadet_id: string | null;
    slot_id: string;
    result: "autorizado" | "nao_marcou" | "duplicado";
    scanned_at: string;
  }> = [];
  if (slotIds.length > 0) {
    try {
      attempts = await selectAll(
        "scan_attempts",
        "id, cadet_id, slot_id, result, scanned_at",
        (q) => q.in("slot_id", slotIds)
      );
    } catch {
      return NextResponse.json({ error: "Erro ao buscar tentativas" }, { status: 500 });
    }
  }

  const toItem = (
    slotId: string,
    cadetId: string | null,
    at: string
  ): ListItem => {
    const c = cadetId ? cadetById.get(cadetId) : undefined;
    return {
      slot_id: slotId,
      meal_type: slotMeal.get(slotId) ?? null,
      number: c?.number ?? "—",
      name: c?.name ?? "—",
      squadron: c?.squadron ?? 0,
      at,
    };
  };

  const byTimeDesc = (a: ListItem, b: ListItem) => (a.at < b.at ? 1 : -1);

  const entryList: ListItem[] = entries
    .map((e) => toItem(e.slot_id, e.cadet_id, e.entered_at))
    .sort(byTimeDesc);

  const notMarkedList: ListItem[] = attempts
    .filter((a) => a.result === "nao_marcou")
    .map((a) => toItem(a.slot_id, a.cadet_id, a.scanned_at))
    .sort(byTimeDesc);

  const duplicateList: ListItem[] = attempts
    .filter((a) => a.result === "duplicado")
    .map((a) => toItem(a.slot_id, a.cadet_id, a.scanned_at))
    .sort(byTimeDesc);

  // No-show: cadetes esperados que NUNCA passaram o QR no slot.
  const noShowList: ListItem[] = [];
  for (const s of slots) {
    for (const c of cadets) {
      if (!isExpected(s, c)) continue;
      if (enteredSet.has(`${s.id}|${c.id}`)) continue;
      noShowList.push(toItem(s.id, c.id, ""));
    }
  }
  noShowList.sort((a, b) =>
    a.name === b.name ? 0 : a.name < b.name ? -1 : 1
  );

  // Contadores por slot.
  const notMarkedCount = new Map<string, number>();
  for (const a of notMarkedList) {
    notMarkedCount.set(a.slot_id, (notMarkedCount.get(a.slot_id) ?? 0) + 1);
  }
  const duplicateCount = new Map<string, number>();
  for (const a of duplicateList) {
    duplicateCount.set(a.slot_id, (duplicateCount.get(a.slot_id) ?? 0) + 1);
  }

  const slotStats = slots.map((s) => {
    const expected = expectedOf(s);
    const entered = enteredCount.get(s.id) ?? 0;
    return {
      id: s.id,
      meal_type: s.meal_type,
      expected,
      entered,
      no_show: Math.max(0, expected - entered),
      not_marked: notMarkedCount.get(s.id) ?? 0,
      duplicated: duplicateCount.get(s.id) ?? 0,
    };
  });

  return NextResponse.json({
    date,
    slots: slotStats,
    entries: entryList,
    notMarked: notMarkedList,
    duplicates: duplicateList,
    noShows: noShowList,
  });
}
