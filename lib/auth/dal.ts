import "server-only";
import { cache } from "react";
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

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
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

// Devuelve el workspace activo (por ahora: el primero de los que pertenece).
// Multi-workspace switching se implementa en fase 2 con cookie de selección.
export const getCurrentWorkspace = cache(
  async (): Promise<CurrentWorkspace | null> => {
    const user = await getCurrentUser();
    if (!user) return null;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workspace_members")
      .select("role, workspaces!inner(id, name, owner_id)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    type Row = {
      role: "owner" | "editor" | "viewer";
      workspaces: { id: string; name: string; owner_id: string };
    };
    const row = data as unknown as Row;
    return {
      id: row.workspaces.id,
      name: row.workspaces.name,
      ownerId: row.workspaces.owner_id,
      role: row.role,
    };
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
