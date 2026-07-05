import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const DEFAULT_PASSWORD = "123456";

// Números de cadete são armazenados como "25/217". Se vier só dígitos
// ("25217"), insere a barra depois da turma (2 primeiros dígitos).
function withSlash(raw: string): string {
  return /^\d{3,}$/.test(raw) ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw;
}

// GET /api/admin/cadets?q=texto  (admin)
// Busca cadetes por número ou nome (exclui a conta admin). Máx. 50 resultados.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const raw = new URL(req.url).searchParams.get("q") ?? "";
  // Remove caracteres que quebram o filtro .or do PostgREST (vírgula/parênteses).
  const q = raw.trim().replace(/[,()%]/g, "").slice(0, 50);

  let query = supabaseAdmin
    .from("cadets")
    .select("id, number, name, squadron")
    .gt("squadron", 0)
    .order("number", { ascending: true })
    .limit(50);

  if (q) {
    const filters = [`number.ilike.%${q}%`, `name.ilike.%${q}%`];
    // Busca digitada sem a barra ("25217") também encontra "25/217".
    const slashed = withSlash(q);
    if (slashed !== q) filters.push(`number.ilike.%${slashed}%`);
    query = query.or(filters.join(","));
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Erro ao buscar cadetes" }, { status: 500 });
  }

  return NextResponse.json({ cadets: data ?? [] });
}

// POST /api/admin/cadets  (admin) — cria um cadete.
// Body: { number, name, squadron }. Senha inicial padrão (123456) com troca
// obrigatória no 1º acesso; QR token gerado na hora.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { number?: string; name?: string; squadron?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const number = withSlash((body.number ?? "").trim());
  const name = (body.name ?? "").trim();
  const squadron = Number(body.squadron);

  if (!number || !name) {
    return NextResponse.json(
      { error: "Número e nome são obrigatórios" },
      { status: 400 }
    );
  }
  if (![1, 2, 3, 4].includes(squadron)) {
    return NextResponse.json(
      { error: "Selecione o esquadrão (1º a 4º)" },
      { status: 400 }
    );
  }

  const { data: created, error } = await supabaseAdmin
    .from("cadets")
    .insert({
      number,
      name,
      squadron,
      is_admin: false,
      is_fiscal: false,
      password_hash: bcrypt.hashSync(DEFAULT_PASSWORD, 10),
      qr_token: randomBytes(18).toString("base64url"),
      must_change_password: true,
    })
    .select("id, number, name, squadron")
    .single();

  if (error) {
    // 23505 = violação de unicidade (número já cadastrado).
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `Já existe uma conta com o número ${number}` },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Não foi possível criar o cadete" },
      { status: 500 }
    );
  }

  return NextResponse.json({ cadet: created });
}
