import { createClient } from "@supabase/supabase-js";

// Cliente server-side usando a service_role key.
// NUNCA importar este módulo em código de cliente.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "Variáveis de ambiente do Supabase ausentes (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
  );
}

export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// O Supabase/PostgREST limita cada resposta (por padrão 1000 linhas). Para
// tabelas que podem crescer (meal_marks, cadets, meal_slots), busque TODAS as
// linhas paginando por janelas de range. A paginação é estável porque sempre
// ordenamos por uma coluna única (`id` por padrão) antes de aplicar o range.
const PAGE_SIZE = 1000;

// `refine` recebe a query base e aplica filtros (.eq/.in/.gte/...).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryRefiner = (q: any) => any;

export async function selectAll<T = Record<string, unknown>>(
  table: string,
  columns: string,
  refine?: QueryRefiner,
  orderColumn = "id"
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;

  for (;;) {
    let q = supabaseAdmin
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true });
    if (refine) q = refine(q);

    const { data, error } = await q.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;

    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}
