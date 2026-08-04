import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { mealPhase } from "@/lib/dates";

export const runtime = "nodejs";

// PUT /api/slots/lock  (admin) — define a intenção manual de bloqueio de vários
// slots. `override`:
//   "bloqueado"    -> trava manualmente (independe da data). Encerra a marcação
//                     normal, mas o cadete ainda pode solicitar a refeição de
//                     última hora (sujeita à aprovação), igual ao automático.
//   "desbloqueado" -> abre exceção: liberado mesmo que o automático bloquearia
//   null           -> "Automático": volta a seguir a regra dos 4 dias
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { slot_ids?: string[]; override?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const ids = body.slot_ids ?? [];
  const raw = body.override;
  // Normaliza: só aceita os três estados válidos; qualquer outra coisa vira null.
  const override =
    raw === "bloqueado" || raw === "desbloqueado" ? raw : null;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "Nenhum slot informado" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("meal_slots")
    .update({ lock_override: override })
    .in("id", ids)
    .select("id, date, lock_override");

  if (error) {
    return NextResponse.json(
      { error: "Erro ao atualizar bloqueio" },
      { status: 500 }
    );
  }

  // Refeições que VOLTARAM a ficar abertas (desbloqueio manual, ou volta ao
  // automático ainda dentro do prazo): os pedidos de última hora que estavam
  // esperando aprovação são aprovados na hora. Sem isto o cadete ficaria com a
  // marcação "pendente" numa refeição aberta — o fiscal barraria a entrada dele
  // e ele não entraria na contagem, sem ninguém entender o porquê.
  let approved = 0;
  const reopened = (data ?? [])
    .filter((s) => mealPhase(s.lock_override, s.date) === "aberta")
    .map((s) => s.id);

  if (reopened.length > 0) {
    const { data: fixed, error: approveErr } = await supabaseAdmin
      .from("meal_marks")
      .update({ late_approved: true })
      .in("slot_id", reopened)
      .eq("late_marking", true)
      .eq("late_approved", false)
      .select("id");
    // Aprovação é complementar: se falhar, o bloqueio já foi salvo e o admin
    // ainda pode aprovar na aba de aprovações.
    if (!approveErr) approved = fixed?.length ?? 0;
  }

  return NextResponse.json({ ok: true, updated: data, approved });
}
