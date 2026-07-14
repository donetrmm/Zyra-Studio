import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Data Access Layer de auth. Cada función está memoizada con React.cache para
// que múltiples llamadas en el mismo render solo hagan una query a Supabase.
//
// Patrón de uso:
// - Server Components y Server Actions usan estos helpers para garantizar que
//   el usuario está autenticado y tiene los permisos correctos.
// - El `proxy.ts` raíz ya filtra optimistamente (cookie session); estos helpers
//   son la verificación dura contra DB.

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: "user" | "admin";
  status: "active" | "suspended" | "deleted";
  area: string | null;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, role, status, area")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  // Fallback al nombre de la metadata de auth: el trigger handle_new_user no
  // copia full_name a profiles, así que sin esto el saludo cae al prefijo del
  // email (hallazgo UX 2026-06-13). Cubre a todos los usuarios sin migración.
  const metaFullName = user.user_metadata?.full_name;

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name ?? (typeof metaFullName === "string" ? metaFullName : null),
    avatarUrl: profile.avatar_url,
    role: profile.role,
    status: profile.status,
    area: profile.area,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") notFound();
  return user;
}

export type CurrentWorkspace = {
  id: string;
  name: string;
  ownerId: string;
  role: "owner" | "editor" | "viewer";
};

// Cookie con el workspace elegido explícitamente (equipos, specs/v2/20). La
// setea setActiveWorkspaceAction tras validar membresía; aquí igual se
// re-valida contra workspace_members — una cookie apuntando a un workspace
// del que el usuario ya no es miembro cae al default.
export const ACTIVE_WORKSPACE_COOKIE = "active_workspace";
const WS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MembershipRow = {
  role: "owner" | "editor" | "viewer";
  workspaces: { id: string; name: string; owner_id: string };
};

function toCurrentWorkspace(row: MembershipRow): CurrentWorkspace {
  return {
    id: row.workspaces.id,
    name: row.workspaces.name,
    ownerId: row.workspaces.owner_id,
    role: row.role,
  };
}

// Devuelve el workspace activo: el de la cookie de selección si el usuario es
// miembro; si no, el primero de los que pertenece (su propio workspace, el
// más antiguo por created_at).
export const getCurrentWorkspace = cache(
  async (): Promise<CurrentWorkspace | null> => {
    const user = await getCurrentUser();
    if (!user) return null;

    const supabase = await createClient();

    const cookieStore = await cookies();
    const preferred = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
    if (preferred && WS_UUID_RE.test(preferred)) {
      const { data } = await supabase
        .from("workspace_members")
        .select("role, workspaces!inner(id, name, owner_id)")
        .eq("user_id", user.id)
        .eq("workspace_id", preferred)
        .maybeSingle();
      if (data) return toCurrentWorkspace(data as unknown as MembershipRow);
    }

    const { data, error } = await supabase
      .from("workspace_members")
      .select("role, workspaces!inner(id, name, owner_id)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return toCurrentWorkspace(data as unknown as MembershipRow);
  },
);

export async function requireWorkspace(): Promise<{
  user: CurrentUser;
  workspace: CurrentWorkspace;
}> {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  return { user, workspace };
}

// Variante para API routes: no redirige, devuelve null para que el handler
// pueda responder con 401/403 JSON. Usar requireWorkspace() solo en páginas
// y server actions (donde el redirect HTML es la respuesta correcta).
export type ApiAuthContext = {
  user: CurrentUser;
  workspace: CurrentWorkspace;
};
export type ApiAuthError = "unauthenticated" | "suspended" | "no_workspace";

export async function getApiAuthContext(): Promise<
  { ok: true; ctx: ApiAuthContext } | { ok: false; error: ApiAuthError }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (user.status !== "active") return { ok: false, error: "suspended" };
  const workspace = await getCurrentWorkspace();
  if (!workspace) return { ok: false, error: "no_workspace" };
  return { ok: true, ctx: { user, workspace } };
}
