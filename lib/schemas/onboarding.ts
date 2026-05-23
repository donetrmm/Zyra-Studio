import { z } from "zod";

export const AREA_OPTIONS = [
  { value: "marketing", label: "Marketing" },
  { value: "agencia", label: "Agencia" },
  { value: "freelance", label: "Freelance" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "startup", label: "Startup" },
  { value: "saas", label: "Empresa SaaS" },
  { value: "otro", label: "Otro" },
] as const;

export type Area = (typeof AREA_OPTIONS)[number]["value"];

export const OnboardingSchema = z.object({
  workspaceName: z
    .string()
    .trim()
    .min(2, { error: "El nombre debe tener al menos 2 caracteres" })
    .max(60, { error: "Máximo 60 caracteres" }),
  area: z.enum(
    AREA_OPTIONS.map((o) => o.value) as [Area, ...Area[]],
    { error: "Selecciona un área" },
  ),
});

export type OnboardingInput = z.infer<typeof OnboardingSchema>;

export type OnboardingFormState = {
  errors?: Partial<Record<"workspaceName" | "area" | "form", string[]>>;
};
