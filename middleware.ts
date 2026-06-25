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

  const isFiscal = Boolean(session.is_fiscal || session.is_admin);

  // Troca de senha obrigatória (1º acesso de cadetes/fiscais; admin nunca).
  // Enquanto pendente, o usuário só acessa a tela de troca e as rotas
  // estritamente necessárias para concluí-la (trocar senha / sair).
  const mustChange = Boolean(session.must_change_password) && !session.is_admin;
  const changePwAllowed =
    pathname === "/trocar-senha" ||
    pathname === "/api/auth/change-password" ||
    pathname === "/api/auth/logout";

  if (mustChange && !changePwAllowed) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Troca de senha obrigatória" },
        { status: 403 }
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/trocar-senha";
    return NextResponse.redirect(url);
  }

  // Quem já trocou (ou o admin) não fica preso na tela de troca obrigatória.
  if (!mustChange && pathname === "/trocar-senha") {
    const url = req.nextUrl.clone();
    url.pathname = session.is_admin ? "/admin" : isFiscal ? "/fiscal" : "/cadete";
    return NextResponse.redirect(url);
  }

  // Controle de acesso por papel nas páginas
  if (pathname.startsWith("/admin") && !session.is_admin) {
    const url = req.nextUrl.clone();
    url.pathname = isFiscal ? "/fiscal" : "/cadete";
    return NextResponse.redirect(url);
  }
  // /cadete é só para cadetes: admin vai p/ /admin, fiscal (sargento) p/ /fiscal.
  if (pathname.startsWith("/cadete") && session.is_admin) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/cadete") && session.is_fiscal && !session.is_admin) {
    const url = req.nextUrl.clone();
    url.pathname = "/fiscal";
    return NextResponse.redirect(url);
  }

  // /fiscal e /api/fiscal/*: só fiscal ou admin.
  if (
    (pathname.startsWith("/fiscal") || pathname.startsWith("/api/fiscal")) &&
    !isFiscal
  ) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/cadete";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/cadete/:path*",
    "/admin/:path*",
    "/fiscal/:path*",
    "/trocar-senha",
    "/api/slots/:path*",
    "/api/marks/:path*",
    "/api/menu-photo/:path*",
    "/api/admin/:path*",
    "/api/fiscal/:path*",
    "/api/auth/change-password",
    "/api/auth/logout",
  ],
};
