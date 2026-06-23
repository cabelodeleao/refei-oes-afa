import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { MEAL_TYPES, type MealType } from "@/lib/constants";
import { todaySaoPaulo } from "@/lib/dates";

export const runtime = "nodejs";

// GET /api/fiscal/slots?date=YYYY-MM-DD  (fiscal/admin)
// Retorna as refeições (slots) do dia para o seletor da fiscalização.
// Sem `date`, usa o dia atual (fuso de Brasília).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !(session.is_fiscal || session.is_admin)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const date = new URL(req.url).searchParams.get("date") || todaySaoPaulo();

  const { data, error } = await supabaseAdmin
    .from("meal_slots")
    .select("id, date, meal_type")
    .eq("date", date);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar refeições" }, { status: 500 });
  }

  const rows = data ?? [];

  // Quantas entradas já foram registradas em cada slot do dia (para o contador).
  // Usamos COUNT exato por slot (head:true não transfere linhas) — um dia pode
  // ter > 1000 entradas (629 cadetes × refeições), o que estouraria o limite
  // padrão de 1000 linhas do PostgREST se buscássemos as linhas.
  const entered = new Map<string, number>();
  await Promise.all(
    rows.map(async (s) => {
      const { count } = await supabaseAdmin
        .from("meal_entries")
        .select("id", { count: "exact", head: true })
        .eq("slot_id", s.id);
      entered.set(s.id, count ?? 0);
    })
  );

  const slots = rows
    .map((s) => ({ ...s, entered: entered.get(s.id) ?? 0 }))
    .sort(
      (a, b) =>
        MEAL_TYPES.indexOf(a.meal_type as MealType) -
        MEAL_TYPES.indexOf(b.meal_type as MealType)
    );

  return NextResponse.json({ date, slots });
}
