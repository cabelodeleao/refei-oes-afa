"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";
import { SQUADRON_LABELS } from "@/lib/constants";

interface Cadet {
  id: string;
  number: string;
  name: string;
  squadron: number;
}

export default function Cadets() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [cadets, setCadets] = useState<Cadet[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<Cadet | null>(null);
  const [resetting, setResetting] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  // Busca com debounce (300ms).
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiFetch(
          `/api/admin/cadets?q=${encodeURIComponent(q.trim())}`
        );
        const data = await res.json();
        if (res.ok) setCadets(data.cadets ?? []);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [q]);

  async function resetPassword(cadet: Cadet) {
    setResetting(true);
    try {
      const res = await apiFetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadet_id: cadet.id }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          `Senha de ${data.cadet_number} resetada para 123456!`
        );
        setConfirming(null);
      } else {
        toast.error(data.error ?? "Erro ao resetar a senha.");
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="card p-5 animate-fade-in-up">
        <h2 className="font-bold text-navy-800 dark:text-gray-100">
          👤 Cadetes
        </h2>
        <p className="mb-3 text-xs text-slate-500 dark:text-gray-400">
          Busque por número ou nome para resetar a senha de um cadete que esqueceu
          a senha (volta para <span className="font-semibold">123456</span>).
        </p>
        <input
          className="input"
          placeholder="🔎 Buscar por número ou nome (ex: 23/001 ou Silva)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </section>

      <section className="card overflow-hidden animate-fade-in-up">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
            Buscando…
          </div>
        ) : cadets.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
            {q.trim()
              ? "Nenhum cadete encontrado."
              : "Digite para buscar um cadete."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-gray-700">
            {cadets.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50/60 dark:hover:bg-gray-700/40"
              >
                <span className="font-mono text-sm text-slate-500 dark:text-gray-400">
                  {c.number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-700 dark:text-gray-100">
                    {c.name}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-gray-500">
                    {SQUADRON_LABELS[c.squadron] ?? "—"}
                  </p>
                </div>
                <button
                  className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                  onClick={() => setConfirming(c)}
                >
                  Resetar senha
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirming && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => !resetting && setConfirming(null)}
        >
          <div
            className="card w-full max-w-md p-5 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-navy-800 dark:text-gray-100">
              Resetar senha
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-gray-300">
              Tem certeza que deseja resetar a senha de{" "}
              <span className="font-semibold">{confirming.number}</span>{" "}
              <span className="font-semibold">{confirming.name}</span> para{" "}
              <span className="font-semibold">123456</span>?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => setConfirming(null)}
                disabled={resetting}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={() => resetPassword(confirming)}
                disabled={resetting}
              >
                {resetting ? "Resetando…" : "Resetar para 123456"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
