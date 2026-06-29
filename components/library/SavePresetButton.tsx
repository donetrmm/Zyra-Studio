'use client';

import { useState, useTransition } from 'react';
import { Bookmark, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { savePresetAction } from '@/server-actions/presets';
import { Switch } from '@/components/ui/switch';
import type { LibraryGeneration } from '@/lib/library/types';

export function SavePresetButton({ generation }: { generation: LibraryGeneration }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saving, startSave] = useTransition();

  function handleSave() {
    if (!name.trim()) return;
    startSave(async () => {
      const res = await savePresetAction({
        type: generation.type,
        name: name.trim(),
        description: description.trim() || undefined,
        params: {
          prompt: generation.prompt,
          model: generation.model,
          provider: generation.provider,
          aspectRatio: generation.aspectRatio,
          generationId: generation.id,
          thumbnailUrl: generation.thumbnailUrl,
        },
        isPublic,
      });
      if (!res.ok) { toast.error(res.message || 'Error al guardar'); return; }
      toast.success(isPublic ? 'Preset publicado' : 'Preset guardado');
      setOpen(false);
      setName('');
      setDescription('');
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-muted-foreground/30"
      >
        <Bookmark className="size-3.5" aria-hidden />
        Guardar como preset
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
      <p className="text-[12px] font-medium text-foreground">Guardar como preset</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre del preset"
        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Descripción (opcional)"
        className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-[11.5px] text-muted-foreground">
        <span>Hacer público (visible para la comunidad)</span>
        <Switch
          checked={isPublic}
          onCheckedChange={setIsPublic}
          size="sm"
          aria-label="Hacer público (visible para la comunidad)"
        />
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving && <Loader2 className="size-3 animate-spin" />}
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11.5px] text-muted-foreground hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
