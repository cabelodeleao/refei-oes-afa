import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const DEFAULT_PASSWORD = "123456";

// POST /api/admin/reset-password  (admin) — { cadet_id }
// Reseta a senha do cadete para a senha inicial padrão ("123456").
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { cadet_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const cadetId = body.cadet_id;
  if (!cadetId) {
    return NextResponse.json({ error: "cadet_id é obrigatório" }, { status: 400 });
  }

  const { data: cadet, error } = await supabaseAdmin
    .from("cadets")
    .select("id, number, name, is_admin")
    .eq("id", cadetId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (!cadet) {
    return NextResponse.json({ error: "Cadete não encontrado" }, { status: 404 });
  }
  // Não reseta contas de administrador para a senha padrão pública.
  if (cadet.is_admin) {
    return NextResponse.json(
      { error: "Não é possível resetar a senha de uma conta de administrador." },
      { status: 400 }
    );
  }

  const newHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
  const { error: updErr } = await supabaseAdmin
    .from("cadets")
    .update({ password_hash: newHash })
    .eq("id", cadet.id);

  if (updErr) {
    return NextResponse.json(
      { error: "Não foi possível resetar a senha" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    cadet_number: cadet.number,
    cadet_name: cadet.name,
  });
}
