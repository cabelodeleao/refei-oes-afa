import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// PATCH /api/fiscal/scan/[id]  (fiscal/admin)
// Body: { flagged_person?, fiscal_note? }
// Anota numa tentativa duplicada quem realmente está usando o QR alheio
// (flagged_person) e/ou uma observação livre (fiscal_note).
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || !(session.is_fiscal || session.is_admin)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  }

  let body: { flagged_person?: string; fiscal_note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const flagged = body.flagged_person?.trim() || null;
  const note = body.fiscal_note?.trim() || null;
  if (!flagged && !note) {
    return NextResponse.json(
      { error: "Informe ao menos a pessoa ou uma observação" },
      { status: 400 }
    );
  }

  // Só permite anotar tentativas duplicadas (o caso de fraude de QR).
  const { data, error } = await supabaseAdmin
    .from("scan_attempts")
    .update({ flagged_person: flagged, fiscal_note: note })
    .eq("id", id)
    .eq("result", "duplicado")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Erro ao registrar" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Tentativa não encontrada" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
