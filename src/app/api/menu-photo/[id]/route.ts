import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { MAX_MENU_IMAGES } from "@/lib/constants";

export const runtime = "nodejs";

const BUCKET = "cardapios";

type Params = { params: { id: string } };

// PATCH /api/menu-photo/[id]  (admin) — { active: boolean }
// O cardápio pode ter VÁRIAS imagens no ar ao mesmo tempo (uma por dia), então
// ativar uma imagem NÃO desativa as outras: ela entra no final da ordem de
// exibição. Desativar tira só aquela imagem do ar.
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

  // Ao ativar: respeita o teto de imagens no ar e coloca a imagem no final.
  const patch: { active: boolean; sort_order?: number } = { active };
  if (active) {
    const { data: current, error: curErr } = await supabaseAdmin
      .from("menu_photos")
      .select("id, sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: false });
    if (curErr) {
      return NextResponse.json({ error: "Erro ao atualizar cardápio" }, { status: 500 });
    }
    const actives = current ?? [];
    if (!actives.some((m) => m.id === params.id) && actives.length >= MAX_MENU_IMAGES) {
      return NextResponse.json(
        {
          error: `O cardápio já tem o máximo de ${MAX_MENU_IMAGES} imagens no ar. Desative uma antes de ativar outra.`,
        },
        { status: 409 }
      );
    }
    patch.sort_order = actives.length > 0 ? actives[0].sort_order + 1 : 0;
  }

  const { data, error } = await supabaseAdmin
    .from("menu_photos")
    .update(patch)
    .eq("id", params.id)
    .select("id, title, image_url, active, sort_order, created_at")
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
