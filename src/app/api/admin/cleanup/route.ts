import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { todaySaoPaulo, quarterInfo, quarterOfDate } from "@/lib/dates";

export const runtime = "nodejs";
// Limpeza trimestral: apaga mes a mes, em cascata. O padrao da Vercel (10s) e curto demais com 625 cadetes.
export const maxDuration = 60;

// Palavra que o admin precisa digitar para confirmar a exclusão.
const CONFIRM_WORD = "APAGAR";

// Apagar uma refeição (meal_slots) leva junto, em cascata, tudo que depende
// dela: marcações, entradas registradas e leituras de QR daquele dia.
// É assim que a limpeza trimestral libera espaço no banco.

// Valida o trimestre pedido e devolve o último dia dele. Só permite trimestres
// que JÁ TERMINARAM — o atual e os futuros nunca podem ser apagados.
function cutoffFor(
  year: number,
  quarter: number
): { cutoff: string; label: string } | { error: string } {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { error: "Ano inválido" };
  }
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    return { error: "Trimestre inválido" };
  }
  const q = quarterInfo(year, quarter);
  const today = todaySaoPaulo();
  const atual = quarterOfDate(today);
  const jaTerminou =
    year < atual.year || (year === atual.year && quarter < atual.quarter);
  if (!jaTerminou) {
    return {
      error:
        "Só é possível limpar trimestres que já terminaram. O trimestre atual continua no sistema.",
    };
  }
  return { cutoff: q.to, label: q.label };
}

// Conta quantas linhas seriam apagadas. Best-effort: se alguma contagem falhar,
// volta null e a tela mostra "—" em vez de um número errado.
async function countBefore(cutoff: string) {
  const slots = await supabaseAdmin
    .from("meal_slots")
    .select("id", { count: "exact", head: true })
    .lte("date", cutoff);

  const child = async (table: string) => {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select("id, meal_slots!inner(date)", { count: "exact", head: true })
      .lte("meal_slots.date", cutoff);
    return error ? null : count ?? 0;
  };

  return {
    slots: slots.error ? null : slots.count ?? 0,
    marks: await child("meal_marks"),
    entries: await child("meal_entries"),
    attempts: await child("scan_attempts"),
  };
}

// GET /api/admin/cleanup?year=2026&quarter=1  (admin)
// Prévia: quantos registros seriam apagados até o fim daquele trimestre.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const range = cutoffFor(
    Number(searchParams.get("year")),
    Number(searchParams.get("quarter"))
  );
  if ("error" in range) {
    return NextResponse.json({ error: range.error }, { status: 400 });
  }

  try {
    const counts = await countBefore(range.cutoff);
    return NextResponse.json({ cutoff: range.cutoff, label: range.label, counts });
  } catch {
    return NextResponse.json({ error: "Erro ao contar registros" }, { status: 500 });
  }
}

// DELETE /api/admin/cleanup  (admin)
// Body: { year, quarter, confirm: "APAGAR" }
// Apaga TODAS as refeições até o último dia do trimestre informado — e, em
// cascata, as marcações, entradas e leituras de QR desses dias. Os cadetes,
// fiscais e o cardápio NÃO são tocados.
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { year?: number; quarter?: number; confirm?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  if (String(body.confirm ?? "").trim().toUpperCase() !== CONFIRM_WORD) {
    return NextResponse.json(
      { error: `Digite ${CONFIRM_WORD} para confirmar a limpeza.` },
      { status: 400 }
    );
  }

  const range = cutoffFor(Number(body.year), Number(body.quarter));
  if ("error" in range) {
    return NextResponse.json({ error: range.error }, { status: 400 });
  }

  // Conta ANTES de apagar, para poder informar o que saiu.
  let counts: Awaited<ReturnType<typeof countBefore>> | null = null;
  try {
    counts = await countBefore(range.cutoff);
  } catch {
    /* a prévia é informativa; a exclusão segue mesmo sem ela */
  }

  // Apaga MÊS A MÊS, do mais antigo para o mais novo. Cada mês é uma operação
  // separada e pequena: se o servidor cortar por tempo no meio do caminho, o
  // que já foi apagado continua apagado e basta repetir a limpeza.
  const { data: oldest } = await supabaseAdmin
    .from("meal_slots")
    .select("date")
    .lte("date", range.cutoff)
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!oldest) {
    return NextResponse.json({
      ok: true,
      cutoff: range.cutoff,
      label: range.label,
      removed: 0,
      counts,
    });
  }

  let removed = 0;
  const [startYear, startMonth] = oldest.date.split("-").map(Number);
  let y = startYear;
  let m = startMonth;
  for (let guard = 0; guard < 240; guard++) {
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
    if (monthStart > range.cutoff) break;
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const { data, error } = await supabaseAdmin
      .from("meal_slots")
      .delete()
      .gte("date", monthStart)
      .lte("date", monthEnd < range.cutoff ? monthEnd : range.cutoff)
      .select("id");

    if (error) {
      return NextResponse.json(
        {
          error:
            `Erro ao limpar registros a partir de ${monthStart}: ` +
            error.message +
            (removed > 0 ? ` (${removed} refeições já foram apagadas)` : ""),
        },
        { status: 500 }
      );
    }
    removed += data?.length ?? 0;

    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    cutoff: range.cutoff,
    label: range.label,
    removed,
    counts,
  });
}
