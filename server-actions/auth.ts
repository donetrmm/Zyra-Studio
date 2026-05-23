"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  LoginSchema,
  SignupSchema,
  type AuthFormState,
} from "@/lib/schemas/auth";

function getOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "http://localhost:3000";
}

export async function loginAction(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { errors: z4FlattenFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { errors: { form: ["Credenciales inválidas"] } };
  }

  redirect("/app");
}

export async function signupAction(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = SignupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
  });

  if (!parsed.success) {
    return { errors: z4FlattenFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${getOrigin()}/auth/callback`,
    },
  });

  if (error) {
    return { errors: { form: [error.message] } };
  }

  // El trigger handle_new_user crea profile + balance. Si hay confirmación
  // de email activada en Supabase, el user llega a /login a confirmar primero.
  redirect("/onboarding");
}

export async function signInWithGoogleAction(): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${getOrigin()}/auth/callback`,
    },
  });

  if (error || !data.url) {
    throw new Error("No se pudo iniciar Google OAuth");
  }

  redirect(data.url);
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // headers() está aquí solo para forzar a Next a tratar esta acción como
  // dinámica y no cachear nada del estado de auth posterior al logout.
  await headers();
  redirect("/login");
}

// zod 4 cambió la forma de leer errores: `.flatten()` ya no existe igual.
// Lo expandimos manualmente para mantener el shape que useActionState consume.
function z4FlattenFieldErrors(
  err: import("zod").ZodError,
): NonNullable<AuthFormState["errors"]> {
  const out: NonNullable<AuthFormState["errors"]> = {};
  for (const issue of err.issues) {
    const path = issue.path[0];
    if (typeof path !== "string") continue;
    if (!["email", "password", "fullName", "form"].includes(path)) continue;
    const key = path as keyof NonNullable<AuthFormState["errors"]>;
    out[key] = [...(out[key] ?? []), issue.message];
  }
  return out;
}
