"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";

interface Menu {
  id: string;
  title: string;
  image_url: string;
}

// Cardápio no topo da página do cadete. Pode ter várias imagens no ar (uma por
// dia: sexta, sábado, domingo…): vira um carrossel que desliza para o lado,
// com o nome do dia e as bolinhas de navegação. Cada imagem é clicável para
// ampliar em tela cheia. Sem cardápio ativo, nada é renderizado.
export default function MenuBanner() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [current, setCurrent] = useState(0); // imagem visível no carrossel
  const [zoom, setZoom] = useState<number | null>(null); // índice ampliado
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiFetch("/api/menu-photo");
        const data = await res.json();
        if (!active || !res.ok) return;
        // `menus` é o formato novo; `menu` cobre uma resposta antiga em cache.
        setMenus(data.menus ?? (data.menu ? [data.menu] : []));
      } catch {
        /* silencioso: o cardápio é opcional */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Setas do teclado na tela cheia (desktop).
  useEffect(() => {
    if (zoom === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setZoom(null);
      if (e.key === "ArrowRight") setZoom((z) => (z === null ? z : Math.min(z + 1, menus.length - 1)));
      if (e.key === "ArrowLeft") setZoom((z) => (z === null ? z : Math.max(z - 1, 0)));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, menus.length]);

  if (menus.length === 0) return null;

  const many = menus.length > 1;

  // Qual imagem está centralizada agora (a largura de cada slide é a largura
  // total dividida pelo número de imagens).
  function onScroll() {
    const el = track.current;
    if (!el || !many) return;
    const slide = el.scrollWidth / menus.length;
    setCurrent(Math.min(menus.length - 1, Math.round(el.scrollLeft / slide)));
  }

  function goTo(i: number) {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: (el.scrollWidth / menus.length) * i, behavior: "smooth" });
    setCurrent(i);
  }

  return (
    <>
      <div className="cad-menu-wrap">
        <div className="cad-menu-track" ref={track} onScroll={onScroll}>
          {menus.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className="cad-menu-slide"
              onClick={() => setZoom(i)}
              aria-label={`Ampliar cardápio: ${m.title}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.image_url} alt={m.title} />
              {many && <span className="cad-menu-tag">{m.title}</span>}
            </button>
          ))}
        </div>

        {many && (
          <div className="cad-menu-dots">
            {menus.map((m, i) => (
              <button
                key={m.id}
                type="button"
                className={`cad-menu-dot${i === current ? " on" : ""}`}
                onClick={() => goTo(i)}
                aria-label={`Ver o cardápio: ${m.title}`}
                aria-current={i === current}
              />
            ))}
          </div>
        )}
      </div>

      {zoom !== null && menus[zoom] && (
        <div className="cad-overlay" onClick={() => setZoom(null)}>
          <button
            type="button"
            onClick={() => setZoom(null)}
            aria-label="Fechar"
            className="cad-x"
            style={{ position: "absolute", right: 24, top: 24 }}
          >
            ✕
          </button>

          {many && zoom > 0 && (
            <button
              type="button"
              className="cad-menu-nav left"
              aria-label="Imagem anterior"
              onClick={(e) => {
                e.stopPropagation();
                setZoom(zoom - 1);
              }}
            >
              ‹
            </button>
          )}
          {many && zoom < menus.length - 1 && (
            <button
              type="button"
              className="cad-menu-nav right"
              aria-label="Próxima imagem"
              onClick={(e) => {
                e.stopPropagation();
                setZoom(zoom + 1);
              }}
            >
              ›
            </button>
          )}

          <div
            onClick={(e) => e.stopPropagation()}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={menus[zoom].image_url}
              alt={menus[zoom].title}
              style={{
                maxHeight: many ? "80vh" : "88vh",
                maxWidth: "100%",
                borderRadius: 16,
                objectFit: "contain",
                animation: "cadSheetIn .28s cubic-bezier(.2,.8,.2,1)",
              }}
            />
            {many && (
              <span className="cad-menu-tag" style={{ position: "static" }}>
                {menus[zoom].title} · {zoom + 1} de {menus.length}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
