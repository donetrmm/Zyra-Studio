import { z } from "zod";

export const LoginSchema = z.object({
  email: z.email({ error: "Email inválido" }).trim().toLowerCase(),
  password: z
    .string({ error: "La contraseña es obligatoria" })
    .min(8, { error: "Mínimo 8 caracteres" }),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const SignupSchema = z.object({
  email: z.email({ error: "Email inválido" }).trim().toLowerCase(),
  password: z
    .string({ error: "La contraseña es obligatoria" })
    .min(8, { error: "Mínimo 8 caracteres" }),
  fullName: z
    .string()
    .trim()
    .min(2, { error: "El nombre debe tener al menos 2 caracteres" })
    .max(80, { error: "Demasiado largo" }),
});

export type SignupInput = z.infer<typeof SignupSchema>;

// Estado retornado por los Server Actions de auth para usar con useActionState.
export type AuthFormState = {
  errors?: Partial<Record<"email" | "password" | "fullName" | "form", string[]>>;
};
