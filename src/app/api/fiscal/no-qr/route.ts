import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/fiscal/no-qr  (fiscal/admin)
// Body: { slot_id, person, cadet_id?, note? }
// Registra manualmente um cadete que tentou entrar SEM nenhum QR code.
// Grava em scan_attempts com result = 'sem_qr'. `person` é o nome/número
// digitado pelo fiscal; `cadet_id` é preenchido quando ele escolhe alguém da
// lista de sugestões (permite mostrar esquadrão no relatório do admin).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(session.is_fiscal || session.is_admin)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: {
    slot_id?: string;
    person?: string;
    cadet_id?: string | null;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const slotId = body.slot_id;
  const person = body.person?.trim();
  if (!slotId || !person) {
    return NextResponse.json(
      { error: "Refeição e pessoa são obrigatórios" },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin.from("scan_attempts").insert({
    slot_id: slotId,
    cadet_id: body.cadet_id || null,
    fiscal_id: session.sub,
    result: "sem_qr",
    flagged_person: person,
    fiscal_note: body.note?.trim() || null,
  });

  if (error) {
    return NextResponse.json({ error: "Erro ao registrar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
