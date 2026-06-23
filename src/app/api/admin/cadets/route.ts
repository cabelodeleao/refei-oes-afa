import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

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
    .select("id, number, name, squadron, is_fiscal")
    .gt("squadron", 0)
    .order("number", { ascending: true })
    .limit(50);

  if (q) {
    query = query.or(`number.ilike.%${q}%,name.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Erro ao buscar cadetes" }, { status: 500 });
  }

  return NextResponse.json({ cadets: data ?? [] });
}
