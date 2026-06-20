import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { getAccess } from "@/lib/constants";

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

  // Filtra por período via join nos slots quando from/to informados.
  let slotIds: string[] | null = null;
  if (from || to) {
    let sq = supabaseAdmin.from("meal_slots").select("id");
    if (from) sq = sq.gte("date", from);
    if (to) sq = sq.lte("date", to);
    const { data: slots } = await sq;
    slotIds = (slots ?? []).map((s) => s.id as string);
    if (slotIds.length === 0) return NextResponse.json({ slot_ids: [] });
  }

  let query = supabaseAdmin
    .from("meal_marks")
    .select("slot_id")
    .eq("cadet_id", session.sub);
  if (slotIds) query = query.in("slot_id", slotIds);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
  }

  return NextResponse.json({ slot_ids: (data ?? []).map((m) => m.slot_id) });
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
  if (access === "todos") {
    return NextResponse.json(
      { error: "Refeição obrigatória — não é possível desmarcar" },
      { status: 409 }
    );
  }

  if (marked) {
    const { error } = await supabaseAdmin
      .from("meal_marks")
      .upsert(
        { cadet_id: session.sub, slot_id: slotId },
        { onConflict: "cadet_id,slot_id", ignoreDuplicates: true }
      );
    if (error) {
      return NextResponse.json({ error: "Erro ao marcar" }, { status: 500 });
    }
  } else {
    const { error } = await supabaseAdmin
      .from("meal_marks")
      .delete()
      .eq("cadet_id", session.sub)
      .eq("slot_id", slotId);
    if (error) {
      return NextResponse.json({ error: "Erro ao desmarcar" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, slot_id: slotId, marked });
}
