"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";

interface Menu {
  id: string;
  title: string;
  image_url: string;
}

// Cardápio ativo no topo da página do cadete: imagem inteira visível (tema
// escuro), clicável para ampliar em tela cheia. Sem cardápio ativo, nada é
// renderizado (sem espaço vazio).
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
      <button
        type="button"
        className="cad-menu"
        onClick={() => setOpen(true)}
        aria-label={`Ampliar cardápio: ${menu.title}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={menu.image_url} alt={menu.title} />
      </button>

      {open && (
        <div className="cad-overlay" onClick={() => setOpen(false)}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar"
            className="cad-x"
            style={{ position: "absolute", right: 24, top: 24 }}
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={menu.image_url}
            alt={menu.title}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxHeight: "88vh",
              maxWidth: "100%",
              borderRadius: 16,
              objectFit: "contain",
              animation: "cadSheetIn .28s cubic-bezier(.2,.8,.2,1)",
            }}
          />
        </div>
      )}
    </>
  );
}
