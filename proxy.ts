import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next 16 renombró middleware.ts a proxy.ts. Misma API, ahora corre en Node.js.
//
// Hace un check optimista de sesión por cookie:
// - Refresca la sesión via updateSession() (toca cookies si están por vencer).
// - Si la ruta requiere auth y no hay sesión, redirige a /login.
// - Si el usuario YA está autenticado e intenta /login o /signup, redirige
//   a /app para que no quede atorado en pantallas de auth.
//
// Los checks de role (admin) y de workspace existente NO se hacen aquí porque
// requieren queries pesadas; viven en lib/auth/dal.ts y se invocan desde
// los layouts/pages correspondientes.
export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isAuthRoute = pathname === "/login" || pathname === "/signup";
  const isProtected = pathname.startsWith("/app") || pathname.startsWith("/admin") || pathname === "/onboarding";

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Excluye assets estáticos y la ruta de callback (esa maneja su propio redirect).
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.svg$|.*\\.png$|.*\\.ico$).*)",
  ],
};
