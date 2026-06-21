// Rate-limiter simples em memória (por instância do servidor).
// Suficiente para o nosso caso — não exige Redis/Upstash.
// Conta TENTATIVAS FALHAS por chave (número do cadete) numa janela deslizante.

const WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const MAX_ATTEMPTS = 5;

const failures = new Map<string, number[]>(); // chave -> timestamps das falhas

function prune(key: string, now: number): number[] {
  const arr = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length > 0) failures.set(key, arr);
  else failures.delete(key);
  return arr;
}

// Retorna true se a chave AINDA pode tentar (abaixo do limite).
export function isAllowed(key: string): boolean {
  return prune(key, Date.now()).length < MAX_ATTEMPTS;
}

// Registra uma falha de login.
export function recordFailure(key: string): void {
  const now = Date.now();
  const arr = prune(key, now);
  arr.push(now);
  failures.set(key, arr);
}

// Limpa o histórico após login bem-sucedido.
export function reset(key: string): void {
  failures.delete(key);
}

export const RATE_LIMIT_MINUTES = WINDOW_MS / 60000;
