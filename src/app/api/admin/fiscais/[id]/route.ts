import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// DELETE /api/admin/fiscais/[id]  (admin) — remove uma conta de fiscal.
// O histórico de meal_entries criado por ele é preservado: a FK fiscal_id
// usa ON DELETE SET NULL (ver supabase-migration-fiscal-accounts.sql).
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const id = params.id;

  // Garante que estamos removendo de fato uma conta de fiscal (não um cadete
  // nem o admin).
  const { data: fiscal, error } = await supabaseAdmin
    .from("cadets")
    .select("id, is_fiscal")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (!fiscal || !fiscal.is_fiscal) {
    return NextResponse.json({ error: "Fiscal não encontrado" }, { status: 404 });
  }

  const { error: delErr } = await supabaseAdmin
    .from("cadets")
    .delete()
    .eq("id", id)
    .eq("is_fiscal", true);

  if (delErr) {
    return NextResponse.json(
      { error: "Não foi possível remover o fiscal" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id });
}
