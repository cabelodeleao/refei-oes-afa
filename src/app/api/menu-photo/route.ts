import { NextResponse } from "next/server";
import { supabaseAdmin, selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const BUCKET = "cardapios";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface MenuRow {
  id: string;
  title: string;
  image_url: string;
  storage_path: string | null;
  active: boolean;
  created_at: string;
}

// GET /api/menu-photo
//   ?all=1 (admin)  -> histórico completo (mais recente primeiro)
//   sem all         -> apenas o cardápio ativo (qualquer cadete logado)
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const wantsAll = new URL(req.url).searchParams.get("all") === "1";

  if (wantsAll) {
    if (!session.is_admin) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }
    try {
      const menus = await selectAll<MenuRow>(
        "menu_photos",
        "id, title, image_url, active, created_at",
        undefined,
        "created_at"
      );
      menus.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return NextResponse.json({ menus });
    } catch {
      return NextResponse.json({ error: "Erro ao buscar cardápios" }, { status: 500 });
    }
  }

  // Cardápio ativo (o mais recente entre os ativos).
  const { data, error } = await supabaseAdmin
    .from("menu_photos")
    .select("id, title, image_url, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar cardápio" }, { status: 500 });
  }
  return NextResponse.json({ menu: data ?? null });
}

// POST /api/menu-photo  (admin) — FormData { image: File, title: string }
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const title = String(form.get("title") ?? "").trim();
  const file = form.get("image");

  if (!title) {
    return NextResponse.json({ error: "Informe um título" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Selecione uma imagem" }, { status: 400 });
  }
  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Formato inválido. Use JPG, PNG ou WEBP." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Imagem muito grande (máx. 5 MB)." },
      { status: 400 }
    );
  }

  // Upload no bucket. Caminho único para evitar colisões e cache obsoleto.
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${Date.now()}-${rand}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (upErr) {
    return NextResponse.json(
      { error: "Falha ao enviar a imagem: " + upErr.message },
      { status: 500 }
    );
  }

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  const imageUrl = pub.publicUrl;

  // Desativa cardápios anteriores e insere o novo como ativo.
  const { error: deactErr } = await supabaseAdmin
    .from("menu_photos")
    .update({ active: false })
    .eq("active", true);
  if (deactErr) {
    await supabaseAdmin.storage.from(BUCKET).remove([path]); // rollback
    return NextResponse.json({ error: "Erro ao publicar cardápio" }, { status: 500 });
  }

  const { data, error: insErr } = await supabaseAdmin
    .from("menu_photos")
    .insert({ title, image_url: imageUrl, storage_path: path, active: true })
    .select("id, title, image_url, active, created_at")
    .single();
  if (insErr) {
    await supabaseAdmin.storage.from(BUCKET).remove([path]); // rollback
    return NextResponse.json({ error: "Erro ao salvar cardápio" }, { status: 500 });
  }

  return NextResponse.json({ menu: data });
}
