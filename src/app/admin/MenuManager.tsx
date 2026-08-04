"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";
import {
  MAX_MENU_IMAGES,
  MENU_IMAGES_DEFAULT,
  MENU_TITLE_SUGGESTIONS,
} from "@/lib/constants";
import {
  compressImage,
  formatBytes,
  UPLOAD_TOTAL_LIMIT,
} from "@/lib/image-compress";

interface Menu {
  id: string;
  title: string;
  image_url: string;
  active: boolean;
  sort_order: number;
  created_at: string;
}

// Uma imagem escolhida para publicar (ainda não enviada). `file` já é a versão
// COMPRIMIDA no navegador; `originalSize` guarda o tamanho da foto original só
// para mostrar na tela o quanto ela encolheu.
interface Pick {
  file: File;
  title: string;
  preview: string; // object URL
  originalSize: number;
}

// Teto do arquivo ORIGINAL que aceitamos abrir. É folgado de propósito: a
// compressão no navegador derruba a foto para algumas centenas de KB antes de
// enviar, então uma foto grande de celular passa sem problema.
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export default function MenuManager() {
  const toast = useToast();
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);

  const [picks, setPicks] = useState<Pick[]>([]);
  // "substituir" troca o cardápio inteiro; "adicionar" mantém o que está no ar
  // e acrescenta (ex.: feriado emendado na segunda-feira).
  const [mode, setMode] = useState<"substituir" | "adicionar">("substituir");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Comprimindo as fotos escolhidas (dura 1–2 segundos por imagem).
  const [preparing, setPreparing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/menu-photo?all=1");
      const data = await res.json();
      if (res.ok) setMenus(data.menus ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Libera os object URLs das pré-visualizações ao desmontar.
  const picksRef = useRef<Pick[]>([]);
  picksRef.current = picks;
  useEffect(() => {
    return () => {
      for (const p of picksRef.current) URL.revokeObjectURL(p.preview);
    };
  }, []);

  const active = menus.filter((m) => m.active);
  // Tamanho do envio (já comprimido) e o original, para mostrar o ganho.
  const totalBytes = picks.reduce((sum, p) => sum + p.file.size, 0);
  const originalBytes = picks.reduce((sum, p) => sum + p.originalSize, 0);

  // Acrescenta arquivos à lista de publicação, já com um título sugerido
  // (Sexta-feira, Sábado, Domingo…) que o admin pode trocar. Cada foto é
  // COMPRIMIDA aqui no navegador antes de entrar na lista — é isso que faz o
  // envio de várias imagens caber no limite da Vercel.
  async function addFiles(list: FileList | null) {
    setError("");
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    if (fileInput.current) fileInput.current.value = ""; // permite reescolher
    const room = MAX_MENU_IMAGES - picks.length;
    if (room <= 0) {
      setError(`Você já selecionou o máximo de ${MAX_MENU_IMAGES} imagens.`);
      return;
    }

    setPreparing(true);
    try {
      const accepted: Pick[] = [];
      for (const f of incoming.slice(0, room)) {
        if (!ALLOWED.includes(f.type)) {
          setError(
            f.type === "image/heic" || /\.heic$/i.test(f.name)
              ? `“${f.name}”: formato HEIC do iPhone não é aceito. No iPhone: Ajustes → Câmera → Formatos → "Mais compatível".`
              : `“${f.name}”: formato inválido. Use JPG, PNG ou WEBP.`
          );
          continue;
        }
        if (f.size > MAX_BYTES) {
          setError(`“${f.name}”: arquivo grande demais (máx. 25 MB).`);
          continue;
        }
        const compressed = await compressImage(f);
        const index = picks.length + accepted.length;
        accepted.push({
          file: compressed,
          title: MENU_TITLE_SUGGESTIONS[index] ?? `Imagem ${index + 1}`,
          preview: URL.createObjectURL(compressed),
          originalSize: f.size,
        });
      }
      if (incoming.length > room) {
        setError(`Só cabem mais ${room} imagem(ns) — o máximo é ${MAX_MENU_IMAGES}.`);
      }
      if (accepted.length > 0) setPicks((prev) => [...prev, ...accepted]);
    } finally {
      setPreparing(false);
    }
  }

  function setTitle(i: number, title: string) {
    setPicks((prev) => prev.map((p, k) => (k === i ? { ...p, title } : p)));
  }

  function removePick(i: number) {
    setPicks((prev) => {
      URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, k) => k !== i);
    });
  }

  // Troca a imagem de lugar (a ordem da lista é a ordem que o cadete vê).
  function move(i: number, dir: -1 | 1) {
    setPicks((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function reset() {
    for (const p of picks) URL.revokeObjectURL(p.preview);
    setPicks([]);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function publish() {
    setError("");
    if (picks.length === 0) {
      setError("Selecione ao menos uma imagem.");
      return;
    }
    if (picks.some((p) => !p.title.trim())) {
      setError("Informe o título de cada imagem.");
      return;
    }
    // Rede de segurança: o servidor da Vercel recusa envios acima de ~4,5 MB
    // antes mesmo de chegar no nosso código (o erro que apareceria seria um
    // "erro de conexão" sem explicação). Depois da compressão isso praticamente
    // não acontece, mas se acontecer o aviso é claro e diz o que fazer.
    if (totalBytes > UPLOAD_TOTAL_LIMIT) {
      setError(
        picks.length === 1
          ? `Esta imagem ficou com ${formatBytes(totalBytes)}, acima do limite de ` +
            `${formatBytes(UPLOAD_TOTAL_LIMIT)} por envio. Tente uma versão menor ` +
            `da foto (ou um print dela).`
          : `As imagens somam ${formatBytes(totalBytes)} e o limite de um envio é ` +
            `${formatBytes(UPLOAD_TOTAL_LIMIT)}. Publique metade agora e o resto ` +
            `em seguida, usando "Acrescentar ao que já está no ar".`
      );
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("mode", mode);
      for (const p of picks) {
        fd.append("images", p.file);
        fd.append("titles", p.title.trim());
      }
      const res = await apiFetch("/api/menu-photo", { method: "POST", body: fd });
      // 413 vem do servidor da Vercel, sem JSON: o envio passou do limite antes
      // de chegar no nosso código.
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          data?.error ??
          (res.status === 413
            ? "O envio ficou grande demais. Publique menos imagens de uma vez."
            : "Erro ao publicar.");
        setError(msg);
        toast.error(msg);
        return;
      }
      reset();
      await load();
      toast.success(
        picks.length === 1 ? "Cardápio publicado!" : `${picks.length} imagens publicadas!`
      );
    } catch {
      setError("Erro de conexão.");
      toast.error("Erro de conexão.");
    } finally {
      setSaving(false);
    }
  }

  async function setMenuActive(menu: Menu, value: boolean) {
    const res = await apiFetch(`/api/menu-photo/${menu.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: value }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      toast.success(value ? "Imagem colocada no ar!" : "Imagem tirada do ar!");
      load();
    } else {
      toast.error(data?.error ?? "Erro ao atualizar o cardápio.");
    }
  }

  async function remove(menu: Menu) {
    if (!confirm(`Remover a imagem “${menu.title}”?`)) return;
    const res = await apiFetch(`/api/menu-photo/${menu.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Imagem removida!");
      load();
    } else {
      toast.error("Erro ao remover a imagem.");
    }
  }

  return (
    <div className="space-y-5">
      {/* ---------- Upload ---------- */}
      <section className="card p-5 sm:p-6 animate-fade-in-up">
        <h2 className="font-bold text-navy-800 dark:text-gray-100">
          📋 Publicar cardápio
        </h2>
        <p className="mb-4 text-xs text-slate-500 dark:text-gray-400">
          As imagens ficam visíveis para todos os cadetes na tela de marcação, uma
          por dia, deslizando para o lado. O normal são {MENU_IMAGES_DEFAULT}{" "}
          (sexta-feira, sábado e domingo) — em semana de feriado emendado, é só
          publicar mais uma (até {MAX_MENU_IMAGES}).
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-gray-200">
              Imagens (JPG, PNG ou WEBP). Pode selecionar várias de uma vez —
              pode mandar a foto direto do celular, do tamanho que ela for.
            </label>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              disabled={preparing || saving}
              onChange={(e) => addFiles(e.target.files)}
              className="block w-full text-sm text-slate-600 disabled:opacity-50 dark:text-gray-300 file:mr-3 file:cursor-pointer
                file:rounded-lg file:border-0 file:bg-navy-600 file:px-4 file:py-2
                file:text-sm file:font-semibold file:text-white hover:file:bg-navy-700"
            />
            <p className="mt-1.5 text-xs text-slate-400 dark:text-gray-500">
              As fotos são reduzidas aqui no seu aparelho antes de subir, para o
              envio ser rápido e não estourar o limite do servidor.
            </p>
          </div>

          {preparing && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-gray-700/40 dark:text-gray-300">
              Preparando as imagens…
            </p>
          )}

          {/* Lista das imagens escolhidas, na ordem em que o cadete vai ver. */}
          {picks.length > 0 && (
            <ul className="space-y-2">
              {picks.map((p, i) => (
                <li
                  key={p.preview}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 animate-fade-in dark:border-gray-700"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-gray-700 dark:text-gray-200">
                    {i + 1}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.preview}
                    alt={`Pré-visualização: ${p.title}`}
                    className="h-16 w-16 shrink-0 rounded-lg bg-slate-50 object-cover ring-1 ring-slate-200 dark:bg-gray-900 dark:ring-gray-700"
                  />
                  <div className="min-w-0 flex-1">
                    <input
                      className="input w-full"
                      placeholder="Título (ex: Sexta-feira)"
                      value={p.title}
                      onChange={(e) => setTitle(i, e.target.value)}
                    />
                    <p className="mt-1 text-xs text-slate-400 dark:text-gray-500">
                      {p.file.size < p.originalSize
                        ? `${formatBytes(p.originalSize)} → ${formatBytes(p.file.size)}`
                        : formatBytes(p.file.size)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      className="btn-ghost px-2 py-1.5 text-xs"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      title="Mover para cima"
                      aria-label={`Mover ${p.title} para cima`}
                    >
                      ↑
                    </button>
                    <button
                      className="btn-ghost px-2 py-1.5 text-xs"
                      onClick={() => move(i, 1)}
                      disabled={i === picks.length - 1}
                      title="Mover para baixo"
                      aria-label={`Mover ${p.title} para baixo`}
                    >
                      ↓
                    </button>
                    <button
                      className="btn-ghost px-2 py-1.5 text-xs text-red-600"
                      onClick={() => removePick(i)}
                      title="Tirar da publicação"
                      aria-label={`Tirar ${p.title} da publicação`}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Substituir x acrescentar ao que já está no ar. */}
          {picks.length > 0 && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-gray-700/40">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700 dark:text-gray-200">
                <input
                  type="radio"
                  className="mt-1"
                  checked={mode === "substituir"}
                  onChange={() => setMode("substituir")}
                />
                <span>
                  <strong>Substituir o cardápio atual</strong> — as{" "}
                  {active.length} imagem(ns) no ar saem e só as novas aparecem.
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700 dark:text-gray-200">
                <input
                  type="radio"
                  className="mt-1"
                  checked={mode === "adicionar"}
                  onChange={() => setMode("adicionar")}
                />
                <span>
                  <strong>Acrescentar ao que já está no ar</strong> — para incluir
                  um dia a mais (feriado) sem reenviar o resto.
                </span>
              </label>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              className="btn-success"
              onClick={publish}
              disabled={saving || preparing || picks.length === 0}
            >
              {saving
                ? "Publicando…"
                : picks.length > 1
                ? `Publicar ${picks.length} imagens`
                : "Publicar cardápio"}
            </button>
            {picks.length > 0 && (
              <button className="btn-ghost" onClick={reset} disabled={saving}>
                Limpar
              </button>
            )}
          </div>

          {picks.length > 0 && (
            <p className="text-xs text-slate-400 dark:text-gray-500">
              Envio: <strong>{formatBytes(totalBytes)}</strong>
              {originalBytes > totalBytes && (
                <> — as fotos originais somavam {formatBytes(originalBytes)}.</>
              )}
            </p>
          )}
        </div>
      </section>

      {/* ---------- Histórico ---------- */}
      <section className="card overflow-hidden animate-fade-in-up">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-gray-700">
          <h2 className="font-bold text-navy-800 dark:text-gray-100">
            Imagens do cardápio
          </h2>
          <p className="text-xs text-slate-500 dark:text-gray-400">
            {active.length === 0
              ? "Nenhuma imagem no ar — os cadetes não veem cardápio."
              : `No ar agora para os cadetes: ${active.length} imagem(ns). Tire do ar ou coloque no ar para mudar quantas aparecem.`}
          </p>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
            Carregando…
          </div>
        ) : menus.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
            Nenhuma imagem publicada ainda.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-gray-700">
            {menus.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50/60 dark:hover:bg-gray-700/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.image_url}
                  alt={m.title}
                  className="h-14 w-14 shrink-0 rounded-lg bg-slate-100 object-cover ring-1 ring-slate-200 dark:bg-gray-700 dark:ring-gray-600"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-700 dark:text-gray-100">
                    {m.title}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-gray-500">
                    {new Date(m.created_at).toLocaleDateString("pt-BR")}
                    {m.active && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        No ar
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {m.active ? (
                    <button
                      className="btn-secondary px-3 py-1.5 text-xs"
                      onClick={() => setMenuActive(m, false)}
                    >
                      Tirar do ar
                    </button>
                  ) : (
                    <button
                      className="btn-primary px-3 py-1.5 text-xs"
                      onClick={() => setMenuActive(m, true)}
                    >
                      Colocar no ar
                    </button>
                  )}
                  <button
                    className="btn-danger px-3 py-1.5 text-xs"
                    onClick={() => remove(m)}
                  >
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
