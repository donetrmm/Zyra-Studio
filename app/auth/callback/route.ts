import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth y email-confirmation callback. Supabase redirige aquí con ?code=...
// El intercambio del code → session escribe las cookies necesarias.

// Whitelist estricto para `next`: debe ser un path interno de la app.
// Bloquea:
//   - protocol-relative ("//evil.com")
//   - userinfo trick ("@evil.com" → "https://zyra@evil.com")
//   - backslash escapes ("/\evil.com")
//   - URLs absolutas ("https://evil.com")
function safeNext(raw: string | null): string {
  if (!raw) return "/app";
  if (!raw.startsWith("/")) return "/app";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/app";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
