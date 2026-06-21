import { NextResponse } from "next/server";
import { selectAll } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

interface CadetLite {
  number: string;
  name: string;
}

// GET /api/marks/detail?slot_id=UUID&squadron=N  (admin)
// Lista os cadetes de um esquadrão que marcaram "Sim" em um slot.
// Carregado sob demanda (ao clicar no número no Resumo).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const slotId = searchParams.get("slot_id");
  const squadron = Number(searchParams.get("squadron"));

  if (!slotId) {
    return NextResponse.json({ error: "slot_id obrigatório" }, { status: 400 });
  }
  if (![1, 2, 3, 4].includes(squadron)) {
    return NextResponse.json({ error: "Esquadrão inválido" }, { status: 400 });
  }

  try {
    const marks = await selectAll<{ cadets: CadetLite }>(
      "meal_marks",
      "id, cadets!inner(number, name, squadron)",
      (q) =>
        q
          .eq("slot_id", slotId)
          .eq("attending", true) // opt-ins = quem marcou "Sim"
          .eq("cadets.squadron", squadron)
    );

    const cadets = marks
      .map((m) => m.cadets)
      .filter(Boolean)
      .sort((a, b) => a.number.localeCompare(b.number));

    return NextResponse.json({ cadets });
  } catch {
    return NextResponse.json({ error: "Erro ao buscar cadetes" }, { status: 500 });
  }
}
