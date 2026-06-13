import { z } from 'zod';

export type CreationKind = 'character' | 'product';

// Entrada de la aclaración (solo modo character; product no pasa por aquí).
export const ClarifyInputSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  hasReference: z.boolean().default(false),
});
export type ClarifyInput = z.infer<typeof ClarifyInputSchema>;

// Una pregunta de aclaración con chips sugeridos.
const QuestionSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().trim().min(1).max(200),
  suggestions: z.array(z.string().trim().min(1).max(60)).max(6).catch([]).default([]),
});

// Salida estructurada de Gemini Flash. Saneo laxo: el LLM es estocástico, así
// que una pregunta malformada se descarta sin tirar el resultado; máx 3.
export const ClarifyResultSchema = z.object({
  questions: z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((arr) =>
      arr
        .flatMap((q) => {
          const parsed = QuestionSchema.safeParse(q);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, 3),
    ),
  enrichedPrompt: z.string().trim().min(1).max(1500),
});
export type ClarifyResult = z.infer<typeof ClarifyResultSchema>;
