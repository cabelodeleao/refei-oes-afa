import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const BUCKET = "cardapios";

type Params = { params: { id: string } };

// PATCH /api/menu-photo/[id]  (admin) — { active: boolean }
// Ativar um cardápio desativa os demais (só 1 ativo por vez).
export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }
  const active = body.active === true;

  if (active) {
    const { error } = await supabaseAdmin
      .from("menu_photos")
      .update({ active: false })
      .eq("active", true);
    if (error) {
      return NextResponse.json({ error: "Erro ao atualizar cardápio" }, { status: 500 });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("menu_photos")
    .update({ active })
    .eq("id", params.id)
    .select("id, title, image_url, active, created_at")
    .single();
  if (error) {
    return NextResponse.json({ error: "Erro ao atualizar cardápio" }, { status: 500 });
  }
  return NextResponse.json({ menu: data });
}

// DELETE /api/menu-photo/[id]  (admin) — remove o registro e o arquivo do storage.
export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { data: row, error: getErr } = await supabaseAdmin
    .from("menu_photos")
    .select("id, storage_path")
    .eq("id", params.id)
    .maybeSingle();
  if (getErr) {
    return NextResponse.json({ error: "Erro ao buscar cardápio" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Cardápio não encontrado" }, { status: 404 });
  }

  // Remove o arquivo do storage primeiro (best-effort; segue mesmo se falhar).
  if (row.storage_path) {
    await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path]);
  }

  const { error: delErr } = await supabaseAdmin
    .from("menu_photos")
    .delete()
    .eq("id", params.id);
  if (delErr) {
    return NextResponse.json({ error: "Erro ao remover cardápio" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
