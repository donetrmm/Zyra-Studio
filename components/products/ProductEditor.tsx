'use client';

import { useState, useTransition } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { createProductAction, updateProductAction, setProductImagesAction } from '@/server-actions/products';
import { getReferencePathsAction } from '@/server-actions/creation';
import { Button } from '@/components/ui/button';
import { ReferenceImagesUploader, type RefImage } from '@/components/shared/ReferenceImagesUploader';
import { ZoomableImage } from '@/components/shared/ZoomableImage';
import { MasterImageRefiner } from '@/components/shared/MasterImageRefiner';
import { generateProductAngle, refineProductImage, isGenError, type ProductAngleView } from '@/components/creation/generate';

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

const ANGLE_LABEL: Record<ProductAngleView, { name: string; buttonLabel: string }> = {
  'three-quarter': { name: 'vista 3/4', buttonLabel: 'Generar vista 3/4' },
  profile: { name: 'vista 90° (perfil)', buttonLabel: 'Generar vista 90°' },
};

export function ProductEditor({
  brandKitId,
  product,
  previews,
  angleCost,
  onClose,
  onSaved,
}: {
  brandKitId: string;
  product: ProductView | null;
  previews: Record<string, string>;
  angleCost: number | null;
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
  const [saving, startSave] = useTransition();
  // Vista en generación ('three-quarter' | 'profile') o null.
  const [angling, setAngling] = useState<ProductAngleView | null>(null);
  // Vista con el retoque IA abierto (mismo patrón que BrandKitEditor).
  const [refiningId, setRefiningId] = useState<string | null>(null);

  // Genera una vista del producto (3/4 o perfil 90°) desde la PRIMERA imagen
  // subida y la antepone a la lista (tope 4). Se conserva al Guardar.
  async function generateAngleView(view: ProductAngleView) {
    if (productImages.length === 0 || productImages.length >= 4 || angling) return;
    setAngling(view);
    try {
      const src = productImages[0];
      const pathRes = await getReferencePathsAction([src.id]);
      const storagePath = pathRes.ok ? pathRes.data[src.id] : undefined;
      if (!storagePath) { toast.error('No se pudo resolver la imagen de producto'); return; }
      const out = await generateProductAngle({ id: src.id, storagePath }, view);
      if (isGenError(out)) { toast.error(out.message || `No se pudo generar la ${ANGLE_LABEL[view].name}`); return; }
      setProductImages((prev) => [{ id: out.refId, previewUrl: out.previewUrl }, ...prev].slice(0, 4));
      toast.success(`${ANGLE_LABEL[view].name} generada; guarda el producto para conservarla`);
    } finally {
      setAngling(null);
    }
  }

  // Retoque IA de una vista concreta: corrige la vista generada (o subida) sin
  // borrarla y regenerar. El resultado reemplaza la vista en su posición.
  function adoptRefinedView(oldId: string, r: { id: string; previewUrl: string | null }) {
    setProductImages((prev) => prev.map((img) => (img.id === oldId ? { id: r.id, previewUrl: r.previewUrl } : img)));
    setRefiningId(r.id);
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
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vistas del producto</label>
            {productImages.map((img, i) => (
              <div key={img.id}>
                <div className="flex items-center gap-2">
                  {img.previewUrl ? (
                    <ZoomableImage src={img.previewUrl} alt={`Vista de producto ${i + 1}`} className="size-10 shrink-0 rounded-md border border-border" />
                  ) : (
                    <div className="size-10 shrink-0 rounded-md border border-border bg-muted/30" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">Vista {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => setRefiningId((cur) => (cur === img.id ? null : img.id))}
                    title="Retocar esta vista con IA"
                    aria-label="Retocar esta vista con IA"
                    className={`grid size-8 shrink-0 place-items-center rounded-md border transition-colors ${
                      refiningId === img.id
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                  </button>
                </div>
                {refiningId === img.id && (
                  <div className="ml-12 mt-1.5">
                    <MasterImageRefiner
                      image={img}
                      refine={refineProductImage}
                      onResult={(r) => adoptRefinedView(img.id, r)}
                      placeholder="ej. fondo blanco puro, centra el producto"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {(['three-quarter', 'profile'] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => void generateAngleView(view)}
              disabled={angling !== null || productImages.length === 0 || productImages.length >= 4}
              title={
                productImages.length === 0
                  ? 'Sube primero una imagen de producto'
                  : productImages.length >= 4
                    ? 'Ya tienes el máximo de vistas (4)'
                    : view === 'three-quarter'
                      ? 'Genera una vista 3/4 para reducir la deriva geométrica en video'
                      : 'Genera la vista lateral (90°) del producto'
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {angling === view ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5 text-primary" aria-hidden />}
              {ANGLE_LABEL[view].buttonLabel}
              {angleCost != null && <span className="text-muted-foreground">· −{angleCost} cr</span>}
            </button>
          ))}
        </div>

        <ReferenceImagesUploader
          label="Empaque"
          hint="Para el formato de unboxing (El Descubrimiento). Opcional."
          images={packagingImages}
          onChange={setPackagingImages}
          max={2}
        />

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
