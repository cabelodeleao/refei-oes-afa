import { NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin, selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { MAX_MENU_IMAGES } from "@/lib/constants";

export const runtime = "nodejs";

const BUCKET = "cardapios";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB por imagem (limite do upload original)
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

// Otimização para economizar Storage (Supabase Free = 1 GB):
//   redimensiona p/ no máx. 1200px de largura (sem ampliar) e converte p/ WebP.
const MAX_WIDTH = 1200;
const WEBP_QUALITY = 80;

// Quantos cardápios ANTIGOS (já desativados) manter no Storage. Os ativos nunca
// são apagados pela limpeza automática, não importa quantos sejam.
const KEEP_INACTIVE = 9;

// Apaga de verdade (registro + arquivo no Storage) os cardápios desativados
// além dos KEEP_INACTIVE mais recentes. Best-effort: falhas aqui não invalidam
// o publish.
async function pruneOldMenus() {
  const rows = await selectAll<{
    id: string;
    storage_path: string | null;
    active: boolean;
    created_at: string;
  }>("menu_photos", "id, storage_path, active, created_at");
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const old = rows.filter((r) => !r.active).slice(KEEP_INACTIVE);
  if (old.length === 0) return;

  const paths = old
    .map((r) => r.storage_path)
    .filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    await supabaseAdmin.storage.from(BUCKET).remove(paths);
  }
  await supabaseAdmin
    .from("menu_photos")
    .delete()
    .in(
      "id",
      old.map((r) => r.id)
    );
}

interface MenuRow {
  id: string;
  title: string;
  image_url: string;
  storage_path: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
}

// GET /api/menu-photo
//   ?all=1 (admin)  -> histórico completo (mais recente primeiro)
//   sem all         -> TODAS as imagens ativas, na ordem de exibição
//                      (qualquer cadete logado)
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
        "id, title, image_url, active, sort_order, created_at",
        undefined,
        "created_at"
      );
      // Publicação mais recente primeiro; dentro da mesma publicação, na ordem
      // definida pelo admin.
      menus.sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || a.sort_order - b.sort_order
      );
      return NextResponse.json({ menus });
    } catch {
      return NextResponse.json({ error: "Erro ao buscar cardápios" }, { status: 500 });
    }
  }

  // Cardápio do cadete: todas as imagens ativas, na ordem de exibição.
  const { data, error } = await supabaseAdmin
    .from("menu_photos")
    .select("id, title, image_url, sort_order, created_at")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(MAX_MENU_IMAGES);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar cardápio" }, { status: 500 });
  }
  const menus = data ?? [];
  // `menu` (a primeira) fica por compatibilidade com clientes antigos.
  return NextResponse.json({ menus, menu: menus[0] ?? null });
}

// POST /api/menu-photo  (admin) — publica um CONJUNTO de imagens de uma vez.
// FormData:
//   images  (repetido) -> os arquivos, na ordem de exibição
//   titles  (repetido) -> o título de cada imagem, na mesma ordem
//   image / title      -> formato antigo de uma imagem só (compatibilidade)
//   mode               -> "substituir" (padrão): tira do ar as imagens ativas
//                         anteriores (elas continuam no histórico e podem ser
//                         reativadas)
//                         "adicionar": mantém o que já está no ar e acrescenta
//                         as novas no final (ex.: feriado na segunda-feira)
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

  const files = form
    .getAll("images")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const titles = form.getAll("titles").map((t) => String(t ?? "").trim());
  const addMode = String(form.get("mode") ?? "") === "adicionar";

  // Compatibilidade com o formato antigo (uma imagem por publicação).
  const single = form.get("image");
  if (files.length === 0 && single instanceof File && single.size > 0) {
    files.push(single);
    titles.push(String(form.get("title") ?? "").trim());
  }

  if (files.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos uma imagem" }, { status: 400 });
  }
  if (files.length > MAX_MENU_IMAGES) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_MENU_IMAGES} imagens por publicação.` },
      { status: 400 }
    );
  }

  // No modo "adicionar", o que já está no ar conta para o limite.
  if (addMode) {
    const { count } = await supabaseAdmin
      .from("menu_photos")
      .select("id", { count: "exact", head: true })
      .eq("active", true);
    if ((count ?? 0) + files.length > MAX_MENU_IMAGES) {
      return NextResponse.json(
        {
          error: `O cardápio pode ter no máximo ${MAX_MENU_IMAGES} imagens no ar (${count} já publicadas).`,
        },
        { status: 400 }
      );
    }
  }

  for (let i = 0; i < files.length; i++) {
    if (!titles[i]) {
      return NextResponse.json(
        { error: "Informe o título de cada imagem" },
        { status: 400 }
      );
    }
    if (!ALLOWED.has(files[i].type)) {
      return NextResponse.json(
        { error: `“${titles[i]}”: formato inválido. Use JPG, PNG ou WEBP.` },
        { status: 400 }
      );
    }
    if (files[i].size > MAX_BYTES) {
      return NextResponse.json(
        { error: `“${titles[i]}”: imagem muito grande (máx. 5 MB).` },
        { status: 400 }
      );
    }
  }

  // Comprime/redimensiona no servidor antes de salvar (economiza Storage):
  // máx. 1200px de largura, sem ampliar, e converte para WebP q80. Se qualquer
  // imagem falhar, desfaz os uploads já feitos (publicação é tudo ou nada).
  const uploaded: Array<{ path: string; url: string }> = [];
  const rollback = async () => {
    if (uploaded.length > 0) {
      await supabaseAdmin.storage
        .from(BUCKET)
        .remove(uploaded.map((u) => u.path));
    }
  };

  for (const file of files) {
    let optimized: Buffer;
    try {
      optimized = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate() // respeita orientação EXIF antes de redimensionar
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch {
      await rollback();
      return NextResponse.json(
        { error: "Não foi possível processar uma das imagens." },
        { status: 400 }
      );
    }

    // Caminho único (sempre .webp) p/ evitar cache obsoleto.
    const rand = Math.random().toString(36).slice(2, 10);
    const path = `${Date.now()}-${rand}.webp`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, optimized, { contentType: "image/webp", upsert: false });
    if (upErr) {
      await rollback();
      return NextResponse.json(
        { error: "Falha ao enviar a imagem: " + upErr.message },
        { status: 500 }
      );
    }
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    uploaded.push({ path, url: pub.publicUrl });
  }

  // "adicionar": mantém o que está no ar e entra no final da ordem.
  // "substituir" (padrão): tira as imagens ativas anteriores do ar.
  let offset = 0;
  if (addMode) {
    const { data: current, error: curErr } = await supabaseAdmin
      .from("menu_photos")
      .select("sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (curErr) {
      await rollback();
      return NextResponse.json({ error: "Erro ao publicar cardápio" }, { status: 500 });
    }
    offset = current && current.length > 0 ? current[0].sort_order + 1 : 0;
  } else {
    const { error: deactErr } = await supabaseAdmin
      .from("menu_photos")
      .update({ active: false })
      .eq("active", true);
    if (deactErr) {
      await rollback();
      return NextResponse.json({ error: "Erro ao publicar cardápio" }, { status: 500 });
    }
  }

  const { data, error: insErr } = await supabaseAdmin
    .from("menu_photos")
    .insert(
      uploaded.map((u, i) => ({
        title: titles[i],
        image_url: u.url,
        storage_path: u.path,
        active: true,
        sort_order: offset + i,
      }))
    )
    .select("id, title, image_url, active, sort_order, created_at");
  if (insErr) {
    await rollback();
    return NextResponse.json(
      { error: "Erro ao salvar cardápio: " + insErr.message },
      { status: 500 }
    );
  }

  // Limpeza dos cardápios antigos (registro + arquivo). Best-effort: se falhar,
  // o publish já está concluído e não deve retornar erro.
  try {
    await pruneOldMenus();
  } catch {
    /* limpeza é best-effort */
  }

  return NextResponse.json({ menus: data, menu: data?.[0] ?? null });
}
