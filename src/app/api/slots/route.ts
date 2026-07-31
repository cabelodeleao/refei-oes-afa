import { NextResponse } from "next/server";
import { supabaseAdmin, selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import {
  MEAL_TYPES,
  ACCESS_STATES,
  getAccess,
  isOptOutSquadron,
  type MealType,
  type AccessState,
  type SquadronAccess,
} from "@/lib/constants";
import {
  todaySaoPaulo,
  parseISODate,
  addDays,
  toISODate,
  nowSaoPauloStamp,
  isAutoLocked,
  effectiveLocked,
  autoLockDate,
  type LockOverride,
} from "@/lib/dates";

export const runtime = "nodejs";

interface SlotRow {
  id: string;
  date: string;
  meal_type: MealType;
  squadrons: SquadronAccess;
  lock_override: LockOverride;
}

// GET /api/slots?from=YYYY-MM-DD&to=YYYY-MM-DD
//   ?history=1 (cadete) — em vez das refeições atuais, retorna as dos ÚLTIMOS
//   7 DIAS (somente consulta: tudo vem com locked=true; o PUT /api/marks
//   também rejeita alterações em dias passados).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const history = searchParams.get("history") === "1";

  // Visão do cadete (aplicada NA QUERY, para não carregar o histórico inteiro,
  // que só cresce com o tempo). Datas no fuso de São Paulo; a comparação é por
  // string (YYYY-MM-DD ordena lexicograficamente). O admin continua vendo tudo.
  //   - normal:  refeições de hoje em diante
  //   - history: refeições dos últimos 7 dias (de hoje-7 até ontem)
  const today = todaySaoPaulo();
  const histFrom = toISODate(addDays(parseISODate(today), -7));
  const isCadet = !session.is_admin;

  // Paginado: o total de slots cresce com o tempo, podendo passar de 1000.
  let slots: SlotRow[];
  try {
    slots = await selectAll<SlotRow>(
      "meal_slots",
      "id, date, meal_type, squadrons, lock_override",
      (q) => {
        if (from) q = q.gte("date", from);
        if (to) q = q.lte("date", to);
        if (isCadet) {
          q = history
            ? q.gte("date", histFrom).lt("date", today)
            : q.gte("date", today);
        }
        return q;
      }
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar refeições" }, { status: 500 });
  }
  slots.sort((a, b) => a.date.localeCompare(b.date));

  const now = nowSaoPauloStamp();

  // Admin vê todos os slots, sem filtro de esquadrão. Recebe o estado manual
  // (lock_override) e os dados do bloqueio automático para exibir o ícone certo
  // e "bloqueia <dia> 23:59". `locked` é o efetivo (manual + automático).
  if (session.is_admin) {
    return NextResponse.json({
      slots: slots.map((s) => ({
        id: s.id,
        date: s.date,
        meal_type: s.meal_type,
        squadrons: s.squadrons,
        lock_override: s.lock_override ?? null,
        auto_locked: isAutoLocked(s.date, now),
        auto_lock_date: autoLockDate(s.date),
        locked: effectiveLocked(s.lock_override, s.date, now),
      })),
    });
  }

  // Cadete: vê slots em que seu esquadrão é "opcional" ou "todos".
  // "ninguem" não aparece. Inclui o estado de acesso e a marcação dele.
  const visible = slots
    .map((s) => ({ ...s, access: getAccess(s.squadrons, session.squadron) }))
    .filter((s) => s.access !== "ninguem");

  // Escolhas explícitas do cadete no período visível (paginado): opt-ins e
  // opt-outs. O join com meal_slots evita carregar o histórico inteiro.
  const optInSet = new Set<string>(); // attending=true  (Sim em opcional)
  const optOutSet = new Set<string>(); // attending=false (Não em opt-out)
  try {
    const marks = await selectAll<{ slot_id: string; attending: boolean }>(
      "meal_marks",
      "id, slot_id, attending, meal_slots!inner(date)",
      (q) => {
        q = q.eq("cadet_id", session.sub);
        return history
          ? q.gte("meal_slots.date", histFrom).lt("meal_slots.date", today)
          : q.gte("meal_slots.date", today);
      }
    );
    for (const m of marks) {
      if (m.attending) optInSet.add(m.slot_id);
      else optOutSet.add(m.slot_id);
    }
  } catch {
    return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
  }

  const optOut = isOptOutSquadron(session.squadron);

  return NextResponse.json({
    slots: visible.map((s) => {
      let marked: boolean;
      if (s.access === "opcional") {
        marked = optInSet.has(s.id); // default Não
      } else if (optOut) {
        // "todos" opt-out (3º/4º): default Sim, exceto se desmarcou.
        marked = !optOutSet.has(s.id);
      } else {
        marked = true; // "todos" estrito (1º/2º)
      }
      return {
        id: s.id,
        date: s.date,
        meal_type: s.meal_type,
        // Bloqueio efetivo (manual do admin OU automático de 4 dias). Histórico
        // é somente consulta e dias passados nunca são editáveis — o servidor
        // também rejeita essas alterações no PUT /api/marks.
        locked:
          effectiveLocked(s.lock_override, s.date, now) ||
          history ||
          s.date < today,
        access: s.access, // "opcional" | "todos"
        marked,
      };
    }),
  });
}

// POST /api/slots  (admin) — cria/atualiza múltiplos slots
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: {
    slots?: Array<{
      date: string;
      meal_type: string;
      squadrons: Record<string, string>;
    }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const input = body.slots ?? [];
  if (!Array.isArray(input) || input.length === 0) {
    return NextResponse.json({ error: "Nenhum slot informado" }, { status: 400 });
  }

  const rows = [];
  for (const s of input) {
    if (!s.date || !MEAL_TYPES.includes(s.meal_type as MealType)) {
      return NextResponse.json({ error: "Dados de slot inválidos" }, { status: 400 });
    }
    // Normaliza o objeto de acesso: só esquadrões 1-4 com valores válidos.
    const squadrons: SquadronAccess = {};
    const raw = s.squadrons ?? {};
    for (const sq of [1, 2, 3, 4]) {
      const v = raw[String(sq)];
      if (ACCESS_STATES.includes(v as AccessState) && v !== "ninguem") {
        squadrons[String(sq)] = v as AccessState;
      }
    }
    if (Object.keys(squadrons).length === 0) {
      return NextResponse.json(
        { error: "Selecione ao menos um esquadrão (opcional ou todos)" },
        { status: 400 }
      );
    }
    rows.push({ date: s.date, meal_type: s.meal_type, squadrons });
  }

  // Upsert por (date, meal_type): mantém `lock_override` existente (não está
  // no payload), atualiza squadrons.
  const { data, error } = await supabaseAdmin
    .from("meal_slots")
    .upsert(rows, { onConflict: "date,meal_type" })
    .select("id, date, meal_type, squadrons, lock_override");

  if (error) {
    return NextResponse.json(
      { error: "Erro ao criar refeições: " + error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ slots: data });
}

// DELETE /api/slots  (admin) — remove slots e marcações em cascata
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { slot_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const ids = body.slot_ids ?? [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "Nenhum slot informado" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("meal_slots").delete().in("id", ids);
  if (error) {
    return NextResponse.json({ error: "Erro ao remover refeições" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, removed: ids.length });
}
