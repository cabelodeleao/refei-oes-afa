import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { signSession } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/constants";
import {
  isAllowed,
  recordFailure,
  reset,
  RATE_LIMIT_MINUTES,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { number?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const number = body.number?.trim();
  const password = body.password ?? "";

  if (!number || !password) {
    return NextResponse.json(
      { error: "Informe número e senha" },
      { status: 400 }
    );
  }

  // Rate-limit por número (case-insensitive): 5 falhas / 15 min.
  const rlKey = number.toLowerCase();
  if (!isAllowed(rlKey)) {
    return NextResponse.json(
      { error: `Muitas tentativas. Aguarde ${RATE_LIMIT_MINUTES} minutos.` },
      { status: 429 }
    );
  }

  const { data: cadet, error } = await supabaseAdmin
    .from("cadets")
    .select("id, number, name, squadron, password_hash, is_admin")
    .eq("number", number)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (!cadet) {
    recordFailure(rlKey);
    return NextResponse.json(
      { error: "Número ou senha incorretos" },
      { status: 401 }
    );
  }

  const ok = bcrypt.compareSync(password, cadet.password_hash);
  if (!ok) {
    recordFailure(rlKey);
    return NextResponse.json(
      { error: "Número ou senha incorretos" },
      { status: 401 }
    );
  }

  // Login bem-sucedido: zera o contador.
  reset(rlKey);

  const token = await signSession({
    sub: cadet.id,
    number: cadet.number,
    name: cadet.name,
    squadron: cadet.squadron,
    is_admin: cadet.is_admin,
  });

  const redirect = cadet.is_admin ? "/admin" : "/cadete";

  const res = NextResponse.json({
    name: cadet.name,
    number: cadet.number,
    is_admin: cadet.is_admin,
    redirect,
  });

  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 dias
  });

  return res;
}
