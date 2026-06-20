import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import {
  MEAL_TYPES,
  ACCESS_STATES,
  getAccess,
  type MealType,
  type AccessState,
  type SquadronAccess,
} from "@/lib/constants";

export const runtime = "nodejs";

interface SlotRow {
  id: string;
  date: string;
  meal_type: MealType;
  squadrons: SquadronAccess;
  locked: boolean;
}

// GET /api/slots?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabaseAdmin
    .from("meal_slots")
    .select("id, date, meal_type, squadrons, locked")
    .order("date", { ascending: true });

  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Erro ao buscar refeições" }, { status: 500 });
  }

  const slots = (data ?? []) as SlotRow[];

  // Admin vê todos os slots, sem filtro de esquadrão.
  if (session.is_admin) {
    return NextResponse.json({ slots });
  }

  // Cadete: vê slots em que seu esquadrão é "opcional" ou "todos".
  // "ninguem" não aparece. Inclui o estado de acesso e a marcação dele.
  const visible = slots
    .map((s) => ({ ...s, access: getAccess(s.squadrons, session.squadron) }))
    .filter((s) => s.access !== "ninguem");

  const slotIds = visible.map((s) => s.id);
  let markedSet = new Set<string>();
  if (slotIds.length > 0) {
    const { data: marks } = await supabaseAdmin
      .from("meal_marks")
      .select("slot_id")
      .eq("cadet_id", session.sub)
      .in("slot_id", slotIds);
    markedSet = new Set((marks ?? []).map((m) => m.slot_id as string));
  }

  return NextResponse.json({
    slots: visible.map((s) => ({
      id: s.id,
      date: s.date,
      meal_type: s.meal_type,
      locked: s.locked,
      access: s.access, // "opcional" | "todos"
      marked: s.access === "todos" ? true : markedSet.has(s.id),
    })),
  });
}

// POST /api/slots  (admin) — cria/atualiza múltiplos slots
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: {
    slots?: Array<{
      date: string;
      meal_type: string;
      squadrons: Record<string, string>;
    }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const input = body.slots ?? [];
  if (!Array.isArray(input) || input.length === 0) {
    return NextResponse.json({ error: "Nenhum slot informado" }, { status: 400 });
  }

  const rows = [];
  for (const s of input) {
    if (!s.date || !MEAL_TYPES.includes(s.meal_type as MealType)) {
      return NextResponse.json({ error: "Dados de slot inválidos" }, { status: 400 });
    }
    // Normaliza o objeto de acesso: só esquadrões 1-4 com valores válidos.
    const squadrons: SquadronAccess = {};
    const raw = s.squadrons ?? {};
    for (const sq of [1, 2, 3, 4]) {
      const v = raw[String(sq)];
      if (ACCESS_STATES.includes(v as AccessState) && v !== "ninguem") {
        squadrons[String(sq)] = v as AccessState;
      }
    }
    if (Object.keys(squadrons).length === 0) {
      return NextResponse.json(
        { error: "Selecione ao menos um esquadrão (opcional ou todos)" },
        { status: 400 }
      );
    }
    rows.push({ date: s.date, meal_type: s.meal_type, squadrons });
  }

  // Upsert por (date, meal_type): mantém `locked` existente, atualiza squadrons.
  const { data, error } = await supabaseAdmin
    .from("meal_slots")
    .upsert(rows, { onConflict: "date,meal_type" })
    .select("id, date, meal_type, squadrons, locked");

  if (error) {
    return NextResponse.json(
      { error: "Erro ao criar refeições: " + error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ slots: data });
}

// DELETE /api/slots  (admin) — remove slots e marcações em cascata
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { slot_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const ids = body.slot_ids ?? [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "Nenhum slot informado" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("meal_slots").delete().in("id", ids);
  if (error) {
    return NextResponse.json({ error: "Erro ao remover refeições" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, removed: ids.length });
}
