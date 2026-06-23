import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const DEFAULT_PASSWORD = "123456";

// POST /api/admin/fiscais/[id]/reset-password  (admin)
// Reseta a senha de uma conta de fiscal para a senha padrão ("123456").
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const id = params.id;

  const { data: fiscal, error } = await supabaseAdmin
    .from("cadets")
    .select("id, number, name, is_fiscal")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (!fiscal || !fiscal.is_fiscal) {
    return NextResponse.json({ error: "Fiscal não encontrado" }, { status: 404 });
  }

  const newHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
  const { error: updErr } = await supabaseAdmin
    .from("cadets")
    .update({ password_hash: newHash })
    .eq("id", id)
    .eq("is_fiscal", true);

  if (updErr) {
    return NextResponse.json(
      { error: "Não foi possível resetar a senha" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    number: fiscal.number,
    name: fiscal.name,
  });
}
