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
import type { StudioProductImages } from './types';

type Role = 'product' | 'packaging';

export function AttachDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generationId: string | null;
  productId: string;
  productImages: StudioProductImages;
  onAttached: (next: StudioProductImages) => void;
}) {
  const [saving, setSaving] = useState<Role | null>(null);

  async function attach(role: Role) {
    if (!props.generationId) return;
    setSaving(role);
    // 1) Promueve la generación a media_reference reutilizable.
    const ref = await addGenerationAsReferenceAction({ generationId: props.generationId });
    if (!ref.ok) {
      setSaving(null);
      toast.error('No se pudo preparar la imagen');
      return;
    }
    // 2) Agrega el ref al array del rol, sin duplicar ni pisar lo existente.
    const next: StudioProductImages =
      role === 'product'
        ? {
            productImageIds: [...new Set([...props.productImages.productImageIds, ref.data.id])],
            packagingImageIds: props.productImages.packagingImageIds,
          }
        : {
            productImageIds: props.productImages.productImageIds,
            packagingImageIds: [...new Set([...props.productImages.packagingImageIds, ref.data.id])],
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
    props.onAttached(next);
    props.onOpenChange(false);
    toast.success(role === 'product' ? 'Añadida a Imágenes de producto' : 'Añadida a Empaque');
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjuntar al producto</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-400">Elige el rol de esta imagen.</p>
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
