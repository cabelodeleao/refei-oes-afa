import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// PUT /api/slots/lock  (admin) — bloqueia/desbloqueia múltiplos slots
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { slot_ids?: string[]; locked?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const ids = body.slot_ids ?? [];
  const locked = body.locked === true;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "Nenhum slot informado" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("meal_slots")
    .update({ locked })
    .in("id", ids)
    .select("id, locked");

  if (error) {
    return NextResponse.json(
      { error: "Erro ao atualizar bloqueio" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, updated: data });
}
