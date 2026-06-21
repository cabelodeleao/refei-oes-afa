import { NextResponse } from "next/server";
import { supabaseAdmin, selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { getAccess, isOptOutSquadron } from "@/lib/constants";

export const runtime = "nodejs";

// GET /api/marks?from=YYYY-MM-DD&to=YYYY-MM-DD
// Retorna os slot_ids marcados pelo cadete logado.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // Paginado e filtrado por período via join em meal_slots.
  // Apenas opt-ins (attending=true) = refeições marcadas como "Sim".
  try {
    const marks = await selectAll<{ slot_id: string }>(
      "meal_marks",
      from || to ? "id, slot_id, meal_slots!inner(date)" : "id, slot_id",
      (q) => {
        q = q.eq("cadet_id", session.sub).eq("attending", true);
        if (from) q = q.gte("meal_slots.date", from);
        if (to) q = q.lte("meal_slots.date", to);
        return q;
      }
    );
    return NextResponse.json({ slot_ids: marks.map((m) => m.slot_id) });
  } catch {
    return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
  }
}

// PUT /api/marks  — marca/desmarca uma refeição (cadete)
// Body: { slot_id, marked }
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (session.is_admin) {
    return NextResponse.json(
      { error: "Administrador não marca refeições" },
      { status: 403 }
    );
  }

  let body: { slot_id?: string; marked?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const slotId = body.slot_id;
  const marked = body.marked === true;
  if (!slotId) {
    return NextResponse.json({ error: "slot_id obrigatório" }, { status: 400 });
  }

  // Validação server-side: slot existe, não está locked, pertence ao esquadrão.
  const { data: slot, error: slotErr } = await supabaseAdmin
    .from("meal_slots")
    .select("id, squadrons, locked")
    .eq("id", slotId)
    .maybeSingle();

  if (slotErr) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (!slot) {
    return NextResponse.json({ error: "Refeição não encontrada" }, { status: 404 });
  }
  if (slot.locked) {
    return NextResponse.json(
      { error: "Refeição bloqueada — não é possível alterar" },
      { status: 409 }
    );
  }
  const access = getAccess(slot.squadrons, session.squadron);
  if (access === "ninguem") {
    return NextResponse.json(
      { error: "Seu esquadrão não tem acesso a esta refeição" },
      { status: 403 }
    );
  }
  // "todos" estrito (1º e 2º esq.): não pode alterar.
  // "todos" opt-out (3º e 4º esq.): pode desmarcar, default é "Sim".
  if (access === "todos" && !isOptOutSquadron(session.squadron)) {
    return NextResponse.json(
      { error: "Refeição obrigatória — não é possível desmarcar" },
      { status: 409 }
    );
  }

  const isOptOut = access === "todos"; // aqui só chega 3º/4º (estrito já barrado)

  // Modelo de armazenamento (uma linha = escolha explícita):
  //  - opcional: "Sim" => linha attending=true; "Não" => sem linha (default Não).
  //  - opt-out:  "Sim" => sem linha (default Sim);  "Não" => linha attending=false.
  const storeRow = isOptOut ? !marked : marked; // precisamos persistir uma linha?
  const attending = marked; // a escolha do cadete

  if (storeRow) {
    const { error } = await supabaseAdmin
      .from("meal_marks")
      .upsert(
        { cadet_id: session.sub, slot_id: slotId, attending },
        { onConflict: "cadet_id,slot_id" }
      );
    if (error) {
      return NextResponse.json({ error: "Erro ao salvar" }, { status: 500 });
    }
  } else {
    // Volta ao default do modo: remove qualquer linha existente.
    const { error } = await supabaseAdmin
      .from("meal_marks")
      .delete()
      .eq("cadet_id", session.sub)
      .eq("slot_id", slotId);
    if (error) {
      return NextResponse.json({ error: "Erro ao salvar" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, slot_id: slotId, marked });
}
