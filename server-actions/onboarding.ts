"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  OnboardingSchema,
  type OnboardingFormState,
} from "@/lib/schemas/onboarding";

export async function completeOnboardingAction(
  _prev: OnboardingFormState | undefined,
  formData: FormData,
): Promise<OnboardingFormState> {
  const parsed = OnboardingSchema.safeParse({
    workspaceName: formData.get("workspaceName"),
    area: formData.get("area"),
  });

  if (!parsed.success) {
    const errors: NonNullable<OnboardingFormState["errors"]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "workspaceName" || key === "area") {
        errors[key] = [...(errors[key] ?? []), issue.message];
      }
    }
    return { errors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { errors: { form: ["Sesión expirada"] } };
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ area: parsed.data.area })
    .eq("id", user.id);
  if (profileError) {
    return { errors: { form: ["No pudimos guardar tu perfil. Reintenta."] } };
  }

  const { error: wsError } = await supabase
    .from("workspaces")
    .insert({ name: parsed.data.workspaceName, owner_id: user.id });
  // El trigger handle_new_workspace inserta al owner como miembro.
  if (wsError) {
    return { errors: { form: ["No pudimos crear tu workspace. Reintenta."] } };
  }

  redirect("/app");
}
