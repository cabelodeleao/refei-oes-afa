import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import {
  getAccess,
  isOptOutSquadron,
  SQUADRON_LABELS,
  type SquadronAccess,
} from "@/lib/constants";

export const runtime = "nodejs";

type ScanStatus = "autorizado" | "negado" | "ja_registrado" | "invalido";

// POST /api/fiscal/scan  (fiscal/admin)
// Body: { qr_token, slot_id }
// Valida o direito do cadete àquela refeição e, se autorizado, registra a
// entrada em meal_entries (uma única vez por cadete/slot).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(session.is_fiscal || session.is_admin)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { qr_token?: string; slot_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const qrToken = body.qr_token?.trim();
  const slotId = body.slot_id;
  if (!qrToken || !slotId) {
    return NextResponse.json(
      { error: "qr_token e slot_id são obrigatórios" },
      { status: 400 }
    );
  }

  // 1) Cadete pelo token do QR.
  const { data: cadet, error: cadetErr } = await supabaseAdmin
    .from("cadets")
    .select("id, number, name, squadron")
    .eq("qr_token", qrToken)
    .maybeSingle();

  if (cadetErr) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (!cadet) {
    return NextResponse.json({
      status: "invalido" as ScanStatus,
      reason: "QR inválido ou não reconhecido",
    });
  }

  // 2) Slot.
  const { data: slot, error: slotErr } = await supabaseAdmin
    .from("meal_slots")
    .select("id, squadrons, locked")
    .eq("id", slotId)
    .maybeSingle();

  if (slotErr) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }
  if (!slot) {
    return NextResponse.json({ error: "Refeição não encontrada" }, { status: 404 });
  }

  const cadetInfo = {
    name: cadet.name,
    number: cadet.number,
    squadron: cadet.squadron,
    squadron_label: SQUADRON_LABELS[cadet.squadron] ?? "—",
  };

  // 3) Direito do cadete a esta refeição.
  const access = getAccess(slot.squadrons as SquadronAccess, cadet.squadron);

  let authorized = false;
  let reason = "";

  // Só precisamos consultar a escolha explícita do cadete (meal_marks) quando
  // a refeição é "opcional" ou "todos" para 3º/4º (opt-out).
  const needsMark =
    access === "opcional" ||
    (access === "todos" && isOptOutSquadron(cadet.squadron));

  let mark: { attending: boolean } | null = null;
  if (needsMark) {
    const { data, error: markErr } = await supabaseAdmin
      .from("meal_marks")
      .select("attending")
      .eq("cadet_id", cadet.id)
      .eq("slot_id", slotId)
      .maybeSingle();
    if (markErr) {
      return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
    }
    mark = data;
  }

  if (access === "ninguem") {
    reason = "Seu esquadrão não tem esta refeição";
  } else if (access === "opcional") {
    // Opcional: precisa de opt-in explícito (attending=true).
    authorized = mark?.attending === true;
    if (!authorized) reason = "Não marcou esta refeição";
  } else if (isOptOutSquadron(cadet.squadron)) {
    // "todos" 3º/4º: autorizado, exceto se desmarcou (attending=false).
    authorized = !(mark && mark.attending === false);
    if (!authorized) reason = "Desmarcou esta refeição";
  } else {
    // "todos" 1º/2º: obrigatória estrita, sempre autorizado.
    authorized = true;
  }

  if (!authorized) {
    return NextResponse.json({
      status: "negado" as ScanStatus,
      cadet: cadetInfo,
      reason,
    });
  }

  // 4) Autorizado: registra a entrada (apenas uma vez por cadete/slot).
  const { data: existing, error: existErr } = await supabaseAdmin
    .from("meal_entries")
    .select("entered_at")
    .eq("cadet_id", cadet.id)
    .eq("slot_id", slotId)
    .maybeSingle();

  if (existErr) {
    return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
  }

  if (existing) {
    return NextResponse.json({
      status: "ja_registrado" as ScanStatus,
      cadet: cadetInfo,
      entered_at: existing.entered_at,
    });
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("meal_entries")
    .insert({ cadet_id: cadet.id, slot_id: slotId, fiscal_id: session.sub })
    .select("entered_at")
    .single();

  if (insErr) {
    // Corrida: outra leitura registrou no mesmo instante (viola o UNIQUE).
    if (insErr.code === "23505") {
      const { data: again } = await supabaseAdmin
        .from("meal_entries")
        .select("entered_at")
        .eq("cadet_id", cadet.id)
        .eq("slot_id", slotId)
        .maybeSingle();
      return NextResponse.json({
        status: "ja_registrado" as ScanStatus,
        cadet: cadetInfo,
        entered_at: again?.entered_at ?? null,
      });
    }
    return NextResponse.json({ error: "Erro ao registrar entrada" }, { status: 500 });
  }

  return NextResponse.json({
    status: "autorizado" as ScanStatus,
    cadet: cadetInfo,
    entered_at: inserted.entered_at,
  });
}
