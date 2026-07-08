// lib/refine/gemini.ts
// Turno de conversación contra Gemini Flash vía Vercel AI Gateway. Una llamada
// por turno, segundos de latencia → server action directa, sin cola.
import 'server-only';
import { ProviderError } from '@/lib/providers/types';
import { gatewayText } from '@/lib/providers/gateway';
import { TurnReplySchema, type ChatTurn, type TurnReply } from './types';

const MODEL = 'gemini-2.5-flash';

export async function requestRefineTurn(input: {
  system: string;
  history: ChatTurn[];
}): Promise<TurnReply> {
  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'refine',
    system: input.system,
    contents: input.history.map((t) => ({
      role: t.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: t.text }],
    })),
    temperature: 0.4,
    maxOutputTokens: 1200,
    json: true,
  });
  let json: unknown;
  try { json = JSON.parse(raw); } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en refine', 'unknown', false);
  }
  const parsed = TurnReplySchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(`Turno no cumple el contrato: ${parsed.error.message.slice(0, 200)}`, 'unknown', false);
  }
  return parsed.data;
}
