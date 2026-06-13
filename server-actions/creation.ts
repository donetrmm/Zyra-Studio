'use server';

import 'server-only';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { clarifyCharacter } from '@/lib/creation/clarify';
import { stripAgeWords } from '@/lib/prompt-director/inventory';
import { ClarifyInputSchema, type ClarifyResult } from '@/lib/schemas/creation';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

export async function clarifyCreationAction(input: unknown): Promise<Result<ClarifyResult>> {
  const parsed = ClarifyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  await requireWorkspace();
  try {
    return { ok: true, data: await clarifyCharacter(parsed.data) };
  } catch {
    // Falla blanda: generar best-effort con el texto crudo (saneado age-blind).
    const { text } = stripAgeWords(parsed.data.text);
    return { ok: true, data: { questions: [], enrichedPrompt: text.trim() || parsed.data.text } };
  }
}

// Resuelve el storagePath de imágenes ya guardadas (validando ownership) para
// que el wizard pueda EDITARLAS con Nano Banana (necesita {id, storagePath}).
// Lo usa el flujo "Mejorar con IA" del Brand Kit, que lee las imágenes del kit.
export async function getReferencePathsAction(ids: unknown): Promise<Result<Record<string, string>>> {
  const parsed = z.array(z.string().uuid()).max(8).safeParse(ids);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  if (parsed.data.length === 0) return { ok: true, data: {} };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data } = await supabase
    .from('media_references')
    .select('id, storage_url, workspace_id')
    .in('id', parsed.data);
  const out: Record<string, string> = {};
  for (const r of data ?? []) {
    if (r.workspace_id === workspace.id && r.storage_url) out[r.id as string] = r.storage_url as string;
  }
  return { ok: true, data: out };
}
