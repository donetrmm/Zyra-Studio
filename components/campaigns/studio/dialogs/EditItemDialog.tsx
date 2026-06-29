'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { updateCampaignItemAction } from '@/server-actions/campaigns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { StudioItem, StudioCharacterOption } from '../types';

export function EditItemDialog({
  item,
  characterOptions,
  onClose,
  onSaved,
}: {
  item: StudioItem;
  characterOptions: StudioCharacterOption[];
  onClose: () => void;
  onSaved: (patch: Partial<StudioItem>) => void;
}) {
  const [scenePrompt, setScenePrompt] = useState(item.scenePrompt);
  const [scene, setScene] = useState(item.scene ?? '');
  const [characterId, setCharacterId] = useState(
    characterOptions.find((c) => c.name === (item.characterNames[0] ?? null))?.id ?? '',
  );
  const [caption, setCaption] = useState(item.caption ?? '');
  const [scheduledDate, setScheduledDate] = useState(item.scheduledDate ?? '');
  const [characterStateHint, setCharacterStateHint] = useState<string | null>(item.characterStateHint);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await updateCampaignItemAction({
      itemId: item.id,
      // Solo si cambió: enviarlo siempre anularía el resumen display (033)
      // que la action invalida con cada edición del prompt.
      ...(scenePrompt !== item.scenePrompt ? { scenePrompt } : {}),
      scene: scene.trim() || undefined,
      ...(characterId ? { characterId } : {}),
      ...(characterStateHint !== item.characterStateHint ? { characterStateHint } : {}),
      caption,
      ...(scheduledDate ? { scheduledDate: new Date(`${scheduledDate}T12:00:00`) } : {}),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo guardar');
      return;
    }
    onSaved({
      scenePrompt,
      // El resumen describía el prompt anterior: la action lo anula al editar.
      ...(scenePrompt !== item.scenePrompt ? { sceneSummary: null } : {}),
      scene: scene.trim() || item.scene,
      characterNames: characterId
        ? (() => {
            const name = characterOptions.find((c) => c.id === characterId)?.name;
            if (!name) return item.characterNames;
            const rest = item.characterNames.slice(1).filter((n) => n !== name);
            return [name, ...rest];
          })()
        : item.characterNames,
      caption: caption || null,
      scheduledDate: scheduledDate || item.scheduledDate,
      characterStateHint,
      // Estado autoritativo del server: 'planned' si se tocó producción, o el
      // estado real conservado para ediciones de solo caption/fecha.
      status: res.data.status,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar creativo · {item.formatName}</DialogTitle>
        </DialogHeader>

        <label htmlFor="edit-prompt" className="block text-xs font-medium text-foreground/80">
          Acción de la escena
        </label>
        <textarea
          id="edit-prompt"
          value={scenePrompt}
          onChange={(e) => setScenePrompt(e.target.value)}
          rows={4}
          maxLength={4000}
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-scene" className="block text-xs font-medium text-foreground/80">
              Escena (fragmento de contexto)
            </label>
            <input
              id="edit-scene"
              value={scene}
              onChange={(e) => setScene(e.target.value)}
              maxLength={200}
              placeholder="a sunlit home kitchen"
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label htmlFor="edit-character" className="block text-xs font-medium text-foreground/80">
              Personaje
            </label>
            <select
              id="edit-character"
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">Sin cambio / sin personaje</option>
              {characterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {(() => {
            const states = characterOptions.find((c) => c.id === characterId)?.states ?? [];
            if (states.length === 0) return null;
            return (
              <div>
                <label htmlFor="edit-state" className="block text-xs font-medium text-foreground/80">
                  Estado del personaje
                </label>
                <select
                  id="edit-state"
                  value={characterStateHint ?? ''}
                  onChange={(e) => setCharacterStateHint(e.target.value || null)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">Ninguno (neutral)</option>
                  {states.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}
        </div>

        <label htmlFor="edit-caption" className="mt-3 block text-xs font-medium text-foreground/80">
          Caption de publicación
        </label>
        <textarea
          id="edit-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={2}
          maxLength={2200}
          placeholder="Texto que acompaña al post; va al export, nunca dentro del video"
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <label htmlFor="edit-date" className="mt-3 block text-xs font-medium text-foreground/80">
          Fecha programada
        </label>
        <input
          id="edit-date"
          type="date"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
          className="mt-1.5 rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || scenePrompt.trim().length === 0}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
