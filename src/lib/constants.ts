export const MEAL_TYPES = ["cafe", "almoco", "janta", "ceia"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_LABELS: Record<MealType, string> = {
  cafe: "Café da Manhã",
  almoco: "Almoço",
  janta: "Janta",
  ceia: "Ceia",
};

export const MEAL_SHORT: Record<MealType, string> = {
  cafe: "Café",
  almoco: "Almoço",
  janta: "Janta",
  ceia: "Ceia",
};

// Ícone (emoji) de cada refeição, usado na UI.
export const MEAL_ICONS: Record<MealType, string> = {
  cafe: "☀️",
  almoco: "🍽️",
  janta: "🌙",
  ceia: "✨",
};

// Cardápio: quantas imagens podem ficar no ar ao mesmo tempo. O padrão da
// semana são 3 (sexta-feira, sábado e domingo); a folga cobre semanas com
// feriado emendado, em que o admin publica uma imagem a mais.
export const MENU_IMAGES_DEFAULT = 3;
export const MAX_MENU_IMAGES = 6;
// Títulos sugeridos ao publicar (o admin pode trocar por qualquer texto).
export const MENU_TITLE_SUGGESTIONS = [
  "Sexta-feira",
  "Sábado",
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
];

export const ALL_SQUADRONS = [1, 2, 3, 4] as const;

// Estado de acesso de um esquadrão a uma refeição.
//  - "opcional": cadete escolhe Sim/Não
//  - "todos":    refeição obrigatória, todos do esquadrão comem
//  - "ninguem":  o esquadrão não tem essa refeição
export const ACCESS_STATES = ["opcional", "todos", "ninguem"] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

export const ACCESS_LABELS: Record<AccessState, string> = {
  opcional: "Opcional",
  todos: "Todos",
  ninguem: "Ninguém",
};

// Refeição "todos" (obrigatória) funciona como OPT-OUT para TODOS os
// esquadrões: já aparece marcada por padrão e leva a etiqueta "Obrigatória",
// mas o cadete pode desmarcar se não for comer.
// (Antes só o 3º e o 4º podiam desmarcar; hoje o 1º e o 2º também podem.)

// squadrons é um objeto JSONB: { "1": "opcional", "2": "todos", ... }
export type SquadronAccess = Record<string, AccessState>;

// Lê o estado de acesso de um esquadrão; ausente = "ninguem".
export function getAccess(
  squadrons: SquadronAccess | null | undefined,
  squadron: number
): AccessState {
  const v = squadrons?.[String(squadron)];
  return v === "opcional" || v === "todos" ? v : "ninguem";
}

export const SQUADRON_LABELS: Record<number, string> = {
  0: "Administração",
  1: "1º Esquadrão",
  2: "2º Esquadrão",
  3: "3º Esquadrão",
  4: "4º Esquadrão",
};

export const SQUADRON_SHORT: Record<number, string> = {
  1: "1º Esq",
  2: "2º Esq",
  3: "3º Esq",
  4: "4º Esq",
};

// 26/xxx => 1º ano (1º Esq) ... 23/xxx => 4º ano (4º Esq)
export const SQUADRON_YEAR: Record<number, string> = {
  1: "1º ano",
  2: "2º ano",
  3: "3º ano",
  4: "4º ano",
};

export const WEEKDAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

export const COOKIE_NAME = "afa_token";

// Fiscalização por QR code — DESLIGADA por enquanto (o cadete não vê o botão
// "Meu QR" e o fiscal só registra entrada digitando o número do cadete). Todo
// o código do QR continua no projeto: para religar, basta voltar para `true`.
export const QR_ENABLED = false;
