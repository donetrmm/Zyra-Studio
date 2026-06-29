'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { distillTemplateAction } from '@/server-actions/campaigns';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { StudioItem } from '../types';

export function DistillDialog({ item, onClose }: { item: StudioItem; onClose: () => void }) {
  const [name, setName] = useState(`${item.formatName} ganador`);
  const [saving, setSaving] = useState(false);

  async function handleDistill() {
    if (!item.generationId) return;
    setSaving(true);
    const res = await distillTemplateAction({ generationId: item.generationId, name: name.trim() });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo crear la plantilla');
      return;
    }
    toast.success('Plantilla creada — está en la pestaña Plantillas');
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convertir en plantilla</DialogTitle>
          <DialogDescription>
            La estructura, cámara, ritmo y estilo de este video quedan fijos; producto, escena y
            personaje serán rotables al generar series.
          </DialogDescription>
        </DialogHeader>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Nombre de la plantilla"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleDistill}
            disabled={saving || name.trim().length === 0}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Crear plantilla
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
