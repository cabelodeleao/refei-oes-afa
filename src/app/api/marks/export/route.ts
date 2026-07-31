import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import {
  MEAL_TYPES,
  MEAL_SHORT,
  ALL_SQUADRONS,
  SQUADRON_LABELS,
  SQUADRON_SHORT,
  getAccess,
  isOptOutSquadron,
  type MealType,
  type SquadronAccess,
} from "@/lib/constants";
import { formatShortDate } from "@/lib/dates";

export const runtime = "nodejs";

interface SlotRow {
  id: string;
  date: string;
  meal_type: MealType;
  squadrons: SquadronAccess;
}
interface CadetRow {
  id: string;
  number: string;
  name: string;
  squadron: number;
}

const HEADER_FILL = "FF112244";
const TODOS_FILL = "FFD1FAE5"; // verde claro — refeição obrigatória ("todos")
const YES_FILL = "FFECFDF5"; // verde bem claro — "Sim" (opcional marcado)
const NINGUEM_FILL = "FFF1F5F9"; // cinza — esquadrão sem a refeição
const LATE_FILL = "FFFEF3C7"; // amarelo — marcação de última hora (2ª chance)

// GET /api/marks/export?from=YYYY-MM-DD&to=YYYY-MM-DD  (admin)
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let slots: SlotRow[];
  let cadets: CadetRow[];
  try {
    // --- Slots no período (paginado), ordenados por data e tipo de refeição ---
    slots = await selectAll<SlotRow>(
      "meal_slots",
      "id, date, meal_type, squadrons",
      (q) => {
        if (from) q = q.gte("date", from);
        if (to) q = q.lte("date", to);
        return q;
      }
    );
    slots.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return MEAL_TYPES.indexOf(a.meal_type) - MEAL_TYPES.indexOf(b.meal_type);
    });

    if (slots.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma refeição no período selecionado" },
        { status: 400 }
      );
    }

    // O exceljs monta o arquivo inteiro em memória. Cada refeição vira uma
    // coluna em cada aba de esquadrão; limitamos o período para não estourar
    // memória/tempo da função (≈ 6 meses de 4 refeições/dia).
    if (slots.length > 750) {
      return NextResponse.json(
        {
          error:
            "Período muito grande para exportar de uma vez. Selecione um intervalo menor (até ~6 meses).",
        },
        { status: 400 }
      );
    }

    // --- Cadetes (exclui admin), paginado ---
    cadets = await selectAll<CadetRow>("cadets", "id, number, name, squadron", (q) =>
      q.gt("squadron", 0)
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar dados" }, { status: 500 });
  }

  const cadetSquadron = new Map<string, number>();
  for (const c of cadets) cadetSquadron.set(c.id, c.squadron);
  const cadetById = new Map<string, CadetRow>();
  for (const c of cadets) cadetById.set(c.id, c);
  const slotById = new Map<string, SlotRow>();
  for (const s of slots) slotById.set(s.id, s);

  const bySquadron = new Map<number, CadetRow[]>();
  for (const sq of ALL_SQUADRONS) bySquadron.set(sq, []);
  for (const c of cadets) bySquadron.get(c.squadron)?.push(c);
  for (const sq of ALL_SQUADRONS) {
    bySquadron.get(sq)!.sort((a, b) => a.number.localeCompare(b.number));
  }

  // --- Marcações (escolhas explícitas): opt-in (attending=true) e opt-out (false).
  // Paginado e filtrado pelo período via join em meal_slots (evita IN gigante).
  let marksData: Array<{
    cadet_id: string;
    slot_id: string;
    attending: boolean;
    late_marking: boolean;
    late_approved: boolean;
    late_marked_at: string | null;
    late_reason: "punido" | "outro" | null;
    late_note: string | null;
  }>;
  try {
    marksData = await selectAll(
      "meal_marks",
      "id, cadet_id, slot_id, attending, late_marking, late_approved, late_marked_at, late_reason, late_note, meal_slots!inner(date)",
      (q) => {
        if (from) q = q.gte("meal_slots.date", from);
        if (to) q = q.lte("meal_slots.date", to);
        return q;
      }
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
  }
  const optInSet = new Set<string>(); // "cadetId|slotId" attending=true  ("Sim")
  const optOutSet = new Set<string>(); // "cadetId|slotId" attending=false ("Não")
  const optInCount = new Map<string, number>(); // "slotId|sq" -> nº opt-in
  const optOutCount = new Map<string, number>(); // "slotId|sq" -> nº opt-out
  // Marcações de última hora (segunda chance): "cadetId|slotId" -> aprovada?
  const lateInfo = new Map<string, boolean>();
  for (const m of marksData) {
    const key = `${m.cadet_id}|${m.slot_id}`;
    const sq = cadetSquadron.get(m.cadet_id);
    const ckey = `${m.slot_id}|${sq}`;
    if (m.attending) {
      optInSet.add(key);
      if (sq) optInCount.set(ckey, (optInCount.get(ckey) ?? 0) + 1);
    } else {
      optOutSet.add(key);
      if (sq) optOutCount.set(ckey, (optOutCount.get(ckey) ?? 0) + 1);
    }
    if (m.late_marking) lateInfo.set(key, m.late_approved);
  }

  // Lista de marcações de última hora (para a aba dedicada), ordenada.
  const lateRows = marksData
    .filter((m) => m.late_marking)
    .map((m) => ({
      cadet: cadetById.get(m.cadet_id),
      slot: slotById.get(m.slot_id),
      approved: m.late_approved,
      at: m.late_marked_at,
      reason:
        m.late_reason === "punido"
          ? "Punido"
          : m.late_reason === "outro"
          ? m.late_note?.trim() || "Outro"
          : "—",
    }))
    .filter((r) => r.cadet && r.slot)
    .sort((a, b) => {
      if (a.slot!.date !== b.slot!.date)
        return a.slot!.date.localeCompare(b.slot!.date);
      const mt =
        MEAL_TYPES.indexOf(a.slot!.meal_type) -
        MEAL_TYPES.indexOf(b.slot!.meal_type);
      if (mt !== 0) return mt;
      if (a.cadet!.squadron !== b.cadet!.squadron)
        return a.cadet!.squadron - b.cadet!.squadron;
      return a.cadet!.number.localeCompare(b.cadet!.number);
    });

  // Nº de cadetes que comem em (slot, esquadrão), conforme o modo.
  const eatNumber = (s: SlotRow, sq: number): number => {
    const state = getAccess(s.squadrons, sq);
    if (state === "opcional") return optInCount.get(`${s.id}|${sq}`) ?? 0;
    if (state === "todos") {
      const roster = bySquadron.get(sq)!.length;
      return isOptOutSquadron(sq)
        ? roster - (optOutCount.get(`${s.id}|${sq}`) ?? 0)
        : roster;
    }
    return 0; // ninguem
  };

  const slotHeader = (s: SlotRow) =>
    `${formatShortDate(s.date)} - ${MEAL_SHORT[s.meal_type]}`;

  // ===================== Monta o workbook =====================
  const wb = new ExcelJS.Workbook();
  wb.creator = "Refeições AFA";
  wb.created = new Date();

  // --- Aba "Resumo" (mesma tabela da tela) ---
  const resumo = wb.addWorksheet("Resumo", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  resumo.columns = [
    { header: "Refeição", key: "meal", width: 22 },
    ...ALL_SQUADRONS.map((sq) => ({
      header: SQUADRON_SHORT[sq],
      key: `sq${sq}`,
      width: 10,
    })),
    { header: "Total", key: "total", width: 10 },
  ];
  styleHeaderRow(resumo.getRow(1));

  for (const s of slots) {
    let total = 0;
    const row: Record<string, string | number> = { meal: slotHeader(s) };
    for (const sq of ALL_SQUADRONS) {
      const state = getAccess(s.squadrons, sq);
      if (state === "ninguem") {
        row[`sq${sq}`] = "-";
      } else {
        const v = eatNumber(s, sq);
        row[`sq${sq}`] = v;
        total += v;
      }
    }
    row.total = total;
    const added = resumo.addRow(row);
    ALL_SQUADRONS.forEach((sq, i) => {
      const state = getAccess(s.squadrons, sq);
      const cell = added.getCell(2 + i);
      cell.alignment = { horizontal: "center" };
      if (state === "todos") cell.fill = solid(TODOS_FILL);
      else if (state === "ninguem") cell.fill = solid(NINGUEM_FILL);
    });
    added.getCell(ALL_SQUADRONS.length + 2).font = { bold: true };
  }
  addLegend(resumo, ALL_SQUADRONS.length + 2);

  // --- Uma aba por esquadrão ---
  for (const sq of ALL_SQUADRONS) {
    const ws = wb.addWorksheet(SQUADRON_LABELS[sq], {
      views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
    });

    // Só entram as refeições em que o esquadrão NÃO está em "ninguem".
    const sheetSlots = slots.filter(
      (s) => getAccess(s.squadrons, sq) !== "ninguem"
    );

    ws.columns = [
      { header: "Número", key: "number", width: 12 },
      { header: "Nome", key: "name", width: 26 },
      ...sheetSlots.map((s) => ({ header: slotHeader(s), key: s.id, width: 14 })),
    ];
    styleHeaderRow(ws.getRow(1));

    const roster = bySquadron.get(sq)!;
    for (const c of roster) {
      const row: Record<string, string | number> = {
        number: c.number,
        name: c.name,
      };
      for (const s of sheetSlots) {
        const state = getAccess(s.squadrons, sq);
        const key = `${c.id}|${s.id}`;
        const late = lateInfo.get(key); // undefined = não é última hora
        if (state === "todos" && !isOptOutSquadron(sq)) {
          // 1º/2º: obrigatória estrita.
          row[s.id] = "Obrigatória";
        } else if (state === "todos") {
          // 3º/4º: default "Sim", "Não" se desmarcou.
          const attending = !optOutSet.has(key);
          row[s.id] =
            attending && late !== undefined
              ? late
                ? "Última hora (aprov.)"
                : "Última hora (pend.)"
              : attending
              ? "Sim"
              : "Não";
        } else {
          // opcional: "Sim" se marcou (opt-in).
          const attending = optInSet.has(key);
          row[s.id] =
            attending && late !== undefined
              ? late
                ? "Última hora (aprov.)"
                : "Última hora (pend.)"
              : attending
              ? "Sim"
              : "Não";
        }
      }
      const added = ws.addRow(row);
      sheetSlots.forEach((s, i) => {
        const cell = added.getCell(3 + i);
        const late = lateInfo.get(`${c.id}|${s.id}`);
        if (late !== undefined && cell.value !== "Não") cell.fill = solid(LATE_FILL);
        else if (cell.value === "Obrigatória") cell.fill = solid(TODOS_FILL);
        else if (cell.value === "Sim") cell.fill = solid(YES_FILL);
        cell.alignment = { horizontal: "center" };
      });
    }

    // Linha de total: nº de quem come (opcional=opt-ins; todos=efetivo - opt-outs).
    const totalRow: Record<string, string | number> = {
      number: "TOTAL",
      name: "",
    };
    for (const s of sheetSlots) {
      totalRow[s.id] = eatNumber(s, sq);
    }
    const added = ws.addRow(totalRow);
    added.font = { bold: true };
    added.getCell(1).fill = solid("FFEFF2F7");
    sheetSlots.forEach((_, i) => {
      added.getCell(3 + i).alignment = { horizontal: "center" };
    });
  }

  // --- Aba "Última hora" (marcações da segunda chance) ---
  if (lateRows.length > 0) {
    const ws = wb.addWorksheet("Última hora", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = [
      { header: "Data", key: "date", width: 12 },
      { header: "Refeição", key: "meal", width: 12 },
      { header: "Esquadrão", key: "sq", width: 12 },
      { header: "Número", key: "number", width: 12 },
      { header: "Nome", key: "name", width: 26 },
      { header: "Justificativa", key: "reason", width: 28 },
      { header: "Marcou às", key: "at", width: 16 },
      { header: "Situação", key: "status", width: 16 },
    ];
    styleHeaderRow(ws.getRow(1));
    for (const r of lateRows) {
      const added = ws.addRow({
        date: formatShortDate(r.slot!.date),
        meal: MEAL_SHORT[r.slot!.meal_type],
        sq: SQUADRON_SHORT[r.cadet!.squadron] ?? "—",
        number: r.cadet!.number,
        name: r.cadet!.name,
        reason: r.reason,
        at: formatStampSP(r.at),
        status: r.approved ? "Aprovada" : "Pendente",
      });
      const statusCell = added.getCell(8);
      statusCell.fill = solid(r.approved ? YES_FILL : LATE_FILL);
      statusCell.alignment = { horizontal: "center" };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const today = new Date().toISOString().slice(0, 10);

  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="refeicoes-afa-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

// Horário da marcação de última hora no fuso de Brasília: "dd/mm HH:mm".
function formatStampSP(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

// ----------------------- helpers de estilo -----------------------
function solid(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.alignment = { horizontal: "center", vertical: "middle" };
  row.height = 22;
  row.eachCell((cell) => {
    cell.fill = solid(HEADER_FILL);
  });
}

function addLegend(ws: ExcelJS.Worksheet, totalCols: number) {
  ws.addRow([]);
  const legend = ws.addRow(["Legenda:"]);
  legend.getCell(1).font = { bold: true };

  const l1 = ws.addRow(["Fundo normal = marcaram voluntariamente (opcional)"]);
  ws.mergeCells(l1.number, 1, l1.number, totalCols);

  const l2 = ws.addRow([
    "Fundo verde = refeição obrigatória (todos do esquadrão)",
  ]);
  l2.getCell(1).fill = solid(TODOS_FILL);
  ws.mergeCells(l2.number, 1, l2.number, totalCols);

  const l3 = ws.addRow(['"-" cinza = esquadrão não tem essa refeição (ninguém)']);
  l3.getCell(1).fill = solid(NINGUEM_FILL);
  ws.mergeCells(l3.number, 1, l3.number, totalCols);
}
