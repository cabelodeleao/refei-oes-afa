import { type NextRequest, NextResponse } from "next/server";
import { verifySession, homePath } from "@/lib/auth";
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
  // Conta do rancho: só consulta o painel de resumo (/rancho).
  const isRancho = Boolean(session.is_rancho || session.is_admin);
  const home = homePath(session);

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
    url.pathname = home;
    return NextResponse.redirect(url);
  }

  // Controle de acesso por papel nas páginas
  if (pathname.startsWith("/admin") && !session.is_admin) {
    const url = req.nextUrl.clone();
    url.pathname = home;
    return NextResponse.redirect(url);
  }
  // /cadete é só para cadetes: cada outro papel volta para a sua própria tela.
  if (pathname.startsWith("/cadete") && home !== "/cadete") {
    const url = req.nextUrl.clone();
    url.pathname = home;
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
    url.pathname = home;
    return NextResponse.redirect(url);
  }

  // /rancho: só a conta do rancho (ou o admin).
  if (pathname.startsWith("/rancho") && !isRancho) {
    const url = req.nextUrl.clone();
    url.pathname = home;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/cadete/:path*",
    "/admin/:path*",
    "/fiscal/:path*",
    "/rancho/:path*",
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
