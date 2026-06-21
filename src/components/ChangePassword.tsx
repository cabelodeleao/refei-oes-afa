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
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-slate-700 dark:text-gray-200">
          <span>🔒</span> Trocar senha
        </span>
        <span
          className={`text-slate-400 transition-transform dark:text-gray-500 ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <form onSubmit={submit} className="space-y-3 border-t border-slate-100 px-5 py-4 animate-fade-in dark:border-gray-700">
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
