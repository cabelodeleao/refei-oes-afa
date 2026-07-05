"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";
import { SQUADRON_LABELS, SQUADRON_YEAR, ALL_SQUADRONS } from "@/lib/constants";

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
  const [deleting, setDeleting] = useState<Cadet | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  // Efetivo completo (visão por esquadrão, exibida quando a busca está vazia).
  const [allCadets, setAllCadets] = useState<Cadet[] | null>(null);
  const [allError, setAllError] = useState("");
  const [openSquadron, setOpenSquadron] = useState<number | null>(null);

  // Formulário de novo cadete.
  const [addOpen, setAddOpen] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [newName, setNewName] = useState("");
  const [newSquadron, setNewSquadron] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  // Carrega o efetivo completo uma vez (para a visão por esquadrão).
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/admin/cadets?all=1");
        const data = await res.json();
        if (res.ok) setAllCadets(data.cadets ?? []);
        else setAllError(data.error ?? "Erro ao carregar o efetivo");
      } catch {
        setAllError("Erro de conexão");
      }
    })();
  }, []);

  // Busca com debounce (300ms). Sem texto, mostra a visão por esquadrão.
  useEffect(() => {
    const term = q.trim();
    clearTimeout(debounce.current);
    if (!term) {
      setCadets([]);
      setLoading(false);
      return;
    }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiFetch(
          `/api/admin/cadets?q=${encodeURIComponent(term)}`
        );
        const data = await res.json();
        if (res.ok) setCadets(data.cadets ?? []);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [q]);

  async function addCadet(e: React.FormEvent) {
    e.preventDefault();
    setAddBusy(true);
    try {
      const res = await apiFetch("/api/admin/cadets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: newNumber,
          name: newName,
          squadron: Number(newSquadron),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          `Cadete ${data.cadet.number} ${data.cadet.name} criado! Senha inicial: 123456`
        );
        setNewNumber("");
        setNewName("");
        setNewSquadron("");
        // Inclui na visão por esquadrão e mostra o recém-criado na busca.
        setAllCadets((prev) =>
          prev
            ? [...prev, data.cadet].sort((a, b) =>
                a.number.localeCompare(b.number, "pt-BR", { numeric: true })
              )
            : prev
        );
        setQ(data.cadet.number);
      } else {
        toast.error(data.error ?? "Erro ao criar o cadete.");
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setAddBusy(false);
    }
  }

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

  async function deleteCadet(cadet: Cadet) {
    setDeleteBusy(true);
    try {
      const res = await apiFetch(`/api/admin/cadets/${cadet.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Cadete ${data.number} ${data.name} excluído.`);
        setCadets((prev) => prev.filter((c) => c.id !== cadet.id));
        setAllCadets((prev) =>
          prev ? prev.filter((c) => c.id !== cadet.id) : prev
        );
        setDeleting(null);
      } else {
        toast.error(data.error ?? "Erro ao excluir o cadete.");
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setDeleteBusy(false);
    }
  }

  // Linha de cadete (usada na busca e na visão por esquadrão).
  function cadetRow(c: Cadet, showSquadron: boolean) {
    return (
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
          {showSquadron && (
            <p className="text-xs text-slate-400 dark:text-gray-500">
              {SQUADRON_LABELS[c.squadron] ?? "—"}
            </p>
          )}
        </div>
        <button
          className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
          onClick={() => setConfirming(c)}
        >
          Resetar senha
        </button>
        <button
          className="btn-danger shrink-0 px-3 py-1.5 text-xs"
          onClick={() => setDeleting(c)}
        >
          Excluir
        </button>
      </li>
    );
  }

  const searching = q.trim().length > 0;
  const total = allCadets?.length ?? 0;

  return (
    <div className="space-y-5">
      <section className="card p-5 animate-fade-in-up">
        <h2 className="font-bold text-navy-800 dark:text-gray-100">
          👤 Cadetes
        </h2>
        <p className="mb-3 text-xs text-slate-500 dark:text-gray-400">
          Busque por número ou nome para resetar a senha (volta para{" "}
          <span className="font-semibold">123456</span>) ou excluir um cadete.
        </p>
        <input
          className="input"
          placeholder="🔎 Buscar por número ou nome (ex: 23000 ou Silva)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </section>

      {/* Adicionar cadete */}
      <section className="card animate-fade-in-up">
        <button
          type="button"
          onClick={() => setAddOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-t-2xl px-5 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-navy-800 dark:text-gray-100">
            ➕ Adicionar cadete
          </span>
          <span
            className={`text-slate-400 transition-transform ${
              addOpen ? "rotate-180" : ""
            }`}
          >
            ▾
          </span>
        </button>

        {addOpen && (
          <form
            onSubmit={addCadet}
            className="space-y-3 border-t border-slate-100 px-5 py-4 dark:border-gray-700"
          >
            <p className="text-xs text-slate-500 dark:text-gray-400">
              O cadete entra com a senha inicial{" "}
              <span className="font-semibold">123456</span> e é obrigado a
              trocá-la no primeiro acesso. O QR code é gerado automaticamente.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-gray-300">
                  Número
                </label>
                <input
                  className="input"
                  placeholder="Ex: 23000"
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-gray-300">
                  Esquadrão
                </label>
                <select
                  className="input"
                  value={newSquadron}
                  onChange={(e) => setNewSquadron(e.target.value)}
                  required
                >
                  <option value="">Selecione…</option>
                  {ALL_SQUADRONS.map((sq) => (
                    <option key={sq} value={sq}>
                      {SQUADRON_LABELS[sq]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-gray-300">
                Nome de guerra
              </label>
              <input
                className="input"
                placeholder="Ex: SILVA"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>
            <button className="btn-primary w-full" type="submit" disabled={addBusy}>
              {addBusy ? "Criando…" : "Criar cadete"}
            </button>
          </form>
        )}
      </section>

      {/* Resultados da busca */}
      {searching && (
        <section className="card overflow-hidden animate-fade-in-up">
          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
              Buscando…
            </div>
          ) : cadets.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
              Nenhum cadete encontrado.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-gray-700">
              {cadets.map((c) => cadetRow(c, true))}
            </ul>
          )}
        </section>
      )}

      {/* Efetivo por esquadrão (quando não há busca) */}
      {!searching && (
        <>
          {allCadets === null && !allError && (
            <section className="card px-5 py-8 text-center text-sm text-slate-400 dark:text-gray-500 animate-fade-in-up">
              Carregando efetivo…
            </section>
          )}
          {allError && (
            <section className="card px-5 py-8 text-center text-sm text-red-600 dark:text-red-400 animate-fade-in-up">
              {allError}
            </section>
          )}
          {allCadets !== null && !allError && (
            <>
              <p className="text-center text-xs text-slate-500 dark:text-gray-400">
                {total} {total === 1 ? "cadete cadastrado" : "cadetes cadastrados"}{" "}
                no total
              </p>
              {ALL_SQUADRONS.map((sq) => {
                const list = allCadets.filter((c) => c.squadron === sq);
                const open = openSquadron === sq;
                return (
                  <section
                    key={sq}
                    className="card overflow-hidden animate-fade-in-up"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenSquadron(open ? null : sq)}
                      className="flex w-full items-center justify-between px-5 py-3.5 text-left"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="text-sm font-bold text-navy-800 dark:text-gray-100">
                          {SQUADRON_LABELS[sq]}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-gray-500">
                          {SQUADRON_YEAR[sq]}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-slate-500 dark:text-gray-400">
                          {list.length}{" "}
                          {list.length === 1 ? "cadete" : "cadetes"}
                        </span>
                        <span
                          className={`text-slate-400 transition-transform ${
                            open ? "rotate-180" : ""
                          }`}
                        >
                          ▾
                        </span>
                      </span>
                    </button>
                    {open && (
                      <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-gray-700 dark:border-gray-700">
                        {list.length === 0 ? (
                          <li className="px-5 py-6 text-center text-sm text-slate-400 dark:text-gray-500">
                            Nenhum cadete neste esquadrão.
                          </li>
                        ) : (
                          list.map((c) => cadetRow(c, false))
                        )}
                      </ul>
                    )}
                  </section>
                );
              })}
            </>
          )}
        </>
      )}

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

      {deleting && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => !deleteBusy && setDeleting(null)}
        >
          <div
            className="card w-full max-w-md p-5 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-red-700 dark:text-red-400">
              Excluir cadete
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-gray-300">
              Tem certeza que deseja excluir{" "}
              <span className="font-semibold">{deleting.number}</span>{" "}
              <span className="font-semibold">{deleting.name}</span>?
            </p>
            <p className="mt-2 text-sm font-semibold text-red-600 dark:text-red-400">
              Todas as marcações e o histórico de entradas dele serão apagados.
              Esta ação não pode ser desfeita.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => setDeleting(null)}
                disabled={deleteBusy}
              >
                Cancelar
              </button>
              <button
                className="btn-danger"
                onClick={() => deleteCadet(deleting)}
                disabled={deleteBusy}
              >
                {deleteBusy ? "Excluindo…" : "Excluir definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
