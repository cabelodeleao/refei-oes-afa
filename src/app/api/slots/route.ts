import { NextResponse } from "next/server";
import { supabaseAdmin, selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import {
  MEAL_TYPES,
  ACCESS_STATES,
  getAccess,
  isOptOutSquadron,
  type MealType,
  type AccessState,
  type SquadronAccess,
} from "@/lib/constants";
import { todaySaoPaulo, parseISODate, addDays, toISODate } from "@/lib/dates";

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

  // Paginado: o cadete carrega todos os slots (sem from/to) e o total cresce
  // com o tempo, podendo passar de 1000.
  let slots: SlotRow[];
  try {
    slots = await selectAll<SlotRow>(
      "meal_slots",
      "id, date, meal_type, squadrons, locked",
      (q) => {
        if (from) q = q.gte("date", from);
        if (to) q = q.lte("date", to);
        return q;
      }
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar refeições" }, { status: 500 });
  }
  slots.sort((a, b) => a.date.localeCompare(b.date));

  // Admin vê todos os slots, sem filtro de esquadrão.
  if (session.is_admin) {
    return NextResponse.json({ slots });
  }

  // Refeições passadas somem para o cadete 1 dia após a data delas: ele vê até
  // o dia seguinte (data >= ontem). O cálculo de "hoje" usa o fuso de São Paulo
  // e a comparação é por data (YYYY-MM-DD ordena lexicograficamente). O slot não
  // é apagado — apenas fica oculto para o cadete (o admin continua vendo tudo).
  const cutoff = toISODate(addDays(parseISODate(todaySaoPaulo()), -1));

  // Cadete: vê slots em que seu esquadrão é "opcional" ou "todos".
  // "ninguem" não aparece. Inclui o estado de acesso e a marcação dele.
  const visible = slots
    .map((s) => ({ ...s, access: getAccess(s.squadrons, session.squadron) }))
    .filter((s) => s.access !== "ninguem" && s.date >= cutoff);

  // Escolhas explícitas do cadete (paginado): opt-ins e opt-outs.
  const optInSet = new Set<string>(); // attending=true  (Sim em opcional)
  const optOutSet = new Set<string>(); // attending=false (Não em opt-out)
  try {
    const marks = await selectAll<{ slot_id: string; attending: boolean }>(
      "meal_marks",
      "id, slot_id, attending",
      (q) => q.eq("cadet_id", session.sub)
    );
    for (const m of marks) {
      if (m.attending) optInSet.add(m.slot_id);
      else optOutSet.add(m.slot_id);
    }
  } catch {
    return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
  }

  const optOut = isOptOutSquadron(session.squadron);

  return NextResponse.json({
    slots: visible.map((s) => {
      let marked: boolean;
      if (s.access === "opcional") {
        marked = optInSet.has(s.id); // default Não
      } else if (optOut) {
        // "todos" opt-out (3º/4º): default Sim, exceto se desmarcou.
        marked = !optOutSet.has(s.id);
      } else {
        marked = true; // "todos" estrito (1º/2º)
      }
      return {
        id: s.id,
        date: s.date,
        meal_type: s.meal_type,
        locked: s.locked,
        access: s.access, // "opcional" | "todos"
        marked,
      };
    }),
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
