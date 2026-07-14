"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

export async function toggleAdminAction(
  userId: string,
  newRole: 'admin' | 'user',
): Promise<{ ok: boolean; error?: string }> {
  const actingAdmin = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId);
  if (error) return { ok: false, error: error.message };
  // Toda acción admin queda en admin_audit_log (rule 70). Best-effort: el
  // cambio de rol ya se aplicó; un fallo del log no debe revertir la UX.
  await admin.from('admin_audit_log').insert({
    admin_id: actingAdmin.id,
    action: newRole === 'admin' ? 'grant_admin' : 'revoke_admin',
    target_user_id: userId,
  });
  revalidatePath('/admin/users');
  revalidatePath('/admin/audit');
  return { ok: true };
}

// Suspende o reactiva la cuenta de un usuario. El enforcement ya existe en el
// DAL (requireUser redirige y getApiAuthContext responde 'suspended' cuando
// profiles.status != 'active'); esta acción solo mueve la bandera.
export async function setUserStatusAction(
  userId: string,
  newStatus: 'active' | 'suspended',
): Promise<{ ok: boolean; error?: string }> {
  const actingAdmin = await requireAdmin();
  if (actingAdmin.id === userId) {
    return { ok: false, error: 'No puedes suspender tu propia cuenta' };
  }
  const admin = createAdminClient();
  // Los admins no se suspenden: primero quitar el rol (evita quedarse sin
  // panel por un click y deja rastro de dos acciones en el audit log).
  const { data: target } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!target) return { ok: false, error: 'Usuario no encontrado' };
  if (target.role === 'admin' && newStatus === 'suspended') {
    return { ok: false, error: 'Quita el rol admin antes de suspender' };
  }

  const { error } = await admin
    .from('profiles')
    .update({ status: newStatus })
    .eq('id', userId);
  if (error) return { ok: false, error: error.message };
  await admin.from('admin_audit_log').insert({
    admin_id: actingAdmin.id,
    action: newStatus === 'suspended' ? 'suspend_user' : 'reactivate_user',
    target_user_id: userId,
  });
  revalidatePath('/admin/users');
  revalidatePath('/admin/audit');
  return { ok: true };
}
