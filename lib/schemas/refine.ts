import { z } from 'zod';
import { ChatTurnSchema, RefineDraftSchema } from '@/lib/refine/types';

export const RefineTurnInputSchema = z.object({
  campaignId: z.string().uuid(),
  itemId: z.string().uuid().nullable(), // null = creativo nuevo
  history: z.array(ChatTurnSchema).max(21), // ≤10 turnos de usuario + respuestas
  draft: RefineDraftSchema,
  stage: z.enum(['what', 'shot', 'refs', 'review']), // etapa actual del cliente: el clamp evita retroceder
  userMessage: z.string().trim().min(1).max(2000),
});

export const AcceptRefineInputSchema = z.object({
  campaignId: z.string().uuid(),
  itemId: z.string().uuid().nullable(),
  draft: RefineDraftSchema,
  acceptedWarnings: z.array(z.string().max(300)).max(12),
});
