import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// PUT /api/marks/late/approve  (admin)
// Body: { slot_ids?: string[] }  -> aprova todas as pendentes dessas refeições
//    ou { mark_ids?: string[] }  -> aprova marcações específicas (individual)
// Aprovadas, elas passam a valer para a fiscalização por QR (entrada = VERDE).
//
// (Reversão/fluxos futuros: se um dia precisarem "desaprovar", basta um segundo
//  endpoint espelhando este com late_approved=false — a coluna já existe.)
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { slot_ids?: string[]; mark_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const slotIds = body.slot_ids ?? [];
  const markIds = body.mark_ids ?? [];
  const byMark = Array.isArray(markIds) && markIds.length > 0;
  const bySlot = Array.isArray(slotIds) && slotIds.length > 0;

  if (!byMark && !bySlot) {
    return NextResponse.json(
      { error: "Informe slot_ids ou mark_ids" },
      { status: 400 }
    );
  }

  // Aprova por linha específica (individual) ou por refeição inteira (lote),
  // sempre restrito a marcações de última hora ainda pendentes.
  let q = supabaseAdmin
    .from("meal_marks")
    .update({ late_approved: true })
    .eq("late_marking", true)
    .eq("late_approved", false);
  q = byMark ? q.in("id", markIds) : q.in("slot_id", slotIds);

  const { data, error } = await q.select("id");

  if (error) {
    return NextResponse.json(
      { error: "Erro ao aprovar marcações de última hora" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, approved: data?.length ?? 0 });
}
