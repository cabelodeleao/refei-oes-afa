import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// PUT /api/marks/late/approve  (admin)
// Body: { slot_ids: string[] }
// Aprova (libera) TODAS as marcações de última hora pendentes das refeições
// informadas de uma vez — não precisa aprovar cadete a cadete. Aprovadas, elas
// passam a valer para a fiscalização por QR (entrada autorizada = VERDE).
//
// (Reversão/fluxos futuros: se um dia precisarem "desaprovar", basta um segundo
//  endpoint espelhando este com late_approved=false — a coluna já existe.)
export async function PUT(req: Request) {
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
    return NextResponse.json({ error: "Nenhuma refeição informada" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("meal_marks")
    .update({ late_approved: true })
    .in("slot_id", ids)
    .eq("late_marking", true)
    .eq("late_approved", false)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: "Erro ao aprovar marcações de última hora" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, approved: data?.length ?? 0 });
}
