import { WEEKDAYS } from "./constants";

// Trabalhamos com datas no formato "YYYY-MM-DD" (coluna DATE do Postgres),
// evitando problemas de fuso ao construir Date a partir de strings.

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// "Segunda-feira, 16/06"
export function formatLongDate(iso: string): string {
  const d = parseISODate(iso);
  const weekday = WEEKDAYS[d.getDay()];
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${weekday}, ${day}/${month}`;
}

// "16/06"
export function formatShortDate(iso: string): string {
  const d = parseISODate(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

export function weekdayShort(iso: string): string {
  return WEEKDAYS[parseISODate(iso).getDay()].slice(0, 3);
}

// Lista de datas ISO entre from e to (inclusivo).
export function dateRange(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const start = parseISODate(fromISO);
  const end = parseISODate(toISO);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(toISODate(d));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trimestres (calendário civil), usados no backup e na limpeza de registros:
//   1º = janeiro a março · 2º = abril a junho
//   3º = julho a setembro · 4º = outubro a dezembro
// ---------------------------------------------------------------------------

export interface Quarter {
  year: number;
  quarter: number; // 1 a 4
  from: string; // primeiro dia (YYYY-MM-DD)
  to: string; // último dia (YYYY-MM-DD)
  label: string; // "3º trimestre de 2026 (julho a setembro)"
}

const QUARTER_MONTHS = ["janeiro a março", "abril a junho", "julho a setembro", "outubro a dezembro"];

// Último dia do mês (mês 1-12), sem depender de tabela de dias.
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function quarterInfo(year: number, quarter: number): Quarter {
  const q = Math.min(4, Math.max(1, quarter));
  const firstMonth = (q - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  const mm = (m: number) => String(m).padStart(2, "0");
  return {
    year,
    quarter: q,
    from: `${year}-${mm(firstMonth)}-01`,
    to: `${year}-${mm(lastMonth)}-${mm(lastDayOfMonth(year, lastMonth))}`,
    label: `${q}º trimestre de ${year} (${QUARTER_MONTHS[q - 1]})`,
  };
}

// Em que trimestre cai uma data ISO.
export function quarterOfDate(iso: string): { year: number; quarter: number } {
  const [y, m] = iso.split("-").map(Number);
  return { year: y, quarter: Math.floor((m - 1) / 3) + 1 };
}

// Os `count` trimestres mais recentes, do atual para trás.
export function recentQuarters(count: number, todayISO = todaySaoPaulo()): Quarter[] {
  const { year, quarter } = quarterOfDate(todayISO);
  const out: Quarter[] = [];
  let y = year;
  let q = quarter;
  for (let i = 0; i < count; i++) {
    out.push(quarterInfo(y, q));
    q -= 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
  }
  return out;
}

// Segunda-feira da semana que contém `date`.
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Data de "hoje" no fuso de Brasília (America/Sao_Paulo), em "YYYY-MM-DD".
// O servidor (Vercel) roda em UTC; sem isto, à noite "hoje" viraria o dia
// seguinte. en-CA formata como YYYY-MM-DD.
export function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

// Momento atual no relógio de parede de Brasília, como "YYYY-MM-DDTHH:mm:ss".
// Comparável lexicograficamente com outros carimbos no mesmo formato e fuso —
// evita ter que lidar com offset de fuso na aritmética de bloqueio automático.
export function nowSaoPauloStamp(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  // Alguns runtimes formatam a meia-noite como "24" — normaliza para "00".
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`;
}

// Bloqueio automático: uma refeição fecha 4 dias antes da sua data, às 23:59
// (horário de Brasília). Ex.: refeição de sexta -> fecha na segunda 23:59.
// Retorna o carimbo "YYYY-MM-DDT23:59:00" desse instante. É o INÍCIO da fase de
// "segunda chance" (a partir daqui o cadete só pode marcar, não desmarcar).
export function autoLockStamp(mealDateISO: string): string {
  const d = addDays(parseISODate(mealDateISO), -4);
  return `${toISODate(d)}T23:59:00`;
}

// Fechamento definitivo: 1 dia antes da refeição, às 23:59 (horário de Brasília).
// É o FIM da segunda chance — a partir daqui ninguém marca nem desmarca.
export function closeLockStamp(mealDateISO: string): string {
  const d = addDays(parseISODate(mealDateISO), -1);
  return `${toISODate(d)}T23:59:00`;
}

// Data ISO ("YYYY-MM-DD") em que o bloqueio automático da refeição entra em
// vigor (o horário é sempre 23:59). Útil para exibir "bloqueia seg 23:59".
export function autoLockDate(mealDateISO: string): string {
  return toISODate(addDays(parseISODate(mealDateISO), -4));
}

// Data ISO em que a refeição fecha de vez (1 dia antes, 23:59). Fim da segunda
// chance — útil para exibir "marca até qui 23:59".
export function closeLockDate(mealDateISO: string): string {
  return toISODate(addDays(parseISODate(mealDateISO), -1));
}

// A refeição já passou do prazo de bloqueio automático (início da segunda chance)?
export function isAutoLocked(
  mealDateISO: string,
  nowStamp: string = nowSaoPauloStamp()
): boolean {
  return nowStamp >= autoLockStamp(mealDateISO);
}

// Intenção manual do admin sobre o bloqueio de uma refeição:
//   null / undefined -> segue a regra automática (as 3 fases abaixo)
//   "bloqueado"      -> admin travou manualmente: encerra a marcação normal na
//                       hora, mas a SEGUNDA CHANCE (marcação de última hora,
//                       sujeita a aprovação) continua valendo até o fechamento
//                       definitivo — igual ao bloqueio automático
//   "desbloqueado"   -> admin abriu exceção: marcação normal continua liberada
//                       (o desbloqueio manual VENCE tudo)
export type LockOverride = "bloqueado" | "desbloqueado" | null;

// As três fases de uma refeição (fuso America/Sao_Paulo):
//   "aberta"          -> marcar e desmarcar normalmente (até 4 dias antes, 23:59)
//   "segunda_chance"  -> SÓ marcar, não desmarcar (de 4 dias antes até 1 dia
//                        antes, 23:59 — ou assim que o admin bloqueia
//                        manualmente); marcações aqui são "de última hora" e
//                        precisam de aprovação do admin para valer
//   "fechada"         -> nada mais pode ser feito (a partir de 1 dia antes, 23:59)
export type MealPhase = "aberta" | "segunda_chance" | "fechada";

// Fase atual de uma refeição, combinando o override manual do admin com o
// calendário automático. Ver MealPhase.
export function mealPhase(
  lockOverride: LockOverride | string | null | undefined,
  mealDateISO: string,
  nowStamp: string = nowSaoPauloStamp()
): MealPhase {
  if (lockOverride === "desbloqueado") return "aberta"; // exceção do admin
  // Trava manual: pula direto para a segunda chance (o cadete não marca nem
  // desmarca livremente, mas ainda pode SOLICITAR a refeição de última hora,
  // sujeita à aprovação do admin). Depois do fechamento definitivo, fechada.
  if (lockOverride === "bloqueado") {
    return nowStamp < closeLockStamp(mealDateISO) ? "segunda_chance" : "fechada";
  }
  if (nowStamp < autoLockStamp(mealDateISO)) return "aberta";
  if (nowStamp < closeLockStamp(mealDateISO)) return "segunda_chance";
  return "fechada";
}

// Regra combinada: a marcação está TRAVADA (não pode ser livremente editada)?
// True nas fases "segunda_chance" e "fechada". Mantido para usos em que só
// importa "está aberto para edição normal?" (ex.: resumo do admin). Para o
// fluxo do cadete use mealPhase, que distingue a segunda chance.
export function effectiveLocked(
  lockOverride: LockOverride | string | null | undefined,
  mealDateISO: string,
  nowStamp: string = nowSaoPauloStamp()
): boolean {
  return mealPhase(lockOverride, mealDateISO, nowStamp) !== "aberta";
}
