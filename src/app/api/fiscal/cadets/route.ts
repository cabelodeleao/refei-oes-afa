import { NextResponse } from "next/server";
import { selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

interface CadetRow {
  id: string;
  number: string;
  name: string;
  squadron: number;
}

// GET /api/fiscal/cadets  (fiscal/admin)
// Lista enxuta de cadetes (id, número, nome, esquadrão) para o autocomplete
// da fiscalização (anotar fraude de QR ou entrada sem QR).
export async function GET() {
  const session = await getSession();
  if (!session || !(session.is_fiscal || session.is_admin)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  let cadets: CadetRow[];
  try {
    cadets = await selectAll<CadetRow>(
      "cadets",
      "id, number, name, squadron",
      (q) => q.gt("squadron", 0)
    );
  } catch {
    return NextResponse.json({ error: "Erro ao buscar cadetes" }, { status: 500 });
  }

  cadets.sort((a, b) => a.number.localeCompare(b.number));

  return NextResponse.json({ cadets });
}
