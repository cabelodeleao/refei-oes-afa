import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import {
  MEAL_TYPES,
  MEAL_SHORT,
  SQUADRON_LABELS,
  SQUADRON_SHORT,
  getAccess,
  isOptOutSquadron,
  type MealType,
  type SquadronAccess,
} from "@/lib/constants";
import { todaySaoPaulo } from "@/lib/dates";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Backup completo do sistema em um único Excel (.xlsx), legível por humanos.
// Várias abas: Cadetes, Marcações, Fiscalização, Resumo e Resumo por Esquadrão.
// Toda leitura usa selectAll (paginação) p/ não esbarrar no limite de 1000
// linhas do Supabase — são ~629 cadetes e potencialmente milhares de registros.
// ---------------------------------------------------------------------------

interface CadetRow {
  id: string;
  number: string;
  name: string;
  squadron: number;
  is_admin: boolean;
  is_fiscal: boolean;
}
interface SlotRow {
  id: string;
  date: string;
  meal_type: MealType;
  squadrons: SquadronAccess;
}
interface MarkRow {
  cadet_id: string;
  slot_id: string;
  attending: boolean;
}
interface EntryRow {
  cadet_id: string;
  slot_id: string;
  entered_at: string;
}
interface AttemptRow {
  cadet_id: string | null;
  slot_id: string;
  result: "autorizado" | "nao_marcou" | "duplicado" | "sem_qr";
  scanned_at: string;
  flagged_person: string | null;
  fiscal_note: string | null;
}

const HEADER_FILL = "FF112244";
const SQUADRONS = [1, 2, 3, 4] as const;

const RESULT_LABELS: Record<AttemptRow["result"], string> = {
  autorizado: "Entrou",
  nao_marcou: "Entrou sem marcar",
  duplicado: "QR reutilizado",
  sem_qr: "Sem QR",
};

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

// "YYYY-MM-DD" -> "DD/MM/AAAA"
function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function hhmm(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function GET() {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let cadets: CadetRow[];
  let slots: SlotRow[];
  let marks: MarkRow[];
  let entries: EntryRow[];
  let attempts: AttemptRow[];
  try {
    cadets = await selectAll<CadetRow>(
      "cadets",
      "id, number, name, squadron, is_admin, is_fiscal"
    );
    slots = await selectAll<SlotRow>(
      "meal_slots",
      "id, date, meal_type, squadrons"
    );
    marks = await selectAll<MarkRow>(
      "meal_marks",
      "id, cadet_id, slot_id, attending"
    );
    entries = await selectAll<EntryRow>(
      "meal_entries",
      "id, cadet_id, slot_id, entered_at"
    );
    attempts = await selectAll<AttemptRow>(
      "scan_attempts",
      "id, cadet_id, slot_id, result, scanned_at, flagged_person, fiscal_note"
    );
  } catch {
    return NextResponse.json(
      { error: "Erro ao buscar dados para o backup" },
      { status: 500 }
    );
  }

  // Índices auxiliares -------------------------------------------------------
  const cadetById = new Map<string, CadetRow>();
  for (const c of cadets) cadetById.set(c.id, c);

  const slotById = new Map<string, SlotRow>();
  for (const s of slots) slotById.set(s.id, s);

  // Ordena slots por data e, dentro do dia, pela ordem das refeições.
  const slotOrder = (s: SlotRow) =>
    `${s.date}#${String(MEAL_TYPES.indexOf(s.meal_type)).padStart(2, "0")}`;
  const slotsSorted = [...slots].sort((a, b) =>
    slotOrder(a) < slotOrder(b) ? -1 : 1
  );

  // Efetivo (apenas esquadrões 1–4) p/ refeições "todos".
  const rosterBySquadron = new Map<number, number>();
  for (const c of cadets) {
    if (c.squadron >= 1 && c.squadron <= 4) {
      rosterBySquadron.set(c.squadron, (rosterBySquadron.get(c.squadron) ?? 0) + 1);
    }
  }

  // Marcações por slot+esquadrão (opt-in / opt-out).
  const optIn = new Map<string, number>();
  const optOut = new Map<string, number>();
  for (const m of marks) {
    const sq = cadetById.get(m.cadet_id)?.squadron;
    if (!sq || sq < 1 || sq > 4) continue;
    const key = `${m.slot_id}|${sq}`;
    if (m.attending) optIn.set(key, (optIn.get(key) ?? 0) + 1);
    else optOut.set(key, (optOut.get(key) ?? 0) + 1);
  }

  // Entradas por slot (total e por esquadrão) + slots fiscalizados.
  const enteredBySlot = new Map<string, number>();
  const enteredBySlotSq = new Map<string, number>();
  const fiscalizedSlots = new Set<string>();
  for (const e of entries) {
    enteredBySlot.set(e.slot_id, (enteredBySlot.get(e.slot_id) ?? 0) + 1);
    fiscalizedSlots.add(e.slot_id);
    const sq = cadetById.get(e.cadet_id)?.squadron;
    if (sq && sq >= 1 && sq <= 4) {
      const key = `${e.slot_id}|${sq}`;
      enteredBySlotSq.set(key, (enteredBySlotSq.get(key) ?? 0) + 1);
    }
  }
  for (const a of attempts) fiscalizedSlots.add(a.slot_id);

  // Esperados (marcaram) por slot+esquadrão, conforme o modo de acesso.
  const expectedSq = (s: SlotRow, sq: number): number => {
    const state = getAccess(s.squadrons, sq);
    if (state === "opcional") return optIn.get(`${s.id}|${sq}`) ?? 0;
    if (state === "todos") {
      const roster = rosterBySquadron.get(sq) ?? 0;
      return isOptOutSquadron(sq)
        ? roster - (optOut.get(`${s.id}|${sq}`) ?? 0)
        : roster;
    }
    return 0;
  };

  const cadetCols = (cadetId: string | null) => {
    const c = cadetId ? cadetById.get(cadetId) : undefined;
    return {
      number: c?.number ?? "—",
      name: c?.name ?? "—",
      squadron: c ? SQUADRON_SHORT[c.squadron] ?? "Adm" : "—",
    };
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "Refeições AFA";
  wb.created = new Date();
  const frozen = { views: [{ state: "frozen" as const, ySplit: 1 }] };

  // === Aba "Cadetes" ========================================================
  const cadetsSheet = wb.addWorksheet("Cadetes", frozen);
  cadetsSheet.columns = [
    { header: "Número", key: "number", width: 14 },
    { header: "Nome", key: "name", width: 30 },
    { header: "Esquadrão", key: "squadron", width: 18 },
    { header: "É Fiscal?", key: "fiscal", width: 12 },
    { header: "É Admin?", key: "admin", width: 12 },
  ];
  styleHeaderRow(cadetsSheet.getRow(1));
  const cadetsByNumber = [...cadets].sort((a, b) =>
    a.number.localeCompare(b.number, "pt-BR", { numeric: true })
  );
  for (const c of cadetsByNumber) {
    const row = cadetsSheet.addRow({
      number: c.number,
      name: c.name,
      squadron: SQUADRON_LABELS[c.squadron] ?? `Esq. ${c.squadron}`,
      fiscal: c.is_fiscal ? "Sim" : "Não",
      admin: c.is_admin ? "Sim" : "Não",
    });
    [4, 5].forEach((ci) => (row.getCell(ci).alignment = { horizontal: "center" }));
  }

  // === Aba "Marcações" ======================================================
  // Lista de todas as escolhas explícitas dos cadetes (Sim/Não por refeição).
  const marksSheet = wb.addWorksheet("Marcações", frozen);
  marksSheet.columns = [
    { header: "Data", key: "date", width: 14 },
    { header: "Refeição", key: "meal", width: 14 },
    { header: "Número", key: "number", width: 14 },
    { header: "Nome", key: "name", width: 30 },
    { header: "Esquadrão", key: "squadron", width: 12 },
    { header: "Vai comer?", key: "attending", width: 12 },
  ];
  styleHeaderRow(marksSheet.getRow(1));
  const marksSorted = [...marks]
    .map((m) => ({ m, s: slotById.get(m.slot_id) }))
    .filter((x): x is { m: MarkRow; s: SlotRow } => Boolean(x.s))
    .sort((a, b) => {
      const ka = `${slotOrder(a.s)}#${cadetById.get(a.m.cadet_id)?.number ?? ""}`;
      const kb = `${slotOrder(b.s)}#${cadetById.get(b.m.cadet_id)?.number ?? ""}`;
      return ka < kb ? -1 : 1;
    });
  for (const { m, s } of marksSorted) {
    const row = marksSheet.addRow({
      date: brDate(s.date),
      meal: MEAL_SHORT[s.meal_type],
      ...cadetCols(m.cadet_id),
      attending: m.attending ? "Sim" : "Não",
    });
    row.getCell(6).alignment = { horizontal: "center" };
  }

  // === Aba "Fiscalização" ===================================================
  // Log completo de leituras de QR (entradas e tentativas) na porta do rancho.
  const fiscSheet = wb.addWorksheet("Fiscalização", frozen);
  fiscSheet.columns = [
    { header: "Data", key: "date", width: 14 },
    { header: "Refeição", key: "meal", width: 14 },
    { header: "Número", key: "number", width: 14 },
    { header: "Nome", key: "name", width: 30 },
    { header: "Esquadrão", key: "squadron", width: 12 },
    { header: "Resultado", key: "result", width: 20 },
    { header: "Horário", key: "time", width: 10 },
    { header: "Pessoa anotada", key: "flagged", width: 26 },
    { header: "Observação do fiscal", key: "note", width: 32 },
  ];
  styleHeaderRow(fiscSheet.getRow(1));
  const attemptsSorted = [...attempts].sort((a, b) =>
    a.scanned_at < b.scanned_at ? -1 : 1
  );
  for (const a of attemptsSorted) {
    const s = slotById.get(a.slot_id);
    fiscSheet.addRow({
      date: s ? brDate(s.date) : "—",
      meal: s ? MEAL_SHORT[s.meal_type] : "—",
      ...cadetCols(a.cadet_id),
      result: RESULT_LABELS[a.result] ?? a.result,
      time: hhmm(a.scanned_at),
      flagged: a.flagged_person ?? "",
      note: a.fiscal_note ?? "",
    });
  }

  // === Aba "Resumo" (por dia e refeição) ====================================
  const resumo = wb.addWorksheet("Resumo", frozen);
  resumo.columns = [
    { header: "Data", key: "date", width: 14 },
    { header: "Refeição", key: "meal", width: 14 },
    { header: "Marcaram", key: "expected", width: 12 },
    { header: "Compareceram", key: "entered", width: 14 },
    { header: "Faltaram", key: "noshow", width: 12 },
    { header: "Fiscalizada?", key: "fisc", width: 14 },
  ];
  styleHeaderRow(resumo.getRow(1));
  for (const s of slotsSorted) {
    const expected = SQUADRONS.reduce((sum, sq) => sum + expectedSq(s, sq), 0);
    const entered = enteredBySlot.get(s.id) ?? 0;
    const fisc = fiscalizedSlots.has(s.id);
    const row = resumo.addRow({
      date: brDate(s.date),
      meal: MEAL_SHORT[s.meal_type],
      expected,
      entered,
      noshow: fisc ? Math.max(0, expected - entered) : 0,
      fisc: fisc ? "Sim" : "Não",
    });
    [3, 4, 5, 6].forEach(
      (ci) => (row.getCell(ci).alignment = { horizontal: "center" })
    );
  }

  // === Aba "Resumo por Esquadrão" ===========================================
  const resumoSq = wb.addWorksheet("Resumo por Esquadrão", frozen);
  resumoSq.columns = [
    { header: "Data", key: "date", width: 14 },
    { header: "Refeição", key: "meal", width: 14 },
    { header: "Esquadrão", key: "squadron", width: 12 },
    { header: "Marcaram", key: "expected", width: 12 },
    { header: "Compareceram", key: "entered", width: 14 },
    { header: "Faltaram", key: "noshow", width: 12 },
  ];
  styleHeaderRow(resumoSq.getRow(1));
  for (const s of slotsSorted) {
    const fisc = fiscalizedSlots.has(s.id);
    for (const sq of SQUADRONS) {
      if (getAccess(s.squadrons, sq) === "ninguem") continue; // esq. sem refeição
      const expected = expectedSq(s, sq);
      const entered = enteredBySlotSq.get(`${s.id}|${sq}`) ?? 0;
      const row = resumoSq.addRow({
        date: brDate(s.date),
        meal: MEAL_SHORT[s.meal_type],
        squadron: SQUADRON_SHORT[sq],
        expected,
        entered,
        noshow: fisc ? Math.max(0, expected - entered) : 0,
      });
      [4, 5, 6].forEach(
        (ci) => (row.getCell(ci).alignment = { horizontal: "center" })
      );
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const fileDate = todaySaoPaulo();

  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="backup-refeicoes-afa-${fileDate}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
