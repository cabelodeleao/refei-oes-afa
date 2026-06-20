import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";

  if (newPassword.length < 6) {
    return NextResponse.json(
      { error: "A nova senha deve ter no mínimo 6 caracteres" },
      { status: 400 }
    );
  }

  const { data: cadet, error } = await supabaseAdmin
    .from("cadets")
    .select("id, password_hash")
    .eq("id", session.sub)
    .maybeSingle();

  if (error || !cadet) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }

  if (!bcrypt.compareSync(currentPassword, cadet.password_hash)) {
    return NextResponse.json(
      { error: "Senha atual incorreta" },
      { status: 400 }
    );
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  const { error: updErr } = await supabaseAdmin
    .from("cadets")
    .update({ password_hash: newHash })
    .eq("id", cadet.id);

  if (updErr) {
    return NextResponse.json(
      { error: "Não foi possível atualizar a senha" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
