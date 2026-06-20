import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { getAccess, type MealType, type SquadronAccess } from "@/lib/constants";

export const runtime = "nodejs";

interface CadetLite {
  number: string;
  name: string;
  squadron: number;
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

  let slotQuery = supabaseAdmin
    .from("meal_slots")
    .select("id, date, meal_type, squadrons, locked")
    .order("date", { ascending: true });
  if (from) slotQuery = slotQuery.gte("date", from);
  if (to) slotQuery = slotQuery.lte("date", to);

  const { data: slots, error: slotErr } = await slotQuery;
  if (slotErr) {
    return NextResponse.json({ error: "Erro ao buscar refeições" }, { status: 500 });
  }

  const slotList = (slots ?? []) as Array<{
    id: string;
    date: string;
    meal_type: MealType;
    squadrons: SquadronAccess;
    locked: boolean;
  }>;

  // Total de cadetes por esquadrão (exclui admin, squadron 0).
  // Usado para os esquadrões sem acesso (refeição obrigatória = todos comem).
  const squadronTotals: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const { data: cadetRows } = await supabaseAdmin
    .from("cadets")
    .select("squadron")
    .gt("squadron", 0);
  for (const c of cadetRows ?? []) {
    const sq = (c as { squadron: number }).squadron;
    if (squadronTotals[sq] !== undefined) squadronTotals[sq] += 1;
  }

  if (slotList.length === 0) {
    return NextResponse.json({ slots: [], squadronTotals });
  }

  const slotIds = slotList.map((s) => s.id);

  // Marcações + dados do cadete.
  const { data: marks, error: marksErr } = await supabaseAdmin
    .from("meal_marks")
    .select("slot_id, cadets!inner(number, name, squadron)")
    .in("slot_id", slotIds);

  if (marksErr) {
    return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
  }

  // Agrupa cadetes marcados por slot e por esquadrão.
  const bySlot = new Map<string, Map<number, CadetLite[]>>();
  for (const m of marks ?? []) {
    const cadet = (m as unknown as { cadets: CadetLite }).cadets;
    if (!cadet) continue;
    const slotId = (m as { slot_id: string }).slot_id;
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
