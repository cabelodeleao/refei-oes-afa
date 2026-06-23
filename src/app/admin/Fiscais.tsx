"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";

interface Fiscal {
  id: string;
  number: string;
  name: string;
}

export default function Fiscais() {
  const toast = useToast();
  const [fiscais, setFiscais] = useState<Fiscal[]>([]);
  const [loading, setLoading] = useState(true);

  // Formulário de criação
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  // Ações em fiscais existentes
  const [removing, setRemoving] = useState<Fiscal | null>(null);
  const [resetting, setResetting] = useState<Fiscal | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch("/api/admin/fiscais");
      const data = await res.json();
      if (res.ok) setFiscais(data.fiscais ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createFiscal(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const res = await apiFetch("/api/admin/fiscais", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, name, password }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Fiscal ${data.fiscal.number} criado!`);
        setNumber("");
        setName("");
        setPassword("");
        load();
      } else {
        toast.error(data.error ?? "Erro ao criar fiscal.");
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setCreating(false);
    }
  }

  async function confirmRemove(f: Fiscal) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/admin/fiscais/${f.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Fiscal ${f.number} removido.`);
        setRemoving(null);
        setFiscais((prev) => prev.filter((x) => x.id !== f.id));
      } else {
        toast.error(data.error ?? "Erro ao remover fiscal.");
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset(f: Fiscal) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/admin/fiscais/${f.id}/reset-password`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Senha de ${f.number} resetada para 123456!`);
        setResetting(null);
      } else {
        toast.error(data.error ?? "Erro ao resetar a senha.");
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Criar fiscal */}
      <section className="card p-5 animate-fade-in-up">
        <h2 className="font-bold text-navy-800 dark:text-gray-100">
          🛡️ Criar conta de fiscal
        </h2>
        <p className="mb-4 text-xs text-slate-500 dark:text-gray-400">
          Fiscais (sargentos) têm login próprio e não fazem parte da lista de
          cadetes. Eles acessam a página de fiscalização do rancho.
        </p>
        <form
          onSubmit={createFiscal}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-slate-500 dark:text-gray-400">
              Identificador (login)
            </span>
            <input
              className="input"
              placeholder="ex: fiscal01"
              autoCapitalize="none"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-slate-500 dark:text-gray-400">
              Nome
            </span>
            <input
              className="input"
              placeholder="ex: Sgt. Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-slate-500 dark:text-gray-400">
              Senha inicial
            </span>
            <input
              className="input"
              placeholder="123456 (padrão)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn-primary h-[42px]"
            disabled={creating}
          >
            {creating ? "Criando…" : "Criar fiscal"}
          </button>
        </form>
      </section>

      {/* Lista de fiscais */}
      <section className="card overflow-hidden animate-fade-in-up">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-gray-700">
          <h2 className="font-bold text-navy-800 dark:text-gray-100">
            Fiscais cadastrados
          </h2>
        </div>
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
            Carregando…
          </div>
        ) : fiscais.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
            Nenhum fiscal cadastrado ainda.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-gray-700">
            {fiscais.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50/60 dark:hover:bg-gray-700/40"
              >
                <span className="font-mono text-sm text-slate-500 dark:text-gray-400">
                  {f.number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-700 dark:text-gray-100">
                    {f.name}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-gray-500">
                    Fiscal do rancho
                  </p>
                </div>
                <button
                  className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                  onClick={() => setResetting(f)}
                >
                  Resetar senha
                </button>
                <button
                  className="shrink-0 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200 transition hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:ring-red-800"
                  onClick={() => setRemoving(f)}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Modal: remover fiscal */}
      {removing && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => !busy && setRemoving(null)}
        >
          <div
            className="card w-full max-w-md p-5 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-navy-800 dark:text-gray-100">
              Remover fiscal
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-gray-300">
              Remover a conta de{" "}
              <span className="font-semibold">{removing.number}</span>{" "}
              <span className="font-semibold">{removing.name}</span>? O histórico
              de entradas já registrado por ele é preservado.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => setRemoving(null)}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                onClick={() => confirmRemove(removing)}
                disabled={busy}
              >
                {busy ? "Removendo…" : "Remover"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: resetar senha do fiscal */}
      {resetting && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => !busy && setResetting(null)}
        >
          <div
            className="card w-full max-w-md p-5 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-navy-800 dark:text-gray-100">
              Resetar senha
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-gray-300">
              Resetar a senha de{" "}
              <span className="font-semibold">{resetting.number}</span>{" "}
              <span className="font-semibold">{resetting.name}</span> para{" "}
              <span className="font-semibold">123456</span>?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => setResetting(null)}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={() => confirmReset(resetting)}
                disabled={busy}
              >
                {busy ? "Resetando…" : "Resetar para 123456"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
