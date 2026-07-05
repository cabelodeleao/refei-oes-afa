import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// DELETE /api/admin/cadets/[id]  (admin) — remove um cadete.
// As marcações, entradas e leituras de QR dele são apagadas junto (as FKs em
// meal_marks/meal_entries/scan_attempts usam ON DELETE CASCADE). Contas de
// admin e de fiscal não podem ser removidas por aqui (fiscais têm aba própria).
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const id = params.id;

  const { data: cadet, error } = await supabaseAdmin
    .from("cadets")
    .select("id, number, name, squadron, is_admin, is_fiscal")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (!cadet || cadet.is_admin || cadet.is_fiscal || cadet.squadron === 0) {
    return NextResponse.json({ error: "Cadete não encontrado" }, { status: 404 });
  }

  const { error: delErr } = await supabaseAdmin
    .from("cadets")
    .delete()
    .eq("id", id)
    .eq("is_admin", false)
    .eq("is_fiscal", false);

  if (delErr) {
    return NextResponse.json(
      { error: "Não foi possível excluir o cadete" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, number: cadet.number, name: cadet.name });
}
