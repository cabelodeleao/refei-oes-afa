import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession, signSession } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/constants";

export const runtime = "nodejs";

const DEFAULT_PASSWORD = "123456";

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
  if (newPassword === DEFAULT_PASSWORD) {
    return NextResponse.json(
      { error: "A nova senha não pode ser a senha padrão (123456)" },
      { status: 400 }
    );
  }

  const { data: cadet, error } = await supabaseAdmin
    .from("cadets")
    .select(
      "id, number, name, squadron, is_admin, is_fiscal, password_hash, must_change_password"
    )
    .eq("id", session.sub)
    .maybeSingle();

  if (error || !cadet) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }

  // Na troca OBRIGATÓRIA (1º acesso) não pedimos a senha atual — o usuário
  // acabou de logar com ela. Na troca voluntária, validamos normalmente.
  const forced = Boolean(cadet.must_change_password) && !cadet.is_admin;
  if (!forced) {
    if (!bcrypt.compareSync(currentPassword, cadet.password_hash)) {
      return NextResponse.json(
        { error: "Senha atual incorreta" },
        { status: 400 }
      );
    }
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  const { error: updErr } = await supabaseAdmin
    .from("cadets")
    .update({ password_hash: newHash, must_change_password: false })
    .eq("id", cadet.id);

  if (updErr) {
    return NextResponse.json(
      { error: "Não foi possível atualizar a senha" },
      { status: 500 }
    );
  }

  // Reemite o token com must_change_password=false para liberar o acesso
  // imediatamente (o middleware deixa de exigir a troca).
  const token = await signSession({
    sub: cadet.id,
    number: cadet.number,
    name: cadet.name,
    squadron: cadet.squadron,
    is_admin: cadet.is_admin,
    is_fiscal: cadet.is_fiscal ?? false,
    must_change_password: false,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 dias
  });
  return res;
}
