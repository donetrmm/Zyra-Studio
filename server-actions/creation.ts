'use server';

import 'server-only';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { downloadReferenceBuffer } from '@/lib/supabase/storage';
import { clarifyCharacter } from '@/lib/creation/clarify';
import { analyzeProductBrief, type ProductBrief } from '@/lib/campaigns/brief';
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

// Brief auto-detectado del producto (modo product del wizard): el LLM VE la
// imagen subida y describe SOLO lo visible (analyzeProductBrief ya tiene prohibido
// inventar atributos/claims). Falla dura: el usuario lo pidió y espera respuesta.
export async function analyzeProductImageAction(mediaReferenceId: unknown): Promise<Result<ProductBrief>> {
  const parsed = z.string().uuid().safeParse(mediaReferenceId);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: ref } = await supabase
    .from('media_references')
    .select('storage_url, workspace_id, type')
    .eq('id', parsed.data)
    .single();
  if (!ref || ref.workspace_id !== workspace.id || ref.type !== 'image' || !ref.storage_url) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }
  try {
    const { buffer, mimeType } = await downloadReferenceBuffer(ref.storage_url as string);
    const brief = await analyzeProductBrief({ imageBuffer: buffer, mimeType });
    return { ok: true, data: brief };
  } catch (e) {
    return { ok: false, error: 'provider_error', message: (e as Error).message };
  }
}
