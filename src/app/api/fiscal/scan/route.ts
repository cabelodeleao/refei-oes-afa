import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import {
  getAccess,
  SQUADRON_LABELS,
  type SquadronAccess,
} from "@/lib/constants";

export const runtime = "nodejs";

type ScanStatus = "autorizado" | "negado" | "ja_registrado" | "invalido";
type ScanResult = "autorizado" | "nao_marcou" | "duplicado";

// Registra a tentativa de leitura no log completo (scan_attempts). Best-effort:
// uma falha no log nunca deve impedir a resposta visual ao fiscal. Retorna o id
// da linha criada (usado p/ o fiscal anotar fraude numa leitura duplicada).
async function logAttempt(
  cadetId: string,
  slotId: string,
  fiscalId: string | undefined,
  result: ScanResult
): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("scan_attempts")
      .insert({
        cadet_id: cadetId,
        slot_id: slotId,
        fiscal_id: fiscalId ?? null,
        result,
      })
      .select("id")
      .single();
    return data?.id ?? null;
  } catch {
    /* log é best-effort */
    return null;
  }
}

// POST /api/fiscal/scan  (fiscal/admin)
// Body: { qr_token?, number?, slot_id }
// Identifica o cadete pelo QR (qr_token) OU pelo número digitado (number,
// "leitura sem QR"), valida o direito àquela refeição e, se autorizado, registra
// a entrada em meal_entries (uma única vez por cadete/slot). O número é aceito
// com ou sem barra ("25/217" ou "25217"), igual ao login.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !(session.is_fiscal || session.is_admin)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let body: { qr_token?: string; number?: string; slot_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const qrToken = body.qr_token?.trim();
  const numberInput = body.number?.trim();
  const slotId = body.slot_id;
  if (!slotId || (!qrToken && !numberInput)) {
    return NextResponse.json(
      { error: "Informe o QR (qr_token) ou o número (number), e o slot_id" },
      { status: 400 }
    );
  }

  // A refeição só depende do slot_id: busca em PARALELO com o cadete (reduz uma
  // ida ao banco no caminho comum — importante na leitura rápida por número).
  const slotPromise = supabaseAdmin
    .from("meal_slots")
    .select("id, squadrons")
    .eq("id", slotId)
    .maybeSingle();

  // 1) Identifica o cadete: por QR (token) ou por número digitado.
  let cadet: {
    id: string;
    number: string;
    name: string;
    squadron: number;
  } | null = null;
  const cols = "id, number, name, squadron";

  if (qrToken) {
    const { data, error: cadetErr } = await supabaseAdmin
      .from("cadets")
      .select(cols)
      .eq("qr_token", qrToken)
      .maybeSingle();
    if (cadetErr) {
      return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
    }
    cadet = data;
    if (!cadet) {
      return NextResponse.json({
        status: "invalido" as ScanStatus,
        reason: "QR inválido ou não reconhecido",
      });
    }
  } else {
    // Por número: tenta como digitado e, se só dígitos, no formato com barra.
    const num = numberInput as string;
    const { data, error: cadetErr } = await supabaseAdmin
      .from("cadets")
      .select(cols)
      .eq("number", num)
      .maybeSingle();
    if (cadetErr) {
      return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
    }
    cadet = data;
    if (!cadet && /^\d{3,}$/.test(num)) {
      const withSlash = `${num.slice(0, 2)}/${num.slice(2)}`;
      const retry = await supabaseAdmin
        .from("cadets")
        .select(cols)
        .eq("number", withSlash)
        .maybeSingle();
      if (retry.error) {
        return NextResponse.json({ error: "Erro no servidor" }, { status: 500 });
      }
      cadet = retry.data;
    }
    if (!cadet) {
      return NextResponse.json({
        status: "invalido" as ScanStatus,
        reason: "Número não encontrado",
      });
    }
  }

  // 2) Slot (já iniciado em paralelo lá em cima).
  const { data: slot, error: slotErr } = await slotPromise;

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
  // o esquadrão dele tem direito à refeição ("opcional" ou "todos").
  const needsMark = access !== "ninguem";

  let mark:
    | { attending: boolean; late_marking: boolean; late_approved: boolean }
    | null = null;
  if (needsMark) {
    const { data, error: markErr } = await supabaseAdmin
      .from("meal_marks")
      .select("attending, late_marking, late_approved")
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
  } else {
    // "todos" (obrigatória): autorizado, exceto se desmarcou (attending=false).
    authorized = !(mark && mark.attending === false);
    if (!authorized) reason = "Desmarcou esta refeição";
  }

  // Marcação de última hora (segunda chance) só vale APÓS o admin aprovar. Até
  // lá, mesmo estando na lista, a entrada não é autorizada (horário extra ainda
  // não liberado).
  if (authorized && mark?.late_marking === true && mark?.late_approved !== true) {
    authorized = false;
    reason = "Última hora — aguardando aprovação do admin";
  }

  if (!authorized) {
    await logAttempt(cadet.id, slotId, session.sub, "nao_marcou");
    return NextResponse.json({
      status: "negado" as ScanStatus,
      cadet: cadetInfo,
      reason,
    });
  }

  // 4) Autorizado: registra a entrada. Em vez de checar antes se já existe
  // (uma consulta a mais), tenta inserir direto e trata o duplicado pelo índice
  // único (UNIQUE cadet_id, slot_id) — mais rápido no caminho comum.
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("meal_entries")
    .insert({ cadet_id: cadet.id, slot_id: slotId, fiscal_id: session.sub })
    .select("entered_at")
    .single();

  if (insErr) {
    // Já existe (mesma leitura repetida) ou corrida no mesmo instante.
    if (insErr.code === "23505") {
      const attemptId = await logAttempt(cadet.id, slotId, session.sub, "duplicado");
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
        attempt_id: attemptId,
      });
    }
    return NextResponse.json({ error: "Erro ao registrar entrada" }, { status: 500 });
  }

  await logAttempt(cadet.id, slotId, session.sub, "autorizado");

  return NextResponse.json({
    status: "autorizado" as ScanStatus,
    cadet: cadetInfo,
    entered_at: inserted.entered_at,
  });
}
