import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const DEFAULT_PASSWORD = "123456";

// GET /api/admin/fiscais  (admin) — lista as contas de fiscal (sargentos).
// Fiscais ficam na tabela cadets com is_fiscal=true e squadron=0.
export async function GET() {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("cadets")
    .select("id, number, name")
    .eq("is_fiscal", true)
    .order("number", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar fiscais" }, { status: 500 });
  }
  return NextResponse.json({ fiscais: data ?? [] });
}

// POST /api/admin/fiscais  (admin) — cria uma conta de fiscal.
// Body: { number, name, password? }
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { number?: string; name?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const number = body.number?.trim();
  const name = body.name?.trim();
  const password = (body.password ?? "").trim() || DEFAULT_PASSWORD;

  if (!number || !name) {
    return NextResponse.json(
      { error: "Identificador e nome são obrigatórios" },
      { status: 400 }
    );
  }
  if (password.length < 4) {
    return NextResponse.json(
      { error: "A senha deve ter ao menos 4 caracteres" },
      { status: 400 }
    );
  }

  // O identificador (number) não pode já existir (cadete, admin ou fiscal).
  const { data: existing, error: existErr } = await supabaseAdmin
    .from("cadets")
    .select("id")
    .eq("number", number)
    .maybeSingle();

  if (existErr) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json(
      { error: "Já existe uma conta com este identificador" },
      { status: 409 }
    );
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  const { data: created, error } = await supabaseAdmin
    .from("cadets")
    .insert({
      number,
      name,
      squadron: 0, // fiscais não pertencem a esquadrão (como o admin)
      is_admin: false,
      is_fiscal: true,
      password_hash: passwordHash,
    })
    .select("id, number, name")
    .single();

  if (error) {
    // 23505 = violação de unicidade (corrida no identificador).
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Já existe uma conta com este identificador" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Não foi possível criar o fiscal" },
      { status: 500 }
    );
  }

  return NextResponse.json({ fiscal: created });
}
