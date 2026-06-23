import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// GET /api/admin/fiscal  (admin) — lista os fiscais atuais.
export async function GET() {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("cadets")
    .select("id, number, name, squadron")
    .eq("is_fiscal", true)
    .gt("squadron", 0)
    .order("number", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar fiscais" }, { status: 500 });
  }
  return NextResponse.json({ fiscais: data ?? [] });
}

// POST /api/admin/fiscal  (admin) — { cadet_id, is_fiscal }
// Promove ou remove o papel de fiscal de um cadete.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { cadet_id?: string; is_fiscal?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const cadetId = body.cadet_id;
  const isFiscal = body.is_fiscal === true;
  if (!cadetId) {
    return NextResponse.json({ error: "cadet_id é obrigatório" }, { status: 400 });
  }

  const { data: cadet, error } = await supabaseAdmin
    .from("cadets")
    .select("id, is_admin, squadron")
    .eq("id", cadetId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (!cadet) {
    return NextResponse.json({ error: "Cadete não encontrado" }, { status: 404 });
  }
  if (cadet.is_admin || cadet.squadron === 0) {
    return NextResponse.json(
      { error: "Conta de administrador não pode ser fiscal." },
      { status: 400 }
    );
  }

  const { error: updErr } = await supabaseAdmin
    .from("cadets")
    .update({ is_fiscal: isFiscal })
    .eq("id", cadetId);

  if (updErr) {
    return NextResponse.json({ error: "Não foi possível atualizar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, cadet_id: cadetId, is_fiscal: isFiscal });
}
