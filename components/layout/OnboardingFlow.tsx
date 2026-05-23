"use client";

import { useActionState, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AREA_OPTIONS, type Area } from "@/lib/schemas/onboarding";
import { completeOnboardingAction } from "@/server-actions/onboarding";

type Step = 1 | 2 | 3;

export function OnboardingFlow() {
  const [step, setStep] = useState<Step>(1);
  const [workspaceName, setWorkspaceName] = useState("");
  const [area, setArea] = useState<Area | "">("");
  const [state, action, pending] = useActionState(
    completeOnboardingAction,
    undefined,
  );
  const errors = state?.errors;

  const canNext1 = workspaceName.trim().length >= 2;
  const canNext2 = area !== "";

  return (
    <div className="space-y-8">
      <Stepper step={step} />

      {step === 1 ? (
        <section className="space-y-6">
          <header className="space-y-2 text-center">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              ¿Cómo se llama tu studio?
            </h1>
            <p className="text-sm text-muted-foreground">
              Es el nombre del workspace donde van a vivir tus campañas.
            </p>
          </header>
          <div className="space-y-2">
            <Label htmlFor="workspaceName">Nombre del workspace</Label>
            <Input
              id="workspaceName"
              autoFocus
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Mi studio creativo"
              maxLength={60}
            />
          </div>
          <Button
            className="w-full"
            disabled={!canNext1}
            onClick={() => setStep(2)}
          >
            Continuar
          </Button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-6">
          <header className="space-y-2 text-center">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              ¿A qué te dedicas?
            </h1>
            <p className="text-sm text-muted-foreground">
              Lo usamos para sugerirte plantillas y modelos relevantes.
            </p>
          </header>
          <div className="space-y-2">
            <Label htmlFor="area">Área</Label>
            <Select value={area} onValueChange={(v) => setArea(v as Area)}>
              <SelectTrigger id="area" className="w-full">
                <SelectValue placeholder="Selecciona un área" />
              </SelectTrigger>
              <SelectContent>
                {AREA_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
              Atrás
            </Button>
            <Button className="flex-1" disabled={!canNext2} onClick={() => setStep(3)}>
              Continuar
            </Button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-6">
          <header className="space-y-2 text-center">
            <Sparkles className="mx-auto size-8 text-primary" aria-hidden />
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              500 créditos por la casa
            </h1>
            <p className="text-sm text-muted-foreground">
              Suficiente para varias imágenes en Nano Banana, una corrida de
              video Kling Turbo o un buen rato de voz con ElevenLabs Flash.
            </p>
          </header>
          <form action={action} className="space-y-4">
            <input type="hidden" name="workspaceName" value={workspaceName} />
            <input type="hidden" name="area" value={area} />
            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="text-muted-foreground">Workspace</p>
              <p className="font-medium">{workspaceName}</p>
              <p className="mt-3 text-muted-foreground">Área</p>
              <p className="font-medium">
                {AREA_OPTIONS.find((o) => o.value === area)?.label ?? "—"}
              </p>
            </div>
            {errors?.form ? (
              <p className="text-sm text-destructive">{errors.form[0]}</p>
            ) : null}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setStep(2)}
                disabled={pending}
              >
                Atrás
              </Button>
              <Button type="submit" className="flex-1" disabled={pending}>
                {pending ? "Creando…" : "Empezar"}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const items = [1, 2, 3] as const;
  return (
    <ol className="flex items-center justify-center gap-3" aria-label="Pasos">
      {items.map((n) => {
        const done = step > n;
        const active = step === n;
        return (
          <li key={n} className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "border-border text-muted-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : n}
            </span>
            {n < items.length ? (
              <span
                className={cn(
                  "h-px w-8 transition-colors",
                  step > n ? "bg-primary" : "bg-border",
                )}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
