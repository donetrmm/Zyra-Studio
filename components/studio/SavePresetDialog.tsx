'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { savePresetAction } from '@/server-actions/presets';

// Guarda el prompt de un resultado como preset de imagen (tabla presets, type
// 'image'). El diálogo deja AJUSTAR el prompt antes de guardar y ponerle nombre;
// luego aparece en el dropdown "Guardados" del compositor (el padre refresca el
// RSC para recargarlos). El padre lo remonta por key para arrancar limpio con el
// prompt del resultado elegido.
export function SavePresetDialog(props: {
  open: boolean;
  initialPrompt: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState(props.initialPrompt);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName) {
      toast.error('Ponle un nombre al preset');
      return;
    }
    if (!trimmedPrompt) {
      toast.error('El prompt no puede estar vacío');
      return;
    }
    setSaving(true);
    const res = await savePresetAction({
      type: 'image',
      name: trimmedName,
      params: { prompt: trimmedPrompt },
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo guardar el preset');
      return;
    }
    toast.success('Preset guardado');
    props.onSaved();
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Guardar como preset</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="preset-name">
              Nombre
            </label>
            <Input
              id="preset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Producto luz suave"
              maxLength={100}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="preset-prompt">
              Prompt
            </label>
            <Textarea
              id="preset-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              className="scroll-thin max-h-[40vh] text-sm"
            />
            <p className="text-2xs text-muted-foreground">
              Ajústalo si quieres. Se guarda solo el prompt; lo aplicas desde el selector Presets.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar preset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
