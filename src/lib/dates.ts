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
// Retorna o carimbo "YYYY-MM-DDT23:59:00" desse instante.
export function autoLockStamp(mealDateISO: string): string {
  const d = addDays(parseISODate(mealDateISO), -4);
  return `${toISODate(d)}T23:59:00`;
}

// Data ISO ("YYYY-MM-DD") em que o bloqueio automático da refeição entra em
// vigor (o horário é sempre 23:59). Útil para exibir "bloqueia seg 23:59".
export function autoLockDate(mealDateISO: string): string {
  return toISODate(addDays(parseISODate(mealDateISO), -4));
}

// A refeição já passou do prazo de bloqueio automático?
export function isAutoLocked(
  mealDateISO: string,
  nowStamp: string = nowSaoPauloStamp()
): boolean {
  return nowStamp >= autoLockStamp(mealDateISO);
}

// Intenção manual do admin sobre o bloqueio de uma refeição:
//   null / undefined -> segue a regra automática (4 dias antes, 23:59)
//   "bloqueado"      -> admin travou manualmente (independe da data)
//   "desbloqueado"   -> admin abriu exceção: liberado mesmo que o automático
//                       já bloquearia (o desbloqueio manual VENCE tudo)
export type LockOverride = "bloqueado" | "desbloqueado" | null;

// Regra final combinada: a refeição está bloqueada para marcação?
//   desbloqueado -> nunca (exceção do admin vence)
//   bloqueado    -> sempre
//   automático   -> só depois do prazo de 4 dias
export function effectiveLocked(
  lockOverride: LockOverride | string | null | undefined,
  mealDateISO: string,
  nowStamp: string = nowSaoPauloStamp()
): boolean {
  if (lockOverride === "desbloqueado") return false;
  if (lockOverride === "bloqueado") return true;
  return isAutoLocked(mealDateISO, nowStamp);
}
