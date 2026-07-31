import { NextResponse } from "next/server";
import { selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { MEAL_TYPES, type MealType } from "@/lib/constants";

export const runtime = "nodejs";

// Linha crua vinda do join meal_marks -> cadets + meal_slots.
interface LateRow {
  id: string;
  slot_id: string;
  late_marked_at: string | null;
  late_approved: boolean;
  cadets: { number: string; name: string; squadron: number } | null;
  meal_slots: { date: string; meal_type: MealType } | null;
}

// GET /api/marks/late?from=YYYY-MM-DD&to=YYYY-MM-DD  (admin)
// Lista as marcações de última hora (segunda chance) do período, agrupadas por
// refeição, separando pendentes de aprovadas. Serve para o admin comunicar o
// horário extra ao rancho e aprovar em lote.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let rows: LateRow[];
  try {
    // Paginado e filtrado pelo período via join em meal_slots.
    rows = await selectAll<LateRow>(
      "meal_marks",
      "id, slot_id, late_marked_at, late_approved, cadets!inner(number, name, squadron), meal_slots!inner(date, meal_type)",
      (q) => {
        q = q.eq("late_marking", true);
        if (from) q = q.gte("meal_slots.date", from);
        if (to) q = q.lte("meal_slots.date", to);
        return q;
      }
    );
  } catch {
    return NextResponse.json(
      { error: "Erro ao buscar marcações de última hora" },
      { status: 500 }
    );
  }

  // Agrupa por refeição (slot).
  const bySlot = new Map<
    string,
    {
      slot_id: string;
      date: string;
      meal_type: MealType;
      pending: number;
      approved: number;
      marks: Array<{
        number: string;
        name: string;
        squadron: number;
        late_marked_at: string | null;
        approved: boolean;
      }>;
    }
  >();

  let totalPending = 0;
  let totalApproved = 0;

  for (const r of rows) {
    if (!r.cadets || !r.meal_slots) continue;
    let g = bySlot.get(r.slot_id);
    if (!g) {
      g = {
        slot_id: r.slot_id,
        date: r.meal_slots.date,
        meal_type: r.meal_slots.meal_type,
        pending: 0,
        approved: 0,
        marks: [],
      };
      bySlot.set(r.slot_id, g);
    }
    g.marks.push({
      number: r.cadets.number,
      name: r.cadets.name,
      squadron: r.cadets.squadron,
      late_marked_at: r.late_marked_at,
      approved: r.late_approved,
    });
    if (r.late_approved) {
      g.approved += 1;
      totalApproved += 1;
    } else {
      g.pending += 1;
      totalPending += 1;
    }
  }

  const slots = Array.from(bySlot.values());
  // Ordena refeições por data e tipo; cadetes por esquadrão e número.
  slots.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return MEAL_TYPES.indexOf(a.meal_type) - MEAL_TYPES.indexOf(b.meal_type);
  });
  for (const g of slots) {
    g.marks.sort((a, b) => {
      if (a.squadron !== b.squadron) return a.squadron - b.squadron;
      return a.number.localeCompare(b.number);
    });
  }

  return NextResponse.json({ slots, totalPending, totalApproved });
}
