'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trophy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { setCampaignStatusAction, updateCampaignStudioAction } from '@/server-actions/campaigns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GOAL_LABEL, type StudioCampaign } from '../types';

export function CampaignSettingsDialog({
  campaign,
  onClose,
}: {
  campaign: StudioCampaign;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [goal, setGoal] = useState(campaign.goal ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await updateCampaignStudioAction({
      id: campaign.id,
      name: name.trim(),
      goal: goal ? (goal as 'awareness' | 'conversion' | 'mixed') : null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo guardar');
      return;
    }
    toast.success('Campaña actualizada');
    router.refresh();
    onClose();
  }

  async function handleStatus(status: 'delivered' | 'archived') {
    setSaving(true);
    const res = await setCampaignStatusAction({ id: campaign.id, status });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo actualizar el estado');
      return;
    }
    if (status === 'archived') {
      toast.success('Campaña archivada');
      router.push('/app/campaigns');
    } else {
      toast.success('Campaña marcada como entregada');
      router.refresh();
      onClose();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustes de la campaña</DialogTitle>
        </DialogHeader>

        <label htmlFor="campaign-name" className="block text-xs font-medium text-foreground/80">
          Nombre
        </label>
        <input
          id="campaign-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <label htmlFor="campaign-goal" className="mt-3 block text-xs font-medium text-foreground/80">
          Objetivo
        </label>
        <select
          id="campaign-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {Object.entries(GOAL_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || name.trim().length === 0}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Guardar
          </Button>
        </div>

        <div className="mt-4 space-y-2 border-t border-border/60 pt-4">
          <p className="text-2xs text-muted-foreground">Estado de la campaña</p>
          <div className="flex flex-wrap gap-2">
            {campaign.status !== 'delivered' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => handleStatus('delivered')}
                className="border-brand/40 text-brand hover:bg-brand/10"
              >
                <Trophy className="size-3.5" aria-hidden />
                Marcar como entregada
              </Button>
            )}
            {confirmArchive ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => handleStatus('archived')}
                className="border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/15"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}
                Confirmar archivar
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => setConfirmArchive(true)}
                className="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Archivar campaña
              </Button>
            )}
          </div>
          <p className="text-2xs text-muted-foreground">
            Archivar la saca de la lista de campañas y del dashboard. Sus creativos generados se conservan.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
