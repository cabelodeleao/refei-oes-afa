import { type NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/constants";

// Rotas públicas (não exigem autenticação).
const PUBLIC_PATHS = ["/", "/api/auth/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = await verifySession(token);

  // Não autenticado
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Controle de acesso por papel nas páginas
  if (pathname.startsWith("/admin") && !session.is_admin) {
    const url = req.nextUrl.clone();
    url.pathname = "/cadete";
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/cadete") && session.is_admin) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/cadete/:path*",
    "/admin/:path*",
    "/api/slots/:path*",
    "/api/marks/:path*",
    "/api/menu-photo/:path*",
    "/api/admin/:path*",
    "/api/auth/change-password",
    "/api/auth/logout",
  ],
};
