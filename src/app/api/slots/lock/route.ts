import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// PUT /api/slots/lock  (admin) — define a intenção manual de bloqueio de vários
// slots. `override`:
//   "bloqueado"    -> trava manualmente (independe da data). Encerra a marcação
//                     normal, mas o cadete ainda pode solicitar a refeição de
//                     última hora (sujeita à aprovação), igual ao automático.
//   "desbloqueado" -> abre exceção: liberado mesmo que o automático bloquearia
//   null           -> "Automático": volta a seguir a regra dos 4 dias
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { slot_ids?: string[]; override?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const ids = body.slot_ids ?? [];
  const raw = body.override;
  // Normaliza: só aceita os três estados válidos; qualquer outra coisa vira null.
  const override =
    raw === "bloqueado" || raw === "desbloqueado" ? raw : null;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "Nenhum slot informado" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("meal_slots")
    .update({ lock_override: override })
    .in("id", ids)
    .select("id, lock_override");

  if (error) {
    return NextResponse.json(
      { error: "Erro ao atualizar bloqueio" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, updated: data });
}
