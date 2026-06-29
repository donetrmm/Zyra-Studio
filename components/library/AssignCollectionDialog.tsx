'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { CAMPAIGN_NONE } from '@/lib/library/format';
import { listCampaignsAction } from '@/server-actions/campaigns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Asigna en lote las generaciones seleccionadas a una colección-carpeta
// (las editables, vía listCampaignsAction). Las campañas studio no son destino
// de asignación manual: reciben sus creativos por el pipeline.
export function AssignCollectionDialog({
  count,
  onAssign,
  onClose,
}: {
  count: number;
  onAssign: (campaignId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [collections, setCollections] = useState<{ id: string; name: string; color: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<string>(CAMPAIGN_NONE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listCampaignsAction().then((res) => {
      if (res.ok) setCollections(res.data);
      setLoaded(true);
    });
  }, []);

  async function handleAssign() {
    setSaving(true);
    await onAssign(target === CAMPAIGN_NONE ? null : target);
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Asignar a colección</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] text-muted-foreground">
          {count} {count === 1 ? 'generación' : 'generaciones'} seleccionada{count === 1 ? '' : 's'}.
        </p>
        {loaded && collections.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-[12.5px] text-muted-foreground">
            Aún no tienes colecciones. Créalas en la pestaña Colecciones.
          </p>
        ) : (
          <Select value={target} onValueChange={setTarget} disabled={!loaded || saving}>
            <SelectTrigger className="w-full rounded-lg border-border bg-background px-3 py-2 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CAMPAIGN_NONE}>Sin colección (quitar)</SelectItem>
              {collections.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={saving || !loaded}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Asignar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
