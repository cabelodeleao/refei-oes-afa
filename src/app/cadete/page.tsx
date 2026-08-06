import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { getSession, homePath } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import CadeteClient from "./CadeteClient";

export const dynamic = "force-dynamic";

// Garante que o cadete tenha um qr_token (legado pode estar NULL). Gera e
// persiste sob demanda, retornando o token atual.
async function ensureQrToken(cadetId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("cadets")
    .select("qr_token")
    .eq("id", cadetId)
    .maybeSingle();

  if (data?.qr_token) return data.qr_token;

  const token = randomBytes(18).toString("base64url");
  const { error } = await supabaseAdmin
    .from("cadets")
    .update({ qr_token: token })
    .eq("id", cadetId);

  return error ? null : token;
}

export default async function CadetePage() {
  const session = await getSession();
  if (!session) redirect("/");
  // Só cadetes marcam refeições: admin, rancho e fiscal (sargentos, squadron 0)
  // voltam cada um para a sua própria tela.
  const home = homePath(session);
  if (home !== "/cadete") redirect(home);

  const qrToken = await ensureQrToken(session.sub);

  return (
    <CadeteClient
      user={{
        name: session.name,
        number: session.number,
        squadron: session.squadron,
      }}
      qrToken={qrToken}
    />
  );
}
