'use server';

import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export async function toggleFavoriteAction(generationId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: existing, error: selectError } = await supabase
    .from('favorites')
    .select('generation_id')
    .eq('user_id', user.id)
    .eq('generation_id', generationId)
    .maybeSingle();

  if (selectError) {
    console.error('[toggleFavorite] SELECT error:', selectError.message, selectError.code);
    return { ok: false as const, message: selectError.message, favorited: false };
  }

  if (existing) {
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('generation_id', generationId);
    if (error) {
      console.error('[toggleFavorite] DELETE error:', error.message, error.code);
      return { ok: false as const, message: error.message, favorited: true };
    }
    return { ok: true as const, favorited: false };
  }

  const { error } = await supabase
    .from('favorites')
    .insert({ user_id: user.id, generation_id: generationId });
  if (error) {
    console.error('[toggleFavorite] INSERT error:', error.message, error.code);
    return { ok: false as const, message: error.message, favorited: false };
  }
  return { ok: true as const, favorited: true };
}

export async function listFavoriteIdsAction(): Promise<{ ok: true; ids: string[] } | { ok: false }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('favorites')
    .select('generation_id')
    .eq('user_id', user.id);

  if (error) return { ok: false };
  return { ok: true, ids: (data ?? []).map((r) => r.generation_id) };
}
