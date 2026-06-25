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
  must_change_password: boolean;
}

export async function signSession(user: SessionInput): Promise<string> {
  return new SignJWT({
    number: user.number,
    name: user.name,
    squadron: user.squadron,
    is_admin: user.is_admin,
    is_fiscal: user.is_fiscal,
    must_change_password: user.must_change_password,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
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
export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  return verifySession(token);
}
