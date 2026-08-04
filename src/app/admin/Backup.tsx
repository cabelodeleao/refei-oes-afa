"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";
import { recentQuarters, todaySaoPaulo } from "@/lib/dates";

// Quantos trimestres aparecem nos seletores (2 anos para trás).
const QUARTERS = 8;

interface Counts {
  slots: number | null;
  marks: number | null;
  entries: number | null;
  attempts: number | null;
}

// "1.234" ou "—" quando a contagem não veio.
function num(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString("pt-BR") : "—";
}

export default function Backup() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  // Trimestres disponíveis (do atual para trás) e o escolhido no backup.
  const quarters = useMemo(() => recentQuarters(QUARTERS), []);
  const [pick, setPick] = useState(0); // índice em `quarters`; -1 = tudo

  // ---- Limpeza de registros antigos ---------------------------------------
  // Só trimestres que já terminaram (o atual nunca pode ser apagado).
  const cleanable = useMemo(() => quarters.slice(1), [quarters]);
  const [cleanPick, setCleanPick] = useState(1); // 1º trimestre encerrado
  const [counts, setCounts] = useState<Counts | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [cleaning, setCleaning] = useState(false);

  const cleanTarget = quarters[cleanPick];

  const loadCounts = useCallback(async () => {
    if (!cleanTarget) return;
    setCountLoading(true);
    setCounts(null);
    try {
      const res = await apiFetch(
        `/api/admin/cleanup?year=${cleanTarget.year}&quarter=${cleanTarget.quarter}`
      );
      const data = await res.json();
      if (res.ok) setCounts(data.counts ?? null);
      else toast.error(data.error ?? "Erro ao contar registros.");
    } catch {
      toast.error("Erro de conexão ao contar registros.");
    } finally {
      setCountLoading(false);
    }
  }, [cleanTarget, toast]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  async function exportAll() {
    setLoading(true);
    try {
      const q = pick >= 0 ? quarters[pick] : null;
      const url = q
        ? `/api/admin/export-all?from=${q.from}&to=${q.to}`
        : "/api/admin/export-all";
      const res = await apiFetch(url);
      if (!res.ok) {
        let msg = "Não foi possível gerar o backup.";
        try {
          msg = (await res.json()).error ?? msg;
        } catch {
          /* resposta sem JSON */
        }
        toast.error(msg);
        return;
      }
      const blob = await res.blob();
      // Nome do arquivo vem do Content-Disposition; replicamos como fallback.
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] ??
        `backup-refeicoes-afa-${q ? `${q.from}_a_${q.to}` : todaySaoPaulo()}.xlsx`;

      const url2 = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url2;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url2);
      toast.success("Backup gerado com sucesso!");
    } catch {
      toast.error("Erro de conexão ao gerar o backup.");
    } finally {
      setLoading(false);
    }
  }

  async function cleanup() {
    if (!cleanTarget) return;
    if (
      !confirm(
        `Apagar DEFINITIVAMENTE tudo até o fim do ${cleanTarget.label}?\n\n` +
          `Saem as refeições, marcações, entradas e leituras de QR até ${cleanTarget.to}. ` +
          `Cadetes, fiscais e cardápio não são afetados.\n\n` +
          `Baixe o backup deste período ANTES de continuar — não há como desfazer.`
      )
    ) {
      return;
    }
    setCleaning(true);
    try {
      const res = await apiFetch("/api/admin/cleanup", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: cleanTarget.year,
          quarter: cleanTarget.quarter,
          confirm: confirmWord.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao limpar registros.");
        return;
      }
      toast.success(`Limpeza concluída: ${num(data.removed)} refeições apagadas.`);
      setConfirmWord("");
      loadCounts();
    } catch {
      toast.error("Erro de conexão ao limpar registros.");
    } finally {
      setCleaning(false);
    }
  }

  const nothingToClean = counts?.slots === 0;
  const canClean =
    !cleaning && confirmWord.trim().toUpperCase() === "APAGAR" && !nothingToClean;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {/* ---------- Backup ---------- */}
      <div className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-slate-200/70 dark:bg-gray-800 dark:ring-gray-700">
        <h2 className="text-lg font-bold text-navy-800 dark:text-gray-100">
          Backup por trimestre
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-gray-400">
          Gera um arquivo Excel (.xlsx) com os dados do período escolhido,
          organizado em abas:
        </p>
        <ul className="mt-3 space-y-1 text-sm text-slate-600 dark:text-gray-400">
          <li>
            • <strong>Cadetes</strong> — número, nome, esquadrão e papéis (sem
            senhas).
          </li>
          <li>
            • <strong>Marcações</strong> — todas as escolhas de refeição (Sim/Não).
          </li>
          <li>
            • <strong>Fiscalização</strong> — leituras de QR na porta do rancho.
          </li>
          <li>
            • <strong>Resumo</strong> e <strong>Resumo por Esquadrão</strong> —
            marcaram, compareceram e faltaram por dia/refeição.
          </li>
        </ul>

        <label className="mt-5 block text-sm font-medium text-slate-700 dark:text-gray-200">
          Período
        </label>
        <select
          className="input mt-1.5"
          value={pick}
          onChange={(e) => setPick(Number(e.target.value))}
        >
          {quarters.map((q, i) => (
            <option key={`${q.year}-${q.quarter}`} value={i}>
              {q.label}
              {i === 0 ? " — em andamento" : ""}
            </option>
          ))}
          <option value={-1}>Todo o histórico (pode demorar bastante)</option>
        </select>

        <button
          onClick={exportAll}
          disabled={loading}
          className="btn-primary mt-4 w-full"
        >
          {loading ? "Gerando backup..." : "📥 Exportar (.xlsx)"}
        </button>

        <p className="mt-3 text-xs text-slate-400 dark:text-gray-500">
          O arquivo é um backup legível: dá para entender tudo sem abrir o
          sistema. Um trimestre por vez é o recomendado — exportar o histórico
          inteiro fica cada vez mais lento conforme os anos passam.
        </p>
      </div>

      {/* ---------- Limpeza ---------- */}
      <div className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-red-200 dark:bg-gray-800 dark:ring-red-500/30">
        <h2 className="text-lg font-bold text-navy-800 dark:text-gray-100">
          Limpar registros antigos
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-gray-400">
          Libera espaço no banco apagando as refeições antigas e tudo ligado a
          elas: marcações, entradas registradas e leituras de QR.{" "}
          <strong>Cadetes, fiscais e cardápio não são tocados.</strong>
        </p>
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
          ⚠️ Baixe o backup do período <strong>antes</strong> de limpar — não há
          como desfazer.
        </p>

        <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-gray-200">
          Apagar tudo até o fim de
        </label>
        <select
          className="input mt-1.5"
          value={cleanPick}
          onChange={(e) => {
            setCleanPick(Number(e.target.value));
            setConfirmWord("");
          }}
        >
          {cleanable.map((q, i) => (
            <option key={`${q.year}-${q.quarter}`} value={i + 1}>
              {q.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-slate-400 dark:text-gray-500">
          O trimestre em andamento nunca é apagado.
        </p>

        {/* Prévia do que sai */}
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm dark:bg-gray-700/40">
          {countLoading ? (
            <span className="text-slate-400 dark:text-gray-500">Contando…</span>
          ) : nothingToClean ? (
            <span className="text-slate-500 dark:text-gray-400">
              Não há nada para apagar neste período.
            </span>
          ) : (
            <ul className="space-y-1 text-slate-600 dark:text-gray-300">
              <li>
                • <strong>{num(counts?.slots)}</strong> refeições (até{" "}
                {cleanTarget?.to.split("-").reverse().join("/")})
              </li>
              <li>
                • <strong>{num(counts?.marks)}</strong> marcações
              </li>
              <li>
                • <strong>{num(counts?.entries)}</strong> entradas registradas
              </li>
              <li>
                • <strong>{num(counts?.attempts)}</strong> leituras de QR
              </li>
            </ul>
          )}
        </div>

        <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-gray-200">
          Digite <strong>APAGAR</strong> para liberar o botão
        </label>
        <input
          className="input mt-1.5"
          placeholder="APAGAR"
          value={confirmWord}
          onChange={(e) => setConfirmWord(e.target.value)}
          disabled={nothingToClean}
        />

        <button
          onClick={cleanup}
          disabled={!canClean}
          className="btn-danger mt-4 w-full"
        >
          {cleaning ? "Limpando..." : "🗑️ Apagar registros deste período"}
        </button>
      </div>
    </div>
  );
}
