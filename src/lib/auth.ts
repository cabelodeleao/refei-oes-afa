import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { COOKIE_NAME } from "./constants";

export interface SessionUser extends JWTPayload {
  sub: string; // cadet id
  number: string;
  name: string;
  squadron: number;
  is_admin: boolean;
  is_fiscal: boolean;
  // Conta do rancho: só CONSULTA o painel de resumo (não altera nada).
  is_rancho: boolean;
  // true => precisa trocar a senha padrão antes de usar o sistema (1º acesso).
  must_change_password: boolean;
}

const encoder = new TextEncoder();

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET não definido.");
  return encoder.encode(secret);
}

export interface SessionInput {
  sub: string;
  number: string;
  name: string;
  squadron: number;
  is_admin: boolean;
  is_fiscal: boolean;
  is_rancho: boolean;
  must_change_password: boolean;
}

export async function signSession(user: SessionInput): Promise<string> {
  return new SignJWT({
    number: user.number,
    name: user.name,
    squadron: user.squadron,
    is_admin: user.is_admin,
    is_fiscal: user.is_fiscal,
    is_rancho: user.is_rancho,
    must_change_password: user.must_change_password,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}

// Página inicial de cada papel (usada no login, no middleware e após a troca
// de senha). A ordem importa: admin > rancho > fiscal > cadete.
export function homePath(user: {
  is_admin?: boolean;
  is_rancho?: boolean;
  is_fiscal?: boolean;
}): string {
  if (user.is_admin) return "/admin";
  if (user.is_rancho) return "/rancho";
  if (user.is_fiscal) return "/fiscal";
  return "/cadete";
}

// Quem pode CONSULTAR o resumo de marcações: o admin e a conta do rancho.
// A conta do rancho é somente leitura — não aprova, não cria, não edita nada.
export function canViewSummary(
  session: { is_admin?: boolean; is_rancho?: boolean } | null
): boolean {
  return Boolean(session && (session.is_admin || session.is_rancho));
}

export async function verifySession(
  token: string | undefined
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as SessionUser;
  } catch {
    return null;
  }
}

// Lê a sessão atual a partir do cookie (uso em Server Components / Route Handlers).
// Além de verificar a assinatura do JWT, confere no banco se a senha foi
// trocada DEPOIS de o token ser emitido — nesse caso a sessão antiga morre
// (troca voluntária, reset pelo admin ou conta excluída).
//
// O import do Supabase é dinâmico de propósito: este módulo também é usado
// pelo middleware (Edge), que só chama verifySession e não deve carregar o
// cliente do banco.
export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  const session = await verifySession(token);
  if (!session) return null;

  try {
    const { supabaseAdmin } = await import("./supabase");
    const { data, error } = await supabaseAdmin
      .from("cadets")
      .select("password_changed_at")
      .eq("id", session.sub)
      .maybeSingle();

    // Banco indisponível ou coluna ainda não criada (migração pendente):
    // não derruba a sessão por isso.
    if (error) return session;
    // Conta excluída: sessão morre imediatamente.
    if (!data) return null;

    const changedAt = data.password_changed_at
      ? Date.parse(data.password_changed_at as string) / 1000
      : 0;
    // 5s de tolerância: o token reemitido na própria troca de senha tem iat
    // praticamente igual ao password_changed_at e deve continuar válido.
    if (typeof session.iat === "number" && session.iat < changedAt - 5) {
      return null;
    }
  } catch {
    return session;
  }

  return session;
}
