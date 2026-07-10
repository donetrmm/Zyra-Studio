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
import { setProductImagesAction } from '@/server-actions/products';
import { updateLocationAction } from '@/server-actions/locations';
import { updateCharacterAction } from '@/server-actions/cast';
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

// Fusiona el nuevo ref en el rol y devuelve el siguiente StudioAssetImages, o un
// error legible (p. ej. tope de ángulos). Pura sobre el estado en memoria; la
// persistencia (server action) la hace attach() con este resultado.
export function mergeRole(
  images: StudioAssetImages,
  roleKey: string,
  refId: string,
): { next: StudioAssetImages } | { error: string } {
  if (images.assetType === 'product') {
    if (roleKey === 'product') {
      return { next: { ...images, productImageIds: [...new Set([...images.productImageIds, refId])] } };
    }
    return { next: { ...images, packagingImageIds: [...new Set([...images.packagingImageIds, refId])] } };
  }
  if (images.assetType === 'location') {
    if (roleKey === 'master') return { next: { ...images, masterImageId: refId } };
    if (roleKey === 'scale_map') return { next: { ...images, scaleMapImageId: refId } };
    return { next: { ...images, referenceImageIds: [...new Set([...images.referenceImageIds, refId])] } };
  }
  // character
  if (roleKey === 'master') return { next: { ...images, masterImageId: refId } };
  if (roleKey === 'full_body') return { next: { ...images, fullBodyImageId: refId } };
  // angle: el schema del personaje limita a 2 ángulos.
  if (images.angleImageIds.length >= 2 && !images.angleImageIds.includes(refId)) {
    return { error: 'El personaje ya tiene 2 ángulos (máximo). Quita uno desde el editor.' };
  }
  return { next: { ...images, angleImageIds: [...new Set([...images.angleImageIds, refId])] } };
}

// Persiste el StudioAssetImages con la acción del tipo. Devuelve ok/mensaje.
async function persist(
  productId: string,
  images: StudioAssetImages,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (images.assetType === 'product') {
    const res = await setProductImagesAction(productId, {
      productImageIds: images.productImageIds,
      packagingImageIds: images.packagingImageIds,
    });
    return res.ok ? { ok: true } : { ok: false, message: res.message ?? 'No se pudo guardar' };
  }
  if (images.assetType === 'location') {
    const res = await updateLocationAction(productId, {
      name: images.name,
      description: images.description ?? undefined,
      masterImageId: images.masterImageId ?? undefined,
      referenceImageIds: images.referenceImageIds,
      scaleMapImageId: images.scaleMapImageId ?? undefined,
      scaleMapNotes: images.scaleMapNotes ?? undefined,
    });
    return res.ok ? { ok: true } : { ok: false, message: res.message ?? 'No se pudo guardar' };
  }
  // character: updateCharacterAction recalcula reference_image_ids internamente.
  if (!images.masterImageId) {
    return { ok: false, message: 'El personaje necesita una imagen maestra primero.' };
  }
  const res = await updateCharacterAction(productId, {
    name: images.name,
    description: images.description ?? undefined,
    masterImageId: images.masterImageId,
    angleImageIds: images.angleImageIds,
    voiceCloneId: images.voiceCloneId ?? null,
    fullBodyImageId: images.fullBodyImageId ?? null,
  });
  return res.ok ? { ok: true } : { ok: false, message: res.message ?? 'No se pudo guardar' };
}

export function AttachDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generationId: string | null;
  assetId: string;
  assetType: StudioAssetType;
  assetImages: StudioAssetImages;
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
    const merged = mergeRole(props.assetImages, roleKey, ref.data.id);
    if ('error' in merged) {
      setSaving(null);
      toast.error(merged.error);
      return;
    }
    const saved = await persist(props.assetId, merged.next);
    setSaving(null);
    if (!saved.ok) {
      toast.error(saved.message);
      return;
    }
    props.onAttached(merged.next, {
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
