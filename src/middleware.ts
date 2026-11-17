import { NextResponse, type NextRequest } from "next/server";

/** Barreira leve: sem cookie de sessão, vai para o login. A validação real ocorre no servidor. */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("casafro_sessao")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|setup|_next|icon.png|logo-casafro|favicon.ico).*)"],
};
