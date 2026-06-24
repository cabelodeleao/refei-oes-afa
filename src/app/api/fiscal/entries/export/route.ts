import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import {
  MEAL_TYPES,
  MEAL_SHORT,
  SQUADRON_SHORT,
  getAccess,
  isOptOutSquadron,
  type MealType,
  type SquadronAccess,
} from "@/lib/constants";
import { formatShortDate, todaySaoPaulo } from "@/lib/dates";

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

// GET /api/fiscal/entries/export?date=YYYY-MM-DD  (admin)
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const date = new URL(req.url).searchParams.get("date") || todaySaoPaulo();

  let slots: SlotRow[];
  let cadets: CadetRow[];
  try {
    slots = await selectAll<SlotRow>(
      "meal_slots",
      "id, date, meal_type, squadrons",
      (q) => q.eq("date", date)
    );
    cadets = await selectAll<CadetRow>("cadets", "id, number, name, squadron", (q) =>
      q.gt("squadron", 0)
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar dados" }, { status: 500 });
  }

  if (slots.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma refeição neste dia" },
      { status: 400 }
    );
  }
  slots.sort(
    (a, b) => MEAL_TYPES.indexOf(a.meal_type) - MEAL_TYPES.indexOf(b.meal_type)
  );

  const cadetById = new Map<string, CadetRow>();
  for (const c of cadets) cadetById.set(c.id, c);
  const rosterBySquadron = new Map<number, number>();
  for (const c of cadets) {
    rosterBySquadron.set(c.squadron, (rosterBySquadron.get(c.squadron) ?? 0) + 1);
  }

  const slotIds = slots.map((s) => s.id);
  const slotMeal = new Map<string, MealType>();
  for (const s of slots) slotMeal.set(s.id, s.meal_type);

  const optIn = new Map<string, number>();
  const optOut = new Map<string, number>();
  const markByCadetSlot = new Map<string, boolean>();
  try {
    const marks = await selectAll<{
      cadet_id: string;
      slot_id: string;
      attending: boolean;
    }>("meal_marks", "id, cadet_id, slot_id, attending", (q) =>
      q.in("slot_id", slotIds)
    );
    for (const m of marks) {
      markByCadetSlot.set(`${m.slot_id}|${m.cadet_id}`, m.attending);
      const sq = cadetById.get(m.cadet_id)?.squadron;
      if (!sq) continue;
      const key = `${m.slot_id}|${sq}`;
      if (m.attending) optIn.set(key, (optIn.get(key) ?? 0) + 1);
      else optOut.set(key, (optOut.get(key) ?? 0) + 1);
    }
  } catch {
    return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
  }

  const expectedOf = (s: SlotRow): number => {
    let total = 0;
    for (const sq of [1, 2, 3, 4]) {
      const state = getAccess(s.squadrons, sq);
      if (state === "opcional") total += optIn.get(`${s.id}|${sq}`) ?? 0;
      else if (state === "todos") {
        const roster = rosterBySquadron.get(sq) ?? 0;
        total += isOptOutSquadron(sq)
          ? roster - (optOut.get(`${s.id}|${sq}`) ?? 0)
          : roster;
      }
    }
    return total;
  };

  const isExpected = (s: SlotRow, c: CadetRow): boolean => {
    const state = getAccess(s.squadrons, c.squadron);
    if (state === "ninguem") return false;
    const attending = markByCadetSlot.get(`${s.id}|${c.id}`);
    if (state === "opcional") return attending === true;
    if (isOptOutSquadron(c.squadron)) return attending !== false;
    return true;
  };

  let entries: Array<{ cadet_id: string; slot_id: string; entered_at: string }> =
    [];
  try {
    entries = await selectAll("meal_entries", "id, cadet_id, slot_id, entered_at", (q) =>
      q.in("slot_id", slotIds)
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar entradas" }, { status: 500 });
  }

  let attempts: Array<{
    cadet_id: string | null;
    slot_id: string;
    result: "autorizado" | "nao_marcou" | "duplicado" | "sem_qr";
    scanned_at: string;
    flagged_person: string | null;
    fiscal_note: string | null;
  }> = [];
  try {
    attempts = await selectAll(
      "scan_attempts",
      "id, cadet_id, slot_id, result, scanned_at, flagged_person, fiscal_note",
      (q) => q.in("slot_id", slotIds)
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar tentativas" }, { status: 500 });
  }

  const enteredCount = new Map<string, number>();
  const enteredSet = new Set<string>();
  for (const e of entries) {
    enteredCount.set(e.slot_id, (enteredCount.get(e.slot_id) ?? 0) + 1);
    enteredSet.add(`${e.slot_id}|${e.cadet_id}`);
  }

  // Refeição fiscalizada = teve alguma leitura (entrada ou tentativa de scan).
  const fiscalizedSlots = new Set<string>();
  for (const e of entries) fiscalizedSlots.add(e.slot_id);
  for (const a of attempts) fiscalizedSlots.add(a.slot_id);

  const hhmm = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const cadetCols = (cadetId: string | null) => {
    const c = cadetId ? cadetById.get(cadetId) : undefined;
    return {
      number: c?.number ?? "—",
      name: c?.name ?? "—",
      squadron: c ? SQUADRON_SHORT[c.squadron] ?? "—" : "—",
    };
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "Refeições AFA";
  wb.created = new Date();

  // --- Aba "Resumo" (marcaram vs entraram vs faltaram) ---
  const resumo = wb.addWorksheet("Resumo", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  resumo.columns = [
    { header: "Refeição", key: "meal", width: 16 },
    { header: "Marcaram", key: "expected", width: 12 },
    { header: "Compareceram", key: "entered", width: 14 },
    { header: "Entraram sem marcar", key: "notmarked", width: 22 },
    { header: "QR reutilizado", key: "dup", width: 16 },
    { header: "Sem QR", key: "noqr", width: 14 },
    { header: "Faltaram", key: "noshow", width: 14 },
    { header: "Fiscalizada?", key: "fisc", width: 14 },
  ];
  styleHeaderRow(resumo.getRow(1));

  const notMarkedCount = new Map<string, number>();
  const duplicateCount = new Map<string, number>();
  const noQrCount = new Map<string, number>();
  for (const a of attempts) {
    if (a.result === "nao_marcou")
      notMarkedCount.set(a.slot_id, (notMarkedCount.get(a.slot_id) ?? 0) + 1);
    else if (a.result === "duplicado")
      duplicateCount.set(a.slot_id, (duplicateCount.get(a.slot_id) ?? 0) + 1);
    else if (a.result === "sem_qr")
      noQrCount.set(a.slot_id, (noQrCount.get(a.slot_id) ?? 0) + 1);
  }

  for (const s of slots) {
    const expected = expectedOf(s);
    const entered = enteredCount.get(s.id) ?? 0;
    const scanned = fiscalizedSlots.has(s.id);
    const row = resumo.addRow({
      meal: MEAL_SHORT[s.meal_type],
      expected,
      entered,
      notmarked: notMarkedCount.get(s.id) ?? 0,
      dup: duplicateCount.get(s.id) ?? 0,
      noqr: noQrCount.get(s.id) ?? 0,
      noshow: scanned ? Math.max(0, expected - entered) : 0,
      fisc: scanned ? "Sim" : "Não",
    });
    [2, 3, 4, 5, 6, 7, 8].forEach(
      (c) => (row.getCell(c).alignment = { horizontal: "center" })
    );
  }

  // --- Aba "Entradas" (lista de quem entrou) ---
  const ws = wb.addWorksheet("Entradas", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: "Número", key: "number", width: 12 },
    { header: "Nome", key: "name", width: 28 },
    { header: "Esquadrão", key: "squadron", width: 12 },
    { header: "Refeição", key: "meal", width: 14 },
    { header: "Horário", key: "time", width: 12 },
  ];
  styleHeaderRow(ws.getRow(1));

  const sorted = [...entries].sort((a, b) =>
    a.entered_at < b.entered_at ? -1 : 1
  );
  for (const e of sorted) {
    const meal = slotMeal.get(e.slot_id);
    ws.addRow({
      ...cadetCols(e.cadet_id),
      meal: meal ? MEAL_SHORT[meal] : "—",
      time: hhmm(e.entered_at),
    });
  }

  // --- Aba de tentativas (nao_marcou / duplicado) ---
  function attemptsSheet(
    title: string,
    result: "nao_marcou" | "duplicado"
  ) {
    const isDup = result === "duplicado";
    const sheet = wb.addWorksheet(title, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "Número", key: "number", width: 12 },
      { header: isDup ? "Dono do QR" : "Nome", key: "name", width: 28 },
      { header: "Esquadrão", key: "squadron", width: 12 },
      { header: "Refeição", key: "meal", width: 14 },
      { header: "Horário", key: "time", width: 12 },
      // Colunas extras só p/ duplicados (fraude de QR).
      ...(isDup
        ? [
            { header: "Quem usou (flagrado)", key: "flagged", width: 26 },
            { header: "Obs. do fiscal", key: "note", width: 30 },
          ]
        : []),
    ];
    styleHeaderRow(sheet.getRow(1));
    const rows = attempts
      .filter((a) => a.result === result)
      .sort((a, b) => (a.scanned_at < b.scanned_at ? -1 : 1));
    for (const a of rows) {
      const meal = slotMeal.get(a.slot_id);
      sheet.addRow({
        ...cadetCols(a.cadet_id),
        meal: meal ? MEAL_SHORT[meal] : "—",
        time: hhmm(a.scanned_at),
        ...(isDup
          ? { flagged: a.flagged_person ?? "", note: a.fiscal_note ?? "" }
          : {}),
      });
    }
  }
  attemptsSheet("Entraram sem marcar", "nao_marcou");
  attemptsSheet("QR reutilizado", "duplicado");

  // --- Aba "Sem QR" (registro manual do fiscal) ---
  const noQrSheet = wb.addWorksheet("Sem QR", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  noQrSheet.columns = [
    { header: "Cadete", key: "person", width: 30 },
    { header: "Número", key: "number", width: 14 },
    { header: "Esquadrão", key: "squadron", width: 12 },
    { header: "Refeição", key: "meal", width: 14 },
    { header: "Horário", key: "time", width: 12 },
    { header: "Obs. do fiscal", key: "note", width: 30 },
  ];
  styleHeaderRow(noQrSheet.getRow(1));
  const noQrRows = attempts
    .filter((a) => a.result === "sem_qr")
    .sort((a, b) => (a.scanned_at < b.scanned_at ? -1 : 1));
  for (const a of noQrRows) {
    const c = a.cadet_id ? cadetById.get(a.cadet_id) : undefined;
    const meal = slotMeal.get(a.slot_id);
    noQrSheet.addRow({
      person: c?.name ?? a.flagged_person ?? "—",
      number: c?.number ?? "—",
      squadron: c ? SQUADRON_SHORT[c.squadron] ?? "—" : "—",
      meal: meal ? MEAL_SHORT[meal] : "—",
      time: hhmm(a.scanned_at),
      note: a.fiscal_note ?? "",
    });
  }

  // --- Aba "Faltaram" (esperados que nunca passaram o QR, só em refeições
  //     fiscalizadas) ---
  const noShowSheet = wb.addWorksheet("Faltaram", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  noShowSheet.columns = [
    { header: "Número", key: "number", width: 12 },
    { header: "Nome", key: "name", width: 28 },
    { header: "Esquadrão", key: "squadron", width: 12 },
    { header: "Refeição", key: "meal", width: 14 },
  ];
  styleHeaderRow(noShowSheet.getRow(1));
  for (const s of slots) {
    if (!fiscalizedSlots.has(s.id)) continue;
    for (const c of cadets) {
      if (!isExpected(s, c)) continue;
      if (enteredSet.has(`${s.id}|${c.id}`)) continue;
      noShowSheet.addRow({
        ...cadetCols(c.id),
        meal: MEAL_SHORT[s.meal_type],
      });
    }
  }

  const buffer = await wb.xlsx.writeBuffer();

  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="fiscalizacao-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
