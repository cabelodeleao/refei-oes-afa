"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/Toast";

export default function Backup() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  async function exportAll() {
    setLoading(true);
    try {
      const res = await apiFetch("/api/admin/export-all");
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
      const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `backup-refeicoes-afa-${today}.xlsx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Backup gerado com sucesso!");
    } catch {
      toast.error("Erro de conexão ao gerar o backup.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-slate-200/70 dark:bg-gray-800 dark:ring-gray-700">
        <h2 className="text-lg font-bold text-navy-800 dark:text-gray-100">
          Backup completo
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-gray-400">
          Gera um arquivo Excel (.xlsx) com todos os dados do sistema, organizado
          em abas:
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

        <button
          onClick={exportAll}
          disabled={loading}
          className="btn-primary mt-5 w-full"
        >
          {loading ? "Gerando backup..." : "📥 Exportar tudo (.xlsx)"}
        </button>

        <p className="mt-3 text-xs text-slate-400 dark:text-gray-500">
          Pode levar alguns segundos com muitos registros. O arquivo é um backup
          legível: dá para entender tudo sem abrir o sistema.
        </p>
      </div>
    </div>
  );
}
