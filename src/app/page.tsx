"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Falha no login");
        setLoading(false);
        return;
      }
      router.push(data.redirect);
      router.refresh();
    } catch {
      setError("Erro de conexão. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-navy-600 px-4 py-10">
      {/* Brilhos decorativos suaves ao fundo */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-navy-500/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl" />

      <div className="relative w-full max-w-sm animate-fade-in-up">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-3xl shadow-lg ring-1 ring-white/20">
            🍽️
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Refeições AFA
          </h1>
          <p className="mt-1.5 text-sm text-blue-100/80">
            Marque suas refeições opcionais
          </p>
        </div>

        <div className="glass p-6 sm:p-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-blue-50/90">
                Número do cadete
              </label>
              <input
                className="input-glass"
                placeholder="Ex: 23/001"
                autoCapitalize="none"
                autoComplete="username"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-blue-50/90">
                Senha
              </label>
              <input
                className="input-glass"
                type="password"
                placeholder="••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-300/30 bg-red-500/20 px-3 py-2 text-sm text-red-50">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-blue-100/60">
          Primeiro acesso? A senha inicial é{" "}
          <span className="font-semibold text-blue-100/90">123456</span>
        </p>
      </div>
    </main>
  );
}
