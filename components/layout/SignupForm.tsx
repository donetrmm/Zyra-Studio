"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signupAction } from "@/server-actions/auth";

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, undefined);
  const errors = state?.errors;

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Nombre completo</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          aria-invalid={errors?.fullName ? true : undefined}
        />
        {errors?.fullName ? (
          <p className="text-sm text-destructive">{errors.fullName[0]}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={errors?.email ? true : undefined}
        />
        {errors?.email ? (
          <p className="text-sm text-destructive">{errors.email[0]}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={errors?.password ? true : undefined}
        />
        {errors?.password ? (
          <p className="text-sm text-destructive">{errors.password[0]}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
        )}
      </div>
      {errors?.form ? (
        <p className="text-sm text-destructive">{errors.form[0]}</p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creando cuenta…" : "Crear cuenta"}
      </Button>
    </form>
  );
}
