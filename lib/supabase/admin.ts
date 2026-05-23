import "server-only";
import { createClient } from "@supabase/supabase-js";

// Cliente con service_role: salta RLS. Solo server-side, jamás importable
// desde un componente cliente (server-only lo bloquea en build).
// Úsalo desde server actions / route handlers / worker para operaciones
// administrativas que no pueden pasar por security definer functions.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
