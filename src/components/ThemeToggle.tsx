"use client";

import { useEffect, useState } from "react";

// Alterna entre claro/escuro adicionando/removendo a classe `dark` no <html>.
// O tema inicial já é aplicado pelo script inline no layout (sem flash); aqui
// só sincronizamos o estado do botão e persistimos a escolha no localStorage.
export default function ThemeToggle({
  className = "",
}: {
  className?: string;
}) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignora: indisponibilidade do localStorage não é crítica */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}
      title={dark ? "Modo claro" : "Modo escuro"}
      className={`flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-lg ring-1 ring-white/20 transition hover:bg-white/20 ${className}`}
    >
      {/* Antes de montar, evita divergência de hidratação mostrando vazio. */}
      {mounted ? (dark ? "☀️" : "🌙") : ""}
    </button>
  );
}
