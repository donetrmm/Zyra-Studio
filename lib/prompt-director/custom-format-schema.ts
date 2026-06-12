// lib/prompt-director/custom-format-schema.ts
// Schema compartido cliente/servidor del formato custom (specs/v2/07).
// Separado de format-matcher.ts porque ese módulo es server-only.
import { z } from 'zod';

export const CustomFormatSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  register: z.string().max(200),
  cameraStyle: z.string().max(200),
  pacing: z.string().max(120),
  requiredRefs: z.array(z.enum(['product', 'character', 'packaging'])).max(3),
  defaultDurationS: z.number().int().min(4).max(15),
  defaultAudio: z.boolean(),
});
export type CustomFormat = z.infer<typeof CustomFormatSchema>;
