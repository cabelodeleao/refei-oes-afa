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
