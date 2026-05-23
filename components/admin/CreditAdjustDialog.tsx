"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adjustCreditsAction } from "@/server-actions/admin";

type Props = {
  userId: string;
  email: string;
  currentBalance: number;
};

export function CreditAdjustDialog({ userId, email, currentBalance }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(adjustCreditsAction, undefined);
  const errors = state?.errors;

  useEffect(() => {
    if (state?.ok) {
      toast.success(`Balance de ${email} actualizado`);
      setOpen(false);
    }
  }, [state?.ok, email]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Ajustar créditos
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar créditos</DialogTitle>
          <DialogDescription>
            {email} · balance actual{" "}
            <span className="font-medium text-foreground">
              {new Intl.NumberFormat("es-MX").format(currentBalance)}
            </span>
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="userId" value={userId} />
          <div className="space-y-2">
            <Label htmlFor={`delta-${userId}`}>Ajuste (± entero)</Label>
            <Input
              id={`delta-${userId}`}
              name="delta"
              type="number"
              step={1}
              placeholder="1000"
              required
              aria-invalid={errors?.delta ? true : undefined}
            />
            {errors?.delta ? (
              <p className="text-sm text-destructive">{errors.delta[0]}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Negativo para débito. Bloqueado si dejaría el balance &lt; 0.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`reason-${userId}`}>Razón</Label>
            <Textarea
              id={`reason-${userId}`}
              name="reason"
              rows={3}
              required
              minLength={3}
              maxLength={280}
              placeholder="Compensación por bug, bono manual, etc."
              aria-invalid={errors?.reason ? true : undefined}
            />
            {errors?.reason ? (
              <p className="text-sm text-destructive">{errors.reason[0]}</p>
            ) : null}
          </div>
          {errors?.form ? (
            <p className="text-sm text-destructive">{errors.form[0]}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Aplicando…" : "Aplicar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
