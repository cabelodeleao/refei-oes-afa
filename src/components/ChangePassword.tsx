"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";

export default function ChangePassword() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 6) {
      toast.error("A nova senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (next !== confirm) {
      toast.error("A confirmação não corresponde à nova senha.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao trocar a senha.");
      } else {
        toast.success("Senha alterada com sucesso!");
        setCurrent("");
        setNext("");
        setConfirm("");
        setOpen(false);
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-600 dark:text-gray-500 dark:hover:text-gray-300"
      >
        <span>🔒</span> Trocar senha
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <form
          onSubmit={submit}
          className="mt-3 w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200/70 animate-fade-in dark:bg-gray-800 dark:ring-gray-700"
        >
          <input
            className="input"
            type="password"
            placeholder="Senha atual"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Nova senha (mín. 6 caracteres)"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Confirmar nova senha"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
      )}
    </div>
  );
}
