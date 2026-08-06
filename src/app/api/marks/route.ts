import { NextResponse } from "next/server";
import { supabaseAdmin, selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { getAccess } from "@/lib/constants";
import { todaySaoPaulo, mealPhase } from "@/lib/dates";

export const runtime = "nodejs";

// GET /api/marks?from=YYYY-MM-DD&to=YYYY-MM-DD
// Retorna os slot_ids marcados pelo cadete logado.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // Paginado e filtrado por período via join em meal_slots.
  // Apenas opt-ins (attending=true) = refeições marcadas como "Sim".
  try {
    const marks = await selectAll<{ slot_id: string }>(
      "meal_marks",
      from || to ? "id, slot_id, meal_slots!inner(date)" : "id, slot_id",
      (q) => {
        q = q.eq("cadet_id", session.sub).eq("attending", true);
        if (from) q = q.gte("meal_slots.date", from);
        if (to) q = q.lte("meal_slots.date", to);
        return q;
      }
    );
    return NextResponse.json({ slot_ids: marks.map((m) => m.slot_id) });
  } catch {
    return NextResponse.json({ error: "Erro ao buscar marcações" }, { status: 500 });
  }
}

// PUT /api/marks  — marca/desmarca uma refeição (cadete)
// Body: { slot_id, marked, reason?, note? }
//   reason/note só são usados ao MARCAR na fase de segunda chance (última hora):
//   reason = "punido" | "outro"; note = texto livre quando reason = "outro".
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (session.is_admin || session.is_rancho) {
    return NextResponse.json(
      { error: "Esta conta não marca refeições" },
      { status: 403 }
    );
  }

  let body: {
    slot_id?: string;
    marked?: boolean;
    reason?: string;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const slotId = body.slot_id;
  const marked = body.marked === true;
  const reason = body.reason === "punido" || body.reason === "outro" ? body.reason : null;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!slotId) {
    return NextResponse.json({ error: "slot_id obrigatório" }, { status: 400 });
  }

  // Validação server-side: slot existe, não está bloqueado, pertence ao esquadrão.
  const { data: slot, error: slotErr } = await supabaseAdmin
    .from("meal_slots")
    .select("id, date, squadrons, lock_override")
    .eq("id", slotId)
    .maybeSingle();

  if (slotErr) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (!slot) {
    return NextResponse.json({ error: "Refeição não encontrada" }, { status: 404 });
  }
  // Refeição de dia que já passou nunca pode ser alterada (impede, por exemplo,
  // desmarcar retroativamente para sumir da lista de faltas). Regra absoluta,
  // independente do override do admin.
  if (slot.date < todaySaoPaulo()) {
    return NextResponse.json(
      { error: "Refeição de dia que já passou — não é possível alterar" },
      { status: 409 }
    );
  }
  const access = getAccess(slot.squadrons, session.squadron);
  if (access === "ninguem") {
    return NextResponse.json(
      { error: "Seu esquadrão não tem acesso a esta refeição" },
      { status: 403 }
    );
  }
  // "todos" (obrigatória) vale para todos os esquadrões como opt-out: já vem
  // marcada, mas o cadete pode desmarcar se não for comer.
  const isOptOut = access === "todos";
  const phase = mealPhase(slot.lock_override, slot.date);

  // Fase fechada: nada pode ser feito.
  if (phase === "fechada") {
    return NextResponse.json(
      { error: "Esta refeição está fechada para marcação" },
      { status: 409 }
    );
  }

  // ---- Fase de segunda chance: SÓ pode marcar (aumentar presença) ----------
  if (phase === "segunda_chance") {
    // O estado atual só é necessário AQUI (para saber se é mesmo um aumento de
    // presença). Na fase aberta, que é o caso da esmagadora maioria das
    // marcações, esta consulta seria desperdício — 625 cadetes marcando o mês
    // todo passam por este ponto milhares de vezes.
    const { data: existingRow, error: rowErr } = await supabaseAdmin
      .from("meal_marks")
      .select("attending, late_marking")
      .eq("cadet_id", session.sub)
      .eq("slot_id", slotId)
      .maybeSingle();
    if (rowErr) {
      return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
    }
    const defaultAttending = isOptOut ? true : false; // opcional=>Não, opt-out=>Sim
    const currentAttending = existingRow ? existingRow.attending : defaultAttending;

    if (marked === currentAttending) {
      // Sem mudança — idempotente.
      return NextResponse.json({ ok: true, slot_id: slotId, marked });
    }
    if (!marked) {
      // Tentou desmarcar depois do prazo: proibido.
      return NextResponse.json(
        { error: "Não é possível desmarcar após o prazo" },
        { status: 409 }
      );
    }
    // Justificativa obrigatória na marcação de última hora.
    if (!reason) {
      return NextResponse.json(
        { error: "Justificativa obrigatória para marcação de última hora" },
        { status: 400 }
      );
    }
    if (reason === "outro" && !note) {
      return NextResponse.json(
        { error: "Descreva a justificativa" },
        { status: 400 }
      );
    }
    // Marcação de última hora: grava sempre uma linha attending=true com os
    // metadados de aprovação (independente do modo). Só vale para a fiscalização
    // após o admin aprovar (late_approved).
    const { error } = await supabaseAdmin.from("meal_marks").upsert(
      {
        cadet_id: session.sub,
        slot_id: slotId,
        attending: true,
        late_marking: true,
        late_marked_at: new Date().toISOString(),
        late_approved: false,
        late_reason: reason,
        late_note: reason === "outro" ? note : null,
      },
      { onConflict: "cadet_id,slot_id" }
    );
    if (error) {
      // Inclui o motivo do banco: se as colunas late_reason/late_note ainda não
      // existirem (migração não aplicada), o erro fica explícito aqui.
      return NextResponse.json(
        { error: "Erro ao salvar: " + error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, slot_id: slotId, marked, late: true });
  }

  // ---- Fase aberta: marcar/desmarcar normalmente ---------------------------
  // Modelo de armazenamento (uma linha = escolha explícita):
  //  - opcional: "Sim" => linha attending=true; "Não" => sem linha (default Não).
  //  - opt-out:  "Sim" => sem linha (default Sim);  "Não" => linha attending=false.
  const storeRow = isOptOut ? !marked : marked; // precisamos persistir uma linha?
  const attending = marked; // a escolha do cadete

  if (storeRow) {
    // Volta a ser marcação NORMAL: zera qualquer flag de última hora anterior.
    const { error } = await supabaseAdmin.from("meal_marks").upsert(
      {
        cadet_id: session.sub,
        slot_id: slotId,
        attending,
        late_marking: false,
        late_marked_at: null,
        late_approved: false,
        late_reason: null,
        late_note: null,
      },
      { onConflict: "cadet_id,slot_id" }
    );
    if (error) {
      return NextResponse.json({ error: "Erro ao salvar" }, { status: 500 });
    }
  } else {
    // Volta ao default do modo: remove qualquer linha existente.
    const { error } = await supabaseAdmin
      .from("meal_marks")
      .delete()
      .eq("cadet_id", session.sub)
      .eq("slot_id", slotId);
    if (error) {
      return NextResponse.json({ error: "Erro ao salvar" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, slot_id: slotId, marked });
}
