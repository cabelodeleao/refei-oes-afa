"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";

const DEFAULT_PASSWORD = "123456";

// Botão no header do admin + modal de troca da própria senha.
// Usa a API genérica POST /api/auth/change-password (o admin é um usuário
// logado como outro qualquer para esse fim).
export default function AdminChangePassword() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  function close() {
    if (loading) return;
    setOpen(false);
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current) {
      toast.error("Informe a senha atual.");
      return;
    }
    if (next.length < 6) {
      toast.error("A nova senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (next === DEFAULT_PASSWORD) {
      toast.error("A nova senha não pode ser a senha padrão (123456).");
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
        return;
      }
      toast.success("Senha alterada com sucesso!");
      setOpen(false);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-white/20 transition hover:bg-white/20"
      >
        Trocar senha
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={close}
        >
          <form
            onSubmit={submit}
            className="card w-full max-w-md p-5 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-navy-800 dark:text-gray-100">
              Trocar senha
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-gray-300">
              Defina uma nova senha para a sua conta de administrador.
            </p>

            <div className="mt-4 space-y-3">
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
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={close}
                disabled={loading}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Salvando…" : "Salvar nova senha"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
