"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";

interface Menu {
  id: string;
  title: string;
  image_url: string;
  active: boolean;
  created_at: string;
}

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export default function MenuManager() {
  const toast = useToast();
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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

  // Libera a URL de preview ao trocar/desmontar.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function pickFile(f: File | null) {
    setError("");
    if (preview) URL.revokeObjectURL(preview);
    if (!f) {
      setFile(null);
      setPreview(null);
      return;
    }
    if (!ALLOWED.includes(f.type)) {
      setError("Formato inválido. Use JPG, PNG ou WEBP.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("Imagem muito grande (máx. 5 MB).");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setTitle("");
    setFile(null);
    setPreview(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function publish() {
    setError("");
    if (!title.trim()) {
      setError("Informe um título.");
      return;
    }
    if (!file) {
      setError("Selecione uma imagem.");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("image", file);
      const res = await apiFetch("/api/menu-photo", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro ao publicar.");
        toast.error(data.error ?? "Erro ao publicar cardápio.");
        return;
      }
      reset();
      await load();
      toast.success("Cardápio publicado!");
    } catch {
      setError("Erro de conexão.");
      toast.error("Erro de conexão.");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(menu: Menu, active: boolean) {
    const res = await apiFetch(`/api/menu-photo/${menu.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    if (res.ok) {
      toast.success(active ? "Cardápio ativado!" : "Cardápio desativado!");
      load();
    } else {
      toast.error("Erro ao atualizar o cardápio.");
    }
  }

  async function remove(menu: Menu) {
    if (!confirm(`Remover o cardápio “${menu.title}”?`)) return;
    const res = await apiFetch(`/api/menu-photo/${menu.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Cardápio removido!");
      load();
    } else {
      toast.error("Erro ao remover o cardápio.");
    }
  }

  return (
    <div className="space-y-5">
      {/* ---------- Upload ---------- */}
      <section className="card p-5 sm:p-6 animate-fade-in-up">
        <h2 className="font-bold text-navy-800 dark:text-gray-100">📋 Publicar cardápio</h2>
        <p className="mb-4 text-xs text-slate-500">
          A imagem fica visível para todos os cadetes na tela de marcação. Apenas
          um cardápio fica ativo por vez.
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-gray-200">
              Título
            </label>
            <input
              className="input"
              placeholder="Ex: Cardápio 16/06 a 22/06"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-gray-200">
              Imagem (JPG, PNG ou WEBP — máx. 5 MB)
            </label>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 dark:text-gray-300 file:mr-3 file:cursor-pointer
                file:rounded-lg file:border-0 file:bg-navy-600 file:px-4 file:py-2
                file:text-sm file:font-semibold file:text-white hover:file:bg-navy-700"
            />
          </div>

          {preview && (
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200 animate-fade-in dark:ring-gray-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Pré-visualização"
                className="max-h-72 w-full bg-slate-50 object-contain dark:bg-gray-900"
              />
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
              disabled={saving || !file || !title.trim()}
            >
              {saving ? "Publicando…" : "Publicar cardápio"}
            </button>
            {(file || title) && (
              <button className="btn-ghost" onClick={reset} disabled={saving}>
                Limpar
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Histórico ---------- */}
      <section className="card overflow-hidden animate-fade-in-up">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-gray-700">
          <h2 className="font-bold text-navy-800 dark:text-gray-100">Histórico de cardápios</h2>
          <p className="text-xs text-slate-500 dark:text-gray-400">
            Ative um cardápio anterior ou remova os que não usa mais.
          </p>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
            Carregando…
          </div>
        ) : menus.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
            Nenhum cardápio publicado ainda.
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
                        Ativo
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {m.active ? (
                    <button
                      className="btn-secondary px-3 py-1.5 text-xs"
                      onClick={() => setActive(m, false)}
                    >
                      Desativar
                    </button>
                  ) : (
                    <button
                      className="btn-primary px-3 py-1.5 text-xs"
                      onClick={() => setActive(m, true)}
                    >
                      Ativar
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
