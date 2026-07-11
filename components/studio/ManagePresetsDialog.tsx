'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { deletePresetAction, updatePresetAction } from '@/server-actions/presets';
import type { StudioPreset } from '@/lib/studio/presets';

// Gestión de los presets guardados del usuario (tabla presets, type 'image'):
// editar nombre + prompt, o eliminar. La lista viene por prop (los userPresets
// que ya carga el RSC); tras un cambio, onChanged() hace router.refresh() para
// recargarlos, así el diálogo abierto y el dropdown del compositor se sincronizan.
export function ManagePresetsDialog(props: {
  open: boolean;
  presets: StudioPreset[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  function startEdit(p: StudioPreset) {
    setEditingId(p.id);
    setName(p.label);
    setPrompt(p.prompt);
  }

  async function saveEdit(id: string) {
    const n = name.trim();
    const pr = prompt.trim();
    if (!n) {
      toast.error('Ponle un nombre');
      return;
    }
    if (!pr) {
      toast.error('El prompt no puede estar vacío');
      return;
    }
    setBusyId(id);
    const res = await updatePresetAction({ id, name: n, prompt: pr });
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo actualizar');
      return;
    }
    toast.success('Preset actualizado');
    setEditingId(null);
    props.onChanged();
  }

  async function remove(p: StudioPreset) {
    const ok = await confirm({
      title: `¿Eliminar "${p.label}"?`,
      description: 'El preset se eliminará permanentemente.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    setBusyId(p.id);
    const res = await deletePresetAction(p.id);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo eliminar');
      return;
    }
    toast.success('Preset eliminado');
    if (editingId === p.id) setEditingId(null);
    props.onChanged();
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mis presets</DialogTitle>
        </DialogHeader>
        {props.presets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No tienes presets guardados. Guarda uno desde una imagen del chat con el botón de marcador.
          </p>
        ) : (
          <ul className="scroll-thin max-h-[60vh] space-y-2 overflow-y-auto">
            {props.presets.map((p) => (
              <li key={p.id} className="rounded-lg border border-border p-3">
                {editingId === p.id ? (
                  <div className="space-y-2">
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={100}
                      placeholder="Nombre"
                    />
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={4}
                      className="scroll-thin max-h-[30vh] text-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(null)}
                        disabled={busyId === p.id}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => saveEdit(p.id)}
                        disabled={busyId === p.id}
                        className="gap-1.5"
                      >
                        {busyId === p.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Guardar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-2sm font-medium text-foreground">{p.label}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.prompt}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => startEdit(p)}
                        title="Editar preset"
                        aria-label="Editar preset"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(p)}
                        disabled={busyId === p.id}
                        title="Eliminar preset"
                        aria-label="Eliminar preset"
                      >
                        {busyId === p.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
