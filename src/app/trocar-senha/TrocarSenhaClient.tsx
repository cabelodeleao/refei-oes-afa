"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

const DEFAULT_PASSWORD = "123456";

export default function TrocarSenhaClient({
  name,
  home,
}: {
  name: string;
  home: string;
}) {
  const router = useRouter();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (next.length < 6) {
      setError("A nova senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (next === DEFAULT_PASSWORD) {
      setError("A nova senha não pode ser a senha padrão (123456).");
      return;
    }
    if (next !== confirm) {
      setError("A confirmação não corresponde à nova senha.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível trocar a senha.");
        setLoading(false);
        return;
      }
      router.replace(home);
      router.refresh();
    } catch {
      setError("Erro de conexão. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-navy-600 px-4 py-10 dark:from-black dark:via-gray-950 dark:to-navy-900">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-navy-500/30 blur-3xl dark:bg-navy-700/30" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl dark:bg-navy-600/20" />

      <ThemeToggle className="absolute right-4 top-4" />

      <div className="relative w-full max-w-sm animate-fade-in-up">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-3xl shadow-lg ring-1 ring-white/20">
            🔒
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Crie sua senha
          </h1>
          <p className="mt-1.5 text-sm text-blue-100/80">
            Olá, {name}. Por segurança, defina uma senha pessoal antes de
            continuar.
          </p>
        </div>

        <div className="glass p-6 sm:p-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-blue-50/90">
                Nova senha
              </label>
              <input
                className="input-glass"
                type="password"
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-blue-50/90">
                Confirmar nova senha
              </label>
              <input
                className="input-glass"
                type="password"
                placeholder="Repita a nova senha"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-300/30 bg-red-500/20 px-3 py-2 text-sm text-red-50">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Salvando..." : "Salvar e continuar"}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-blue-100/60">
          Você não poderá usar a senha padrão{" "}
          <span className="font-semibold text-blue-100/90">123456</span>.
        </p>
      </div>
    </main>
  );
}
