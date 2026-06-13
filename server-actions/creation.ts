'use server';

import 'server-only';
import { requireWorkspace } from '@/lib/auth/dal';
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
