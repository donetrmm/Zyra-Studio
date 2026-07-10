'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Box, Package, Image as ImageIcon, Map, User, PersonStanding } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { attachStudioImageAction } from '@/server-actions/studio';
import type { StudioAssetImages, StudioRefOption, StudioAssetType } from './types';

type RoleDef = { key: string; label: string; icon: React.ComponentType<{ className?: string }> };

const ROLES_BY_TYPE: Record<StudioAssetType, RoleDef[]> = {
  product: [
    { key: 'product', label: 'Imagen de producto', icon: Box },
    { key: 'packaging', label: 'Empaque', icon: Package },
  ],
  location: [
    { key: 'master', label: 'Maestra', icon: ImageIcon },
    { key: 'reference', label: 'Referencia', icon: ImageIcon },
    { key: 'scale_map', label: 'Mapa de escala', icon: Map },
  ],
  character: [
    { key: 'master', label: 'Maestra', icon: User },
    { key: 'angle', label: 'Ángulo', icon: ImageIcon },
    { key: 'full_body', label: 'Cuerpo completo', icon: PersonStanding },
  ],
};

export function AttachDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generationId: string | null;
  assetId: string;
  assetType: StudioAssetType;
  onAttached: (next: StudioAssetImages, newRef: StudioRefOption) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const roles = ROLES_BY_TYPE[props.assetType];

  async function attach(roleKey: string, roleLabel: string) {
    if (!props.generationId || saving) return;
    setSaving(roleKey);
    const ref = await addGenerationAsReferenceAction({ generationId: props.generationId });
    if (!ref.ok) {
      setSaving(null);
      toast.error('No se pudo preparar la imagen');
      return;
    }
    // Read-modify-write server-side: attachStudioImageAction relee el activo
    // fresco de la BD antes de fusionar, así un cambio externo (otra pestaña,
    // editor inline) no se revierte por un upsert con snapshot viejo.
    const res = await attachStudioImageAction({
      assetType: props.assetType,
      assetId: props.assetId,
      role: roleKey,
      referenceId: ref.data.id,
    });
    setSaving(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo guardar');
      return;
    }
    props.onAttached(res.data.assetImages, {
      id: ref.data.id,
      previewUrl: ref.data.previewUrl,
      filename: ref.data.filename,
    });
    props.onOpenChange(false);
    toast.success(`Añadida a ${roleLabel}`);
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjuntar al activo</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Elige el rol de esta imagen.</p>
        <div className="grid grid-cols-3 gap-3 pt-2">
          {roles.map((r) => {
            const Icon = r.icon;
            return (
              <Button
                key={r.key}
                type="button"
                variant="outline"
                className="h-24 flex-col gap-2 whitespace-normal text-center text-xs"
                disabled={saving !== null}
                onClick={() => attach(r.key, r.label)}
              >
                <Icon className="h-6 w-6" />
                {r.label}
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
