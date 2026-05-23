import { z } from "zod";

export const AdjustCreditsSchema = z.object({
  userId: z.uuid({ error: "Usuario inválido" }),
  delta: z.coerce
    .number({ error: "El ajuste es obligatorio" })
    .int({ error: "Solo enteros" })
    .refine((v) => v !== 0, { error: "El ajuste no puede ser cero" }),
  reason: z
    .string()
    .trim()
    .min(3, { error: "La razón debe tener al menos 3 caracteres" })
    .max(280, { error: "Máximo 280 caracteres" }),
});

export type AdjustCreditsInput = z.infer<typeof AdjustCreditsSchema>;

export type AdjustCreditsFormState = {
  errors?: Partial<Record<"delta" | "reason" | "form", string[]>>;
  ok?: boolean;
};
