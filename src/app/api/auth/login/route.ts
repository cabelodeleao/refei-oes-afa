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

  // Rate-limit por número (case-insensitive e sem barra: "25217" e "25/217"
  // contam como a mesma conta): 5 falhas / 15 min.
  const rlKey = number.toLowerCase().replace(/\//g, "");
  if (!isAllowed(rlKey)) {
    return NextResponse.json(
      { error: `Muitas tentativas. Aguarde ${RATE_LIMIT_MINUTES} minutos.` },
      { status: 429 }
    );
  }

  const CADET_COLUMNS =
    "id, number, name, squadron, password_hash, is_admin, is_fiscal, must_change_password";

  // Busca pelo número exatamente como digitado ("25/217", "admin"...).
  let { data: cadet, error } = await supabaseAdmin
    .from("cadets")
    .select(CADET_COLUMNS)
    .eq("number", number)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }

  // Número digitado sem a barra ("25217"): tenta no formato do banco ("25/217").
  if (!cadet && /^\d{3,}$/.test(number)) {
    const withSlash = `${number.slice(0, 2)}/${number.slice(2)}`;
    const retry = await supabaseAdmin
      .from("cadets")
      .select(CADET_COLUMNS)
      .eq("number", withSlash)
      .maybeSingle();
    if (retry.error) {
      return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
    }
    cadet = retry.data;
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

  // Admin nunca é forçado a trocar a senha; cadetes/fiscais sim, no 1º acesso.
  const mustChange = Boolean(cadet.must_change_password) && !cadet.is_admin;

  const token = await signSession({
    sub: cadet.id,
    number: cadet.number,
    name: cadet.name,
    squadron: cadet.squadron,
    is_admin: cadet.is_admin,
    is_fiscal: cadet.is_fiscal ?? false,
    must_change_password: mustChange,
  });

  const redirect = mustChange
    ? "/trocar-senha"
    : cadet.is_admin
      ? "/admin"
      : cadet.is_fiscal
        ? "/fiscal"
        : "/cadete";

  const res = NextResponse.json({
    name: cadet.name,
    number: cadet.number,
    is_admin: cadet.is_admin,
    is_fiscal: cadet.is_fiscal ?? false,
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
