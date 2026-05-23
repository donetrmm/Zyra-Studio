"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/dal";
import {
  AdjustCreditsSchema,
  type AdjustCreditsFormState,
} from "@/lib/schemas/admin";

export async function adjustCreditsAction(
  _prev: AdjustCreditsFormState | undefined,
  formData: FormData,
): Promise<AdjustCreditsFormState> {
  // Double-check role: server actions son public-facing.
  await requireAdmin();

  const parsed = AdjustCreditsSchema.safeParse({
    userId: formData.get("userId"),
    delta: formData.get("delta"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    const errors: NonNullable<AdjustCreditsFormState["errors"]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "delta" || key === "reason") {
        errors[key] = [...(errors[key] ?? []), issue.message];
      } else {
        errors.form = [...(errors.form ?? []), issue.message];
      }
    }
    return { errors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_grant_credits", {
    p_user_id: parsed.data.userId,
    p_delta: parsed.data.delta,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { errors: { form: [error.message] } };
  }

  revalidatePath("/admin/users");
  revalidatePath("/admin/audit");
  return { ok: true };
}
