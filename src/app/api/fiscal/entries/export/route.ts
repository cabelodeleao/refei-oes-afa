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

  const optIn = new Map<string, number>();
  const optOut = new Map<string, number>();
  try {
    const marks = await selectAll<{
      cadet_id: string;
      slot_id: string;
      attending: boolean;
    }>("meal_marks", "id, cadet_id, slot_id, attending", (q) =>
      q.in("slot_id", slotIds)
    );
    for (const m of marks) {
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

  let entries: Array<{ cadet_id: string; slot_id: string; entered_at: string }> =
    [];
  try {
    entries = await selectAll("meal_entries", "id, cadet_id, slot_id, entered_at", (q) =>
      q.in("slot_id", slotIds)
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar entradas" }, { status: 500 });
  }

  const slotMeal = new Map<string, MealType>();
  for (const s of slots) slotMeal.set(s.id, s.meal_type);
  const enteredCount = new Map<string, number>();
  for (const e of entries) {
    enteredCount.set(e.slot_id, (enteredCount.get(e.slot_id) ?? 0) + 1);
  }

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
    { header: "Entraram", key: "entered", width: 12 },
    { header: "Faltaram", key: "noshow", width: 12 },
  ];
  styleHeaderRow(resumo.getRow(1));
  for (const s of slots) {
    const expected = expectedOf(s);
    const entered = enteredCount.get(s.id) ?? 0;
    const row = resumo.addRow({
      meal: MEAL_SHORT[s.meal_type],
      expected,
      entered,
      noshow: Math.max(0, expected - entered),
    });
    [2, 3, 4].forEach((c) => (row.getCell(c).alignment = { horizontal: "center" }));
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
    const c = cadetById.get(e.cadet_id);
    const meal = slotMeal.get(e.slot_id);
    ws.addRow({
      number: c?.number ?? "—",
      name: c?.name ?? "—",
      squadron: c ? SQUADRON_SHORT[c.squadron] ?? "—" : "—",
      meal: meal ? MEAL_SHORT[meal] : "—",
      time: new Date(e.entered_at).toLocaleString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
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
