"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";

interface Menu {
  id: string;
  title: string;
  image_url: string;
}

// Mostra o cardápio ativo no topo da página do cadete. Se não houver cardápio
// ativo, não renderiza nada (sem espaço vazio). A imagem abre em tela cheia.
export default function MenuBanner() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiFetch("/api/menu-photo");
        const data = await res.json();
        if (active && res.ok) setMenu(data.menu ?? null);
      } catch {
        /* silencioso: o cardápio é opcional */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!menu) return null;

  return (
    <>
      <section className="card-interactive overflow-hidden animate-fade-in-up">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="block w-full text-left"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-navy-50 to-white px-4 py-2.5 dark:border-gray-700 dark:from-gray-700/40 dark:to-gray-800">
            <span aria-hidden>📋</span>
            <h3 className="text-sm font-semibold text-navy-800 dark:text-gray-100">
              {menu.title}
            </h3>
            <span className="ml-auto text-xs text-slate-400 dark:text-gray-500">
              toque para ampliar
            </span>
          </div>
          {/* Imagem inteira visível no topo (largura total, altura proporcional).
              Continua clicável para ampliar em tela cheia. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={menu.image_url}
            alt={menu.title}
            className="block h-auto w-full bg-slate-50 dark:bg-gray-900"
          />
        </button>
      </section>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={menu.image_url}
            alt={menu.title}
            className="max-h-[90vh] max-w-full rounded-lg object-contain animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-xl text-white backdrop-blur transition hover:bg-white/25"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
