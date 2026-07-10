'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Package, Box } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { setProductImagesAction } from '@/server-actions/products';
import type { StudioAssetImages, StudioRefOption } from './types';

type Role = 'product' | 'packaging';

export function AttachDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generationId: string | null;
  productId: string;
  assetType: 'product' | 'location' | 'character';
  assetImages: StudioAssetImages;
  onAttached: (next: StudioAssetImages, newRef: StudioRefOption) => void;
}) {
  const [saving, setSaving] = useState<Role | null>(null);

  async function attach(role: Role) {
    if (!props.generationId) return;
    // Fase 2: el diálogo solo maneja producto (los roles de locación/personaje
    // llegan en la Task 3). El botón que abre este diálogo ya está gateado a
    // producto en StudioClient; este narrowing es solo robustez de tipos.
    if (props.assetImages.assetType !== 'product') return;
    setSaving(role);
    // 1) Promueve la generación a media_reference reutilizable.
    const ref = await addGenerationAsReferenceAction({ generationId: props.generationId });
    if (!ref.ok) {
      setSaving(null);
      toast.error('No se pudo preparar la imagen');
      return;
    }
    // 2) Agrega el ref al array del rol, sin duplicar ni pisar lo existente.
    // 'as const' en assetType conserva el literal 'product' (si no, TS lo
    // widena a string y next deja de calzar con StudioAssetImages).
    const productImages = props.assetImages;
    const next =
      role === 'product'
        ? {
            assetType: 'product' as const,
            productImageIds: [...new Set([...productImages.productImageIds, ref.data.id])],
            packagingImageIds: productImages.packagingImageIds,
          }
        : {
            assetType: 'product' as const,
            productImageIds: productImages.productImageIds,
            packagingImageIds: [...new Set([...productImages.packagingImageIds, ref.data.id])],
          };
    // 3) Persiste (setProductImagesAction reemplaza ambos arrays).
    const res = await setProductImagesAction(props.productId, {
      productImageIds: next.productImageIds,
      packagingImageIds: next.packagingImageIds,
    });
    setSaving(null);
    if (!res.ok) {
      toast.error('No se pudo guardar en el producto');
      return;
    }
    // Devuelve la referencia recién creada para que el compositor la ofrezca de
    // inmediato (sin recargar): la imagen adjuntada ya es una media_reference.
    props.onAttached(next, {
      id: ref.data.id,
      previewUrl: ref.data.previewUrl,
      filename: ref.data.filename,
    });
    props.onOpenChange(false);
    toast.success(role === 'product' ? 'Añadida a Imágenes de producto' : 'Añadida a Empaque');
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjuntar al producto</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Elige el rol de esta imagen.</p>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            className="h-24 flex-col gap-2"
            disabled={saving !== null}
            onClick={() => attach('product')}
          >
            <Box className="h-6 w-6" />
            Imagen de producto
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-24 flex-col gap-2"
            disabled={saving !== null}
            onClick={() => attach('packaging')}
          >
            <Package className="h-6 w-6" />
            Empaque
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
