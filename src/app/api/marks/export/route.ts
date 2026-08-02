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
  const pendingLateCount = new Map<string, number>(); // "slotId|sq" -> última hora pendente
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
    // Última hora ainda pendente: não conta no total (só após aprovada).
    if (m.attending && m.late_marking && !m.late_approved && sq) {
      pendingLateCount.set(ckey, (pendingLateCount.get(ckey) ?? 0) + 1);
    }
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

  // Nº de cadetes que comem em (slot, esquadrão), conforme o modo. As marcações
  // de última hora ainda pendentes NÃO entram (só contam depois de aprovadas).
  const eatNumber = (s: SlotRow, sq: number): number => {
    const state = getAccess(s.squadrons, sq);
    const pending = pendingLateCount.get(`${s.id}|${sq}`) ?? 0;
    if (state === "opcional")
      return (optInCount.get(`${s.id}|${sq}`) ?? 0) - pending;
    if (state === "todos") {
      const roster = bySquadron.get(sq)!.length;
      return isOptOutSquadron(sq)
        ? roster - (optOutCount.get(`${s.id}|${sq}`) ?? 0) - pending
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

  // ===================== Fiscalização manual (aba "Conferência") ============
  // Para os dias de muito movimento em que o QR fica lento: o sargento digita o
  // NÚMERO (com ou sem barra) ou o NOME do cadete e, na coluna ao lado, aparece
  // se ele pode entrar naquela refeição. As fórmulas consultam a aba oculta
  // "Dados" (uma linha por cadete, uma coluna por refeição).
  {
    // Cadetes ordenados por esquadrão e número (base de consulta).
    const roster = [...cadets].sort((a, b) =>
      a.squadron !== b.squadron
        ? a.squadron - b.squadron
        : a.number.localeCompare(b.number)
    );

    // Situação de um cadete numa refeição: "Sim" (pode entrar), "Não",
    // "Obrigatória" ou "—" (esquadrão sem a refeição). Última hora só conta se
    // aprovada (mesma regra da fiscalização por QR).
    const statusFor = (c: CadetRow, s: SlotRow): string => {
      const state = getAccess(s.squadrons, c.squadron);
      if (state === "ninguem") return "—";
      const key = `${c.id}|${s.id}`;
      const pending = lateInfo.get(key) === false; // última hora não aprovada
      if (state === "todos") {
        if (!isOptOutSquadron(c.squadron)) return "Obrigatória";
        return !optOutSet.has(key) && !pending ? "Sim" : "Não";
      }
      return optInSet.has(key) && !pending ? "Sim" : "Não"; // opcional
    };

    // --- Aba de dados (OCULTA): base das fórmulas de consulta ---
    const dados = wb.addWorksheet("Dados");
    dados.state = "hidden";
    dados.columns = [
      { header: "Número", key: "num", width: 12 },
      { header: "Nome", key: "nome", width: 26 },
      { header: "Esq", key: "esq", width: 10 },
      { header: "NúmeroNorm", key: "norm", width: 12 },
      ...slots.map((s) => ({ header: slotHeader(s), key: s.id, width: 16 })),
    ];
    styleHeaderRow(dados.getRow(1));
    for (const c of roster) {
      const row: Record<string, string> = {
        num: c.number,
        nome: c.name,
        esq: SQUADRON_SHORT[c.squadron] ?? "—",
        norm: c.number.replace(/\D/g, ""), // só dígitos, p/ casar "25200"/"25/200"
      };
      for (const s of slots) row[s.id] = statusFor(c, s);
      dados.addRow(row);
    }

    // Faixa das colunas de refeição em Dados (E1 .. última), p/ o dropdown.
    const firstMeal = colLetter(5); // E
    const lastMeal = colLetter(4 + slots.length);
    const mealRange = `Dados!$${firstMeal}$1:$${lastMeal}$1`;

    const thin = { style: "thin" as const, color: { argb: "FFE2E8F0" } };

    // --- Aba "Conferência" (o sargento REGISTRA quem entra) ---
    // Uma linha por pessoa que entra: ESCOLHE a refeição naquela linha e digita
    // o número/nome. Como a refeição fica em cada linha, dá para conferir várias
    // refeições no mesmo arquivo e a aba "Resultados" conta certo, por refeição.
    const conf = wb.addWorksheet("Conferência", {
      views: [{ state: "frozen", ySplit: 4 }],
    });
    conf.getColumn(1).width = 22; // Refeição
    conf.getColumn(2).width = 22; // Nº ou Nome
    conf.getColumn(3).width = 12; // Número
    conf.getColumn(4).width = 30; // Cadete
    conf.getColumn(5).width = 8; // Esq

    conf.getCell("A1").value =
      "Conferência de entrada (quando o QR estiver lento)";
    conf.getCell("A1").font = { bold: true, size: 13 };
    conf.getCell("A2").value =
      "Para cada cadete que ENTRAR: escolha a REFEIÇÃO e digite o NÚMERO (ex.: 25200 ou 25/200) ou o NOME. Dica: escolha a refeição na 1ª linha e copie para baixo.";
    conf.getCell("A2").font = { italic: true, color: { argb: "FF64748B" } };

    const cHead = conf.getRow(4);
    cHead.getCell(1).value = "Refeição";
    cHead.getCell(2).value = "Nº ou Nome (digite)";
    cHead.getCell(3).value = "Número";
    cHead.getCell(4).value = "Cadete";
    cHead.getCell(5).value = "Esq";
    styleHeaderRow(cHead);

    const C_FIRST = 5;
    const C_LAST = 704; // ~700 linhas de conferência
    for (let r = C_FIRST; r <= C_LAST; r++) {
      // Dropdown da refeição nesta linha.
      conf.getCell(`A${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [mealRange],
      };
      // Helpers ocultos: G = índice do cadete (pelo nº/nome em B);
      // H = índice da coluna da refeição (col A); I = autorizado nessa refeição.
      conf.getCell(`G${r}`).value = {
        formula:
          `IF(TRIM($B${r})="","",IFERROR(MATCH(SUBSTITUTE(TRIM($B${r}),"/",""),Dados!$D:$D,0),` +
          `IFERROR(MATCH(TRIM($B${r}),Dados!$B:$B,0),IFERROR(MATCH(TRIM($B${r})&"*",Dados!$B:$B,0),0))))`,
        result: "",
      };
      conf.getCell(`H${r}`).value = {
        formula: `IFERROR(MATCH($A${r},Dados!$1:$1,0),0)`,
        result: 0,
      };
      conf.getCell(`I${r}`).value = {
        formula:
          `IF(OR($G${r}="",$G${r}=0,$H${r}=0),"",` +
          `IF(OR(INDEX(Dados!$A:$XFD,$G${r},$H${r})="Sim",INDEX(Dados!$A:$XFD,$G${r},$H${r})="Obrigatória"),"Sim","Não"))`,
        result: "",
      };
      // Colunas visíveis: número, cadete e esquadrão resolvidos (confirmação).
      conf.getCell(`C${r}`).value = {
        formula: `IF($G${r}="","",IF($G${r}=0,"não encontrado",INDEX(Dados!$A:$XFD,$G${r},1)))`,
        result: "",
      };
      conf.getCell(`D${r}`).value = {
        formula: `IF(OR($G${r}="",$G${r}=0),"",INDEX(Dados!$A:$XFD,$G${r},2))`,
        result: "",
      };
      conf.getCell(`E${r}`).value = {
        formula: `IF(OR($G${r}="",$G${r}=0),"",INDEX(Dados!$A:$XFD,$G${r},3))`,
        result: "",
      };
      for (let col = 1; col <= 5; col++) {
        const cell = conf.getCell(r, col);
        cell.border = { top: thin, left: thin, bottom: thin, right: thin };
        if (col >= 3) cell.alignment = { horizontal: "center" };
      }
    }
    conf.getColumn(7).hidden = true; // G auxiliar (cadete)
    conf.getColumn(8).hidden = true; // H auxiliar (refeição)
    conf.getColumn(9).hidden = true; // I auxiliar (autorizado)

    // --- Aba "Resultados" (do admin) ---
    const res = wb.addWorksheet("Resultados");
    res.getColumn(1).width = 20;
    res.getColumn(2).width = 28;
    res.getColumn(3).width = 12;
    res.getColumn(4).width = 20;
    res.getColumn(5).width = 20;

    res.getCell("A1").value = "Resultados da conferência";
    res.getCell("A1").font = { bold: true, size: 13 };

    // ---- Seção 1: resumo por refeição (uma linha por refeição) ----
    res.getCell("A2").value = "Resumo por refeição";
    res.getCell("A2").font = { bold: true, size: 12 };
    const sumHead = res.getRow(3);
    sumHead.getCell(1).value = "Refeição";
    sumHead.getCell(2).value = "Marcaram";
    sumHead.getCell(3).value = "Foram";
    sumHead.getCell(4).value = "Não foram";
    sumHead.getCell(5).value = "Entraram sem marcar";
    styleHeaderRow(sumHead);

    // Nº de autorizados por refeição (marcaram / obrigatória; última hora só se
    // aprovada) — estático, igual ao total do Resumo.
    const authorizedTotal = (s: SlotRow): number =>
      [1, 2, 3, 4].reduce((sum, sq) => sum + eatNumber(s, sq), 0);

    const SUM_FIRST = 4;
    slots.forEach((s, i) => {
      const r = SUM_FIRST + i;
      res.getCell(`A${r}`).value = slotHeader(s);
      res.getCell(`B${r}`).value = authorizedTotal(s);
      // Foram = entradas registradas nessa refeição que estavam autorizadas.
      res.getCell(`C${r}`).value = {
        formula: `COUNTIFS('Conferência'!$A:$A,$A${r},'Conferência'!$I:$I,"Sim")`,
        result: 0,
      };
      // Não foram = autorizados - foram (nunca negativo).
      res.getCell(`D${r}`).value = { formula: `MAX(0,$B${r}-$C${r})`, result: 0 };
      // Entraram sem marcar = entradas registradas sem direito à refeição.
      res.getCell(`E${r}`).value = {
        formula: `COUNTIFS('Conferência'!$A:$A,$A${r},'Conferência'!$I:$I,"Não")`,
        result: 0,
      };
      for (let col = 1; col <= 5; col++) {
        const cell = res.getCell(r, col);
        cell.border = { top: thin, left: thin, bottom: thin, right: thin };
        if (col >= 2) cell.alignment = { horizontal: "center" };
      }
      res.getCell(`C${r}`).fill = solid("FFD1FAE5");
      res.getCell(`D${r}`).fill = solid("FFFEE2E2");
      res.getCell(`E${r}`).fill = solid("FFFEF3C7");
    });

    // ---- Seção 2: detalhe (quem foi / quem não foi) de UMA refeição ----
    const detTitle = SUM_FIRST + slots.length + 1;
    res.getCell(`A${detTitle}`).value = "Detalhe da refeição:";
    res.getCell(`A${detTitle}`).font = { bold: true, size: 12 };
    const detMeal = res.getCell(`B${detTitle}`);
    detMeal.value = slotHeader(slots[0]);
    detMeal.font = { bold: true, color: { argb: "FF1D4ED8" } };
    detMeal.fill = solid("FFEFF6FF");
    detMeal.dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [mealRange],
      showErrorMessage: true,
      errorTitle: "Refeição inválida",
      error: "Escolha uma refeição da lista.",
    };
    // Índice da coluna da refeição do detalhe (auxiliar, oculto em K1).
    res.getCell("K1").value = {
      formula: `IFERROR(MATCH($B$${detTitle},Dados!$1:$1,0),0)`,
      result: 5,
    };

    const detNote = detTitle + 1;
    res.getCell(`A${detNote}`).value =
      "Use o filtro da coluna Resultado (seta no cabeçalho) para ver só quem foi ou só quem não foi.";
    res.getCell(`A${detNote}`).font = {
      italic: true,
      color: { argb: "FF64748B" },
    };

    const detHead = detTitle + 2;
    const dHead = res.getRow(detHead);
    dHead.getCell(1).value = "Número";
    dHead.getCell(2).value = "Nome";
    dHead.getCell(3).value = "Esq";
    dHead.getCell(4).value = "Resultado";
    styleHeaderRow(dHead);

    const D_FIRST = detHead + 1;
    const D_LAST = D_FIRST + roster.length - 1;
    roster.forEach((c, i) => {
      const r = D_FIRST + i;
      res.getCell(`A${r}`).value = c.number;
      res.getCell(`B${r}`).value = c.name;
      const esqCell = res.getCell(`C${r}`);
      esqCell.value = SQUADRON_SHORT[c.squadron] ?? "—";
      esqCell.alignment = { horizontal: "center" };
      // Situação do cadete na refeição do detalhe (auxiliar, oculta em G).
      res.getCell(`G${r}`).value = {
        formula: `IFERROR(INDEX(Dados!$A:$XFD,MATCH($A${r},Dados!$A:$A,0),$K$1),"—")`,
        result: "",
      };
      // Entrou NESSA refeição? (registrado na Conferência) — auxiliar, oculta H.
      res.getCell(`H${r}`).value = {
        formula: `IF(COUNTIFS('Conferência'!$C:$C,$A${r},'Conferência'!$A:$A,$B$${detTitle})>0,1,0)`,
        result: 0,
      };
      // Resultado final: Foi / Faltou / Entrou sem marcar / (vazio).
      res.getCell(`D${r}`).value = {
        formula:
          `IF(OR($G${r}="Sim",$G${r}="Obrigatória"),IF($H${r}=1,"Foi","Faltou"),` +
          `IF($H${r}=1,"Entrou sem marcar",""))`,
        result: "",
      };
      res.getCell(`D${r}`).alignment = { horizontal: "center" };
      for (let col = 1; col <= 4; col++) {
        res.getCell(r, col).border = {
          top: thin,
          left: thin,
          bottom: thin,
          right: thin,
        };
      }
    });

    res.getColumn(7).hidden = true; // G auxiliar (situação)
    res.getColumn(8).hidden = true; // H auxiliar (entrou?)
    res.getColumn(11).hidden = true; // K auxiliar (índice da refeição)

    // Filtro para o admin separar "Foi" / "Faltou" nas listas.
    res.autoFilter = {
      from: { row: detHead, column: 1 },
      to: { row: D_LAST, column: 4 },
    };

    // Cores do Resultado: verde = foi, vermelho = faltou, amarelo = sem marcar.
    res.addConditionalFormatting({
      ref: `D${D_FIRST}:D${D_LAST}`,
      rules: [
        {
          type: "containsText",
          operator: "containsText",
          text: "Foi",
          priority: 1,
          style: {
            fill: solid("FFD1FAE5"),
            font: { color: { argb: "FF065F46" }, bold: true },
          },
        },
        {
          type: "containsText",
          operator: "containsText",
          text: "Faltou",
          priority: 2,
          style: {
            fill: solid("FFFEE2E2"),
            font: { color: { argb: "FF991B1B" }, bold: true },
          },
        },
        {
          type: "containsText",
          operator: "containsText",
          text: "Entrou sem marcar",
          priority: 3,
          style: {
            fill: solid("FFFEF3C7"),
            font: { color: { argb: "FF92400E" }, bold: true },
          },
        },
      ],
    });
  }

  // Recalcular as fórmulas ao abrir o arquivo (contagens/resultados atualizados).
  wb.calcProperties.fullCalcOnLoad = true;

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

// Nº da coluna -> letra ("A", "B", ... "AA"), p/ montar referências de fórmula.
function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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
