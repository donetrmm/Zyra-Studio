'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createVariantAction } from '@/server-actions/campaigns';
import { insufficientCreditsToast } from '../../credits-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { StudioItem, StudioCharacterOption } from '../types';

type VariantMode = 'extend' | 'replace_character' | 'change_action' | 'bridge';

export function VariantDialog({
  item,
  characterOptions,
  bridgeOptions,
  onClose,
}: {
  item: StudioItem;
  characterOptions: StudioCharacterOption[];
  // Otros finales de la campaña: destinos posibles de la escena puente.
  bridgeOptions: StudioItem[];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<VariantMode>('extend');
  const [extendSeconds, setExtendSeconds] = useState(5);
  const [continuation, setContinuation] = useState('');
  const [characterId, setCharacterId] = useState(characterOptions[0]?.id ?? '');
  const [newAction, setNewAction] = useState('');
  const [targetId, setTargetId] = useState(bridgeOptions[0]?.generationId ?? '');
  const [bridgeSeconds, setBridgeSeconds] = useState(5);
  const [saving, setSaving] = useState(false);

  const canSubmit =
    mode === 'extend'
      ? true
      : mode === 'replace_character'
        ? characterId.length > 0
        : mode === 'change_action'
          ? newAction.trim().length > 0
          : targetId.length > 0;

  async function handleCreate() {
    if (!item.generationId) return;
    setSaving(true);
    const res = await createVariantAction({
      generationId: item.generationId,
      mode,
      ...(mode === 'extend'
        ? { extendSeconds, continuation: continuation.trim() || undefined }
        : mode === 'replace_character'
          ? { characterId }
          : mode === 'change_action'
            ? { newAction: newAction.trim() }
            : { targetGenerationId: targetId, bridgeSeconds }),
    });
    setSaving(false);
    if (!res.ok) {
      if (res.error === 'insufficient_credits') insufficientCreditsToast();
      else toast.error(res.message ?? 'No se pudo encolar la variante');
      return;
    }
    toast.success('Variante en cola — aparecerá en la biblioteca de la campaña');
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Variante dirigida</DialogTitle>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label="Tipo de variante"
          className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-0.5"
        >
          {(
            [
              { value: 'extend', label: 'Extender clip' },
              { value: 'replace_character', label: 'Cambiar personaje' },
              { value: 'change_action', label: 'Cambiar acción' },
              { value: 'bridge', label: 'Escena puente' },
            ] as const
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => setMode(m.value)}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                mode === m.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'extend' ? (
          <div className="mt-4 space-y-3">
            <div>
              <span className="text-xs font-medium text-foreground/80">Segundos a extender</span>
              <div className="mt-1.5 flex gap-2">
                {[4, 5, 6, 8].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setExtendSeconds(s)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      extendSeconds === s
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    +{s}s
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="variant-cont" className="text-xs font-medium text-foreground/80">
                Qué pasa en la continuación (opcional)
              </label>
              <textarea
                id="variant-cont"
                value={continuation}
                onChange={(e) => setContinuation(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="She sets the can down and looks back to camera with a smile"
                className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
          </div>
        ) : mode === 'replace_character' ? (
          <div className="mt-4">
            <label htmlFor="variant-char" className="text-xs font-medium text-foreground/80">
              Nuevo personaje (acciones, escena y cámara se conservan)
            </label>
            {characterOptions.length === 0 ? (
              <p className="mt-1.5 text-xs text-amber-400/80">No hay personajes en el Cast.</p>
            ) : (
              <select
                id="variant-char"
                value={characterId}
                onChange={(e) => setCharacterId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {characterOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : mode === 'change_action' ? (
          <div className="mt-4">
            <label htmlFor="variant-action" className="text-xs font-medium text-foreground/80">
              Nueva acción o desenlace (sujeto, escena y cámara se conservan)
            </label>
            <textarea
              id="variant-action"
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="She opens the can, takes a sip and raises it toward the camera"
              className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="variant-bridge" className="text-xs font-medium text-foreground/80">
                Clip destino (el puente conecta el final de este clip con su inicio)
              </label>
              {bridgeOptions.length === 0 ? (
                <p className="mt-1.5 text-xs text-amber-400/80">
                  Necesitas otro final terminado en la campaña para conectar.
                </p>
              ) : (
                <select
                  id="variant-bridge"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {bridgeOptions.map((b) => (
                    <option key={b.id} value={b.generationId ?? ''}>
                      {b.formatName} · {(b.sceneSummary ?? b.scenePrompt).slice(0, 60)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <span className="text-xs font-medium text-foreground/80">Duración del puente</span>
              <div className="mt-1.5 flex gap-2">
                {[4, 5, 6, 8].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBridgeSeconds(s)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      bridgeSeconds === s
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={saving || !canSubmit}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Encolar variante
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
