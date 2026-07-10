'use client';

import { useState, useTransition } from 'react';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createProductAction, updateProductAction, setProductImagesAction } from '@/server-actions/products';
import { setReferenceUsageAction } from '@/server-actions/media-references';
import { Button } from '@/components/ui/button';
import { ReferenceImagesUploader, type RefImage } from '@/components/shared/ReferenceImagesUploader';
import { ZoomableImage } from '@/components/shared/ZoomableImage';

// Espeja ProductRow (lib/campaigns/products.ts) para el consumo en UI: los
// arrays de imágenes llegan siempre resueltos ([] en vez de null) porque el
// caller (Task 4) los normaliza al leer la fila.
export type ProductView = {
  id: string;
  brand_id: string | null;
  name: string;
  slug: string | null;
  medium: string | null;
  height_cm: number | null;
  width_cm: number | null;
  thickness_mm: number | null;
  weight_kg: number | null;
  visual_details: string | null;
  palette: string[] | null;
  product_image_ids: string[];
  packaging_image_ids: string[];
};

// Convierte un input numérico vacío o inválido a null (nunca NaN) antes de
// enviarlo al server action — CreateProductSchema espera number|null|undefined.
function numOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function ProductEditor({
  brandKitId,
  product,
  previews,
  usages,
  onClose,
  onSaved,
}: {
  brandKitId: string;
  product: ProductView | null;
  previews: Record<string, string>;
  usages: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [medium, setMedium] = useState(product?.medium ?? '');
  const [heightCm, setHeightCm] = useState(product?.height_cm != null ? String(product.height_cm) : '');
  const [widthCm, setWidthCm] = useState(product?.width_cm != null ? String(product.width_cm) : '');
  const [thicknessMm, setThicknessMm] = useState(product?.thickness_mm != null ? String(product.thickness_mm) : '');
  const [weightKg, setWeightKg] = useState(product?.weight_kg != null ? String(product.weight_kg) : '');
  const [visualDetails, setVisualDetails] = useState(product?.visual_details ?? '');
  const [palette, setPalette] = useState<string[]>(product?.palette ?? []);
  const [productImages, setProductImages] = useState<RefImage[]>(
    (product?.product_image_ids ?? []).map((id) => ({ id, previewUrl: previews[id] ?? null })),
  );
  const [packagingImages, setPackagingImages] = useState<RefImage[]>(
    (product?.packaging_image_ids ?? []).map((id) => ({ id, previewUrl: previews[id] ?? null })),
  );
  // Uso de cada vista/imagen (frontal, 3/4, perfil, caja cerrada...): paridad
  // con BrandKitEditor — alimenta resolveUsages -> imageUsages del orchestrator.
  const [imageUsages, setImageUsages] = useState<Record<string, string>>(
    Object.fromEntries(
      [...(product?.product_image_ids ?? []), ...(product?.packaging_image_ids ?? [])].map((id) => [
        id,
        usages[id] ?? '',
      ]),
    ),
  );
  const [saving, startSave] = useTransition();

  async function saveUsage(refId: string, value: string) {
    setImageUsages((prev) => ({ ...prev, [refId]: value }));
    const res = await setReferenceUsageAction({ refId, usage: value });
    if (!res.ok) toast.error(res.message || 'No se pudo guardar el uso');
  }

  function handleSave() {
    const fields = {
      name,
      medium: medium.trim() || null,
      heightCm: numOrNull(heightCm),
      widthCm: numOrNull(widthCm),
      thicknessMm: numOrNull(thicknessMm),
      weightKg: numOrNull(weightKg),
      visualDetails: visualDetails.trim() || null,
      palette: palette.length ? palette : null,
    };
    startSave(async () => {
      const res = product
        ? await updateProductAction(product.id, fields)
        : await createProductAction({ ...fields, brandId: brandKitId });
      if (!res.ok) { toast.error(res.message || 'Error'); return; }
      const productId = product ? product.id : (res as { ok: true; data: { id: string } }).data.id;
      const imgRes = await setProductImagesAction(productId, {
        productImageIds: productImages.map((i) => i.id),
        packagingImageIds: packagingImages.map((i) => i.id),
      });
      if (!imgRes.ok) { toast.error(imgRes.message || 'Producto guardado, pero no se guardaron las imágenes'); return; }
      toast.success(product ? 'Producto actualizado' : 'Producto creado');
      onClose();
      onSaved();
    });
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-3.5">
        <h2 className="text-[15px] font-medium text-foreground">{product ? 'Editar' : 'Nuevo'} producto</h2>
      </div>
      <div className="space-y-3 p-5">
        <div>
          <label htmlFor="product-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nombre</label>
          <input
            id="product-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del producto"
            className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <ReferenceImagesUploader
          label="Imágenes de producto"
          hint="2-4 ángulos (frontal, perfil, detalle) con fondo simple. Son la base de la fidelidad en campañas."
          images={productImages}
          onChange={setProductImages}
          max={4}
        />

        {productImages.length > 0 ? (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Uso de cada vista (opcional)</label>
            {productImages.map((img) => (
              <div key={img.id} className="flex items-center gap-2">
                {img.previewUrl ? (
                  <ZoomableImage src={img.previewUrl} alt="Vista de producto" className="size-10 shrink-0 rounded-md border border-border" />
                ) : (
                  <div className="size-10 shrink-0 rounded-md border border-border bg-muted/30" aria-hidden />
                )}
                <input
                  type="text"
                  aria-label="Uso de esta vista de producto"
                  defaultValue={imageUsages[img.id] ?? ''}
                  placeholder="¿Qué muestra? p.ej. frontal en blanco, vista 3/4, detalle del logo"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (usages[img.id] ?? '')) void saveUsage(img.id, v); }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </div>
            ))}
          </div>
        ) : null}

        <ReferenceImagesUploader
          label="Empaque"
          hint="Para el formato de unboxing (El Descubrimiento). Opcional."
          images={packagingImages}
          onChange={setPackagingImages}
          max={2}
        />

        {packagingImages.length > 0 ? (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Uso de cada imagen de empaque (opcional)</label>
            {packagingImages.map((img) => (
              <div key={img.id} className="flex items-center gap-2">
                {img.previewUrl ? (
                  <ZoomableImage src={img.previewUrl} alt="Vista de empaque" className="size-10 shrink-0 rounded-md border border-border" />
                ) : (
                  <div className="size-10 shrink-0 rounded-md border border-border bg-muted/30" aria-hidden />
                )}
                <input
                  type="text"
                  aria-label="Uso de esta imagen de empaque"
                  defaultValue={imageUsages[img.id] ?? ''}
                  placeholder="¿Qué muestra? p.ej. caja cerrada, caja abierta con producto"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (usages[img.id] ?? '')) void saveUsage(img.id, v); }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="product-height" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Alto (cm)</label>
            <input
              id="product-height"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="—"
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label htmlFor="product-width" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ancho (cm)</label>
            <input
              id="product-width"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={widthCm}
              onChange={(e) => setWidthCm(e.target.value)}
              placeholder="—"
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label htmlFor="product-thickness" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Grosor (mm)</label>
            <input
              id="product-thickness"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={thicknessMm}
              onChange={(e) => setThicknessMm(e.target.value)}
              placeholder="—"
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label htmlFor="product-weight" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Peso (kg)</label>
            <input
              id="product-weight"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="—"
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        </div>

        <div>
          <label htmlFor="product-medium" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Material / medio</label>
          <input
            id="product-medium"
            value={medium}
            onChange={(e) => setMedium(e.target.value)}
            placeholder="ej. cerámica, algodón, vidrio soplado"
            className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <div>
          <label htmlFor="product-visual-details" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Detalles visuales</label>
          <textarea
            id="product-visual-details"
            value={visualDetails}
            onChange={(e) => setVisualDetails(e.target.value)}
            placeholder="Textura, acabado, detalles que el modelo debe respetar..."
            className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            rows={2}
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Paleta de colores</label>
          <div className="mt-1.5 space-y-1.5">
            {palette.map((hex, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="size-7 rounded-md border border-border" style={{ backgroundColor: hex }} />
                  <input
                    type="text"
                    aria-label="Código hex del color"
                    value={hex}
                    onChange={(e) => {
                      const val = e.target.value;
                      const next = [...palette];
                      next[i] = val;
                      setPalette(next);
                    }}
                    maxLength={50}
                    placeholder="#009fff"
                    className="w-28 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                </div>
                <Button type="button" variant="ghost" size="icon-xs" onClick={() => setPalette(palette.filter((_, j) => j !== i))} aria-label={`Quitar color ${hex}`} className="text-muted-foreground hover:text-destructive">
                  <X className="size-3" aria-hidden />
                </Button>
              </div>
            ))}
            {palette.length < 12 && (
              <button type="button" onClick={() => setPalette([...palette, '#000000'])} className="rounded-sm text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">+ Agregar color</button>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={handleSave} disabled={saving || !name.trim()} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
