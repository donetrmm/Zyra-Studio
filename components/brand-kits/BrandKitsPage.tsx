'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Palette, Plus, Sparkles, Trash2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { createBrandKitAction, updateBrandKitAction, deleteBrandKitAction, setBrandKitImagesAction } from '@/server-actions/brand-kits';
import { getReferencePathsAction, analyzeKitFromImageAction } from '@/server-actions/creation';
import { setReferenceUsageAction } from '@/server-actions/media-references';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { ReferenceImagesUploader, type RefImage } from '@/components/shared/ReferenceImagesUploader';
import { CreationWizard, type ImgRef, type SaveResult } from '@/components/creation/CreationWizard';
import { generateProductAngle, isGenError } from '@/components/creation/generate';

type ColorEntry = { name: string; hex: string };
type BrandKit = {
  id: string;
  name: string;
  colors: ColorEntry[];
  fonts: string[];
  logo_url: string | null;
  tone_description: string | null;
  style_guidelines: string | null;
  product_image_ids: string[];
  packaging_image_ids: string[];
  created_at: string;
};

type AiState =
  | { mode: 'create' }
  | { mode: 'improve'; kit: BrandKit; existing: { product?: ImgRef; packaging?: ImgRef } };

export function BrandKitsPage({ kits: initial, previews, usages }: { kits: BrandKit[]; previews: Record<string, string>; usages: Record<string, string> }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [kits, setKits] = useState(initial);
  // Re-sincroniza tras router.refresh(): ajuste de estado durante render,
  // no en effect (react.dev/learn/you-might-not-need-an-effect).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setKits(initial);
  }
  const [editing, setEditing] = useState<BrandKit | 'new' | null>(null);
  const [ai, setAi] = useState<AiState | null>(null);

  // "Mejorar con IA": lee las imágenes que el kit ya tiene (producto y empaque),
  // resolviendo su storagePath para que Nano Banana pueda editarlas.
  async function openImprove(kit: BrandKit) {
    const ids = [kit.product_image_ids[0], kit.packaging_image_ids[0]].filter(Boolean) as string[];
    const res = await getReferencePathsAction(ids);
    const paths = res.ok ? res.data : {};
    const mk = (id?: string): ImgRef | undefined =>
      id && paths[id] ? { id, storagePath: paths[id], previewUrl: previews[id] ?? '' } : undefined;
    setAi({
      mode: 'improve',
      kit,
      existing: { product: mk(kit.product_image_ids[0]), packaging: mk(kit.packaging_image_ids[0]) },
    });
  }

  async function handleAiSave(result: SaveResult) {
    if (result.kind === 'product-create') {
      const created = await createBrandKitAction({
        name: result.name,
        colors: result.colors,
        toneDescription: result.tone,
      });
      if (!created.ok) { toast.error(created.message || 'No se pudo crear el kit'); return; }
      const img = await setBrandKitImagesAction(created.data.id, {
        productImageIds: [result.productRefId],
        packagingImageIds: result.packagingRefId ? [result.packagingRefId] : [],
      });
      if (!img.ok) { toast.error(img.message || 'Kit creado, pero no se guardaron las imágenes'); return; }
      router.refresh();
    } else if (result.kind === 'product-improve' && ai?.mode === 'improve') {
      const kit = ai.kit;
      const baseId = ai.existing[result.target]?.id;
      const without = (arr: string[]) => arr.filter((id) => id !== baseId);
      const productImageIds = result.target === 'product'
        ? [result.refId, ...without(kit.product_image_ids)].slice(0, 4)
        : kit.product_image_ids;
      const packagingImageIds = result.target === 'packaging'
        ? [result.refId, ...without(kit.packaging_image_ids)].slice(0, 2)
        : kit.packaging_image_ids;
      const img = await setBrandKitImagesAction(kit.id, { productImageIds, packagingImageIds });
      if (!img.ok) { toast.error(img.message || 'No se pudo guardar'); return; }
      router.refresh();
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Brand Kits</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            Define la identidad visual de tu marca: paleta de colores, fuentes y tono de voz. Al generar imágenes, selecciona un kit para inyectar tu estilo en el prompt.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setAi({ mode: 'create' })}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3.5 py-2 text-[13px] font-medium text-foreground hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Sparkles className="size-4" aria-hidden />
            Crear con IA
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Plus className="size-4" aria-hidden />
            Nuevo kit
          </button>
        </div>
      </div>

      {editing && (
        <BrandKitEditor
          kit={editing === 'new' ? null : editing}
          previews={previews}
          usages={usages}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {ai && (
        <CreationWizard
          kind="product"
          productFlow={ai.mode === 'create' ? 'create' : 'improve'}
          existing={ai.mode === 'improve' ? ai.existing : undefined}
          onSave={handleAiSave}
          onClose={() => setAi(null)}
        />
      )}

      {kits.length === 0 && !editing ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
            <Palette className="size-7" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/70">No tienes brand kits</p>
          <p className="max-w-xs text-[12.5px]">Crea tu primer kit para inyectar identidad de marca en tus generaciones</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kits.map((kit) => (
            <BrandKitCard
              key={kit.id}
              kit={kit}
              onEdit={() => setEditing(kit)}
              onImprove={() => void openImprove(kit)}
              onDelete={async () => {
                const ok = await confirm({ title: `¿Eliminar "${kit.name}"?`, description: 'El brand kit se eliminara permanentemente.', confirmLabel: 'Eliminar', destructive: true });
                if (!ok) return;
                deleteBrandKitAction(kit.id).then((res) => {
                  if (res.ok) {
                    setKits((k) => k.filter((x) => x.id !== kit.id));
                    toast.success('Kit eliminado');
                  } else toast.error(res.message || 'Error');
                });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BrandKitCard({ kit, onEdit, onImprove, onDelete }: { kit: BrandKit; onEdit: () => void; onImprove: () => void; onDelete: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20">
      <div className="p-4">
      <h3 className="truncate text-[14px] font-medium text-foreground">{kit.name}</h3>
      {kit.colors.length > 0 && (
        <div className="mt-2 flex gap-1">
          {kit.colors.slice(0, 6).map((c, i) => (
            <div
              key={i}
              role="img"
              aria-label={`${c.name}: ${c.hex}`}
              className="size-5 rounded-full border border-border"
              style={{ backgroundColor: c.hex }}
              title={`${c.name}: ${c.hex}`}
            />
          ))}
          {kit.colors.length > 6 && (
            <span className="text-[11px] text-muted-foreground">+{kit.colors.length - 6}</span>
          )}
        </div>
      )}
      {kit.fonts.length > 0 && (
        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
          {kit.fonts.join(', ')}
        </p>
      )}
      {kit.tone_description && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground/70">{kit.tone_description}</p>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {kit.product_image_ids.length} img producto · {kit.packaging_image_ids.length} empaque
      </p>
      </div>
      <div className="flex gap-2 border-t border-border/30 p-3">
        <button type="button" onClick={onEdit} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Pencil className="size-3" aria-hidden /> Editar
        </button>
        <button type="button" onClick={onImprove} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] text-foreground hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Sparkles className="size-3" aria-hidden /> Mejorar con IA
        </button>
        <button type="button" onClick={onDelete} aria-label="Eliminar kit" className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Trash2 className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function BrandKitEditor({ kit, previews, usages, onClose, onSaved }: { kit: BrandKit | null; previews: Record<string, string>; usages: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(kit?.name ?? '');
  const [colors, setColors] = useState<ColorEntry[]>(kit?.colors ?? [{ name: 'Primary', hex: '#009fff' }]);
  const [fonts, setFonts] = useState(kit?.fonts?.join(', ') ?? '');
  const [tone, setTone] = useState(kit?.tone_description ?? '');
  const [guidelines, setGuidelines] = useState(kit?.style_guidelines ?? '');
  const [productImages, setProductImages] = useState<RefImage[]>(
    (kit?.product_image_ids ?? []).map((id) => ({ id, previewUrl: previews[id] ?? null })),
  );
  const [packagingImages, setPackagingImages] = useState<RefImage[]>(
    (kit?.packaging_image_ids ?? []).map((id) => ({ id, previewUrl: previews[id] ?? null })),
  );
  const [productUsages, setProductUsages] = useState<Record<string, string>>(
    Object.fromEntries(productImages.map((i) => [i.id, usages[i.id] ?? ''])),
  );
  const [saving, startSave] = useTransition();
  const [detecting, setDetecting] = useState(false);
  const [angling, setAngling] = useState(false);

  async function saveUsage(refId: string, value: string) {
    setProductUsages((prev) => ({ ...prev, [refId]: value }));
    const res = await setReferenceUsageAction({ refId, usage: value });
    if (!res.ok) toast.error(res.message || 'No se pudo guardar el uso');
  }

  // Auto-rellena nombre, paleta y tono leyendo la imagen de producto subida
  // (cuando el usuario sube imágenes pero no llena los campos).
  async function detectFromImage() {
    if (productImages.length === 0 || detecting) return;
    setDetecting(true);
    try {
      const res = await analyzeKitFromImageAction(productImages[0].id);
      if (!res.ok) { toast.error(res.message || 'No se pudo detectar'); return; }
      if (res.data.name) setName(res.data.name);
      if (res.data.colors.length) setColors(res.data.colors);
      if (res.data.tone) setTone(res.data.tone);
      toast.success('Campos detectados desde la imagen; ajústalos si quieres');
    } finally { setDetecting(false); }
  }

  // Genera la vista 3/4 del producto (P01) desde la PRIMERA imagen subida y la
  // antepone a la lista (tope 4). Se conserva al Guardar (setBrandKitImagesAction).
  async function generateThreeQuarter() {
    if (productImages.length === 0 || productImages.length >= 4 || angling) return;
    setAngling(true);
    try {
      const src = productImages[0];
      const pathRes = await getReferencePathsAction([src.id]);
      const storagePath = pathRes.ok ? pathRes.data[src.id] : undefined;
      if (!storagePath) { toast.error('No se pudo resolver la imagen de producto'); return; }
      const out = await generateProductAngle({ id: src.id, storagePath }, 'three-quarter');
      if (isGenError(out)) { toast.error(out.message || 'No se pudo generar la vista 3/4'); return; }
      setProductImages((prev) => [{ id: out.refId, previewUrl: out.previewUrl }, ...prev].slice(0, 4));
      await setReferenceUsageAction({ refId: out.refId, usage: 'three-quarter view' });
      toast.success('Vista 3/4 generada; guarda el kit para conservarla');
    } finally {
      setAngling(false);
    }
  }

  function handleSave() {
    const payload = {
      name,
      colors,
      fonts: fonts.split(',').map((f) => f.trim()).filter(Boolean),
      toneDescription: tone || undefined,
      styleGuidelines: guidelines || undefined,
    };
    startSave(async () => {
      const res = kit
        ? await updateBrandKitAction(kit.id, payload)
        : await createBrandKitAction(payload);
      if (!res.ok) { toast.error(res.message || 'Error'); return; }
      const kitId = kit ? kit.id : (res as { ok: true; data: { id: string } }).data.id;
      const imgRes = await setBrandKitImagesAction(kitId, {
        productImageIds: productImages.map((i) => i.id),
        packagingImageIds: packagingImages.map((i) => i.id),
      });
      if (!imgRes.ok) { toast.error(imgRes.message || 'No se pudieron guardar las imágenes'); return; }
      toast.success(kit ? 'Kit actualizado' : 'Kit creado');
      onClose();
      onSaved();
    });
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-3.5">
        <h2 className="text-[15px] font-medium text-foreground">{kit ? 'Editar' : 'Nuevo'} Brand Kit</h2>
      </div>
      <div className="space-y-3 p-5">
        <div>
          <label htmlFor="kit-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nombre del kit</label>
          <input id="kit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del kit" className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
        </div>

        <ReferenceImagesUploader
          label="Imágenes de producto"
          hint="2-4 ángulos (frontal, perfil, detalle, logo) con fondo simple. Son la base de la fidelidad en campañas."
          images={productImages}
          onChange={setProductImages}
          max={4}
        />

        {productImages.length > 0 ? (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Uso de cada vista (opcional)</label>
            {productImages.map((img) => (
              <input
                key={img.id}
                type="text"
                aria-label="Uso de esta vista de producto"
                defaultValue={productUsages[img.id] ?? ''}
                placeholder="¿Qué muestra? p.ej. frontal en blanco, vista 3/4, detalle del logo"
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (usages[img.id] ?? '')) void saveUsage(img.id, v); }}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={detectFromImage}
          disabled={detecting || productImages.length === 0}
          title={productImages.length === 0 ? 'Sube primero una imagen de producto' : undefined}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {detecting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5 text-primary" aria-hidden />}
          Detectar nombre, paleta y tono desde la imagen
        </button>

        <button
          type="button"
          onClick={generateThreeQuarter}
          disabled={angling || productImages.length === 0 || productImages.length >= 4}
          title={
            productImages.length === 0
              ? 'Sube primero una imagen de producto'
              : productImages.length >= 4
                ? 'Ya tienes el máximo de vistas (4)'
                : 'Genera una vista 3/4 para reducir la deriva geométrica en video'
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {angling ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5 text-primary" aria-hidden />}
          Generar vista 3/4 del producto
        </button>

        <ReferenceImagesUploader
          label="Empaque"
          hint="Para el formato de unboxing (El Descubrimiento). Opcional."
          images={packagingImages}
          onChange={setPackagingImages}
          max={2}
        />

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Paleta de colores</label>
          <div className="mt-1.5 space-y-1.5">
            {colors.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="size-7 rounded-md border border-border" style={{ backgroundColor: c.hex }} />
                  <input
                    type="text"
                    aria-label="Código hex del color"
                    value={c.hex}
                    onChange={(e) => {
                      const val = e.target.value;
                      const next = [...colors];
                      next[i] = { ...c, hex: val };
                      setColors(next);
                    }}
                    maxLength={7}
                    placeholder="#009fff"
                    className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                </div>
                <input aria-label="Nombre del color" value={c.name} onChange={(e) => { const next = [...colors]; next[i] = { ...c, name: e.target.value }; setColors(next); }} placeholder="Nombre" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
                <Button type="button" variant="ghost" size="icon-xs" onClick={() => setColors(colors.filter((_, j) => j !== i))} aria-label={`Quitar color ${c.name || c.hex}`} className="text-muted-foreground hover:text-destructive">
                  <X className="size-3" aria-hidden />
                </Button>
              </div>
            ))}
            {colors.length < 10 && (
              <button type="button" onClick={() => setColors([...colors, { name: '', hex: '#000000' }])} className="rounded-sm text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">+ Agregar color</button>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="kit-fonts" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fuentes (separadas por coma)</label>
          <input id="kit-fonts" value={fonts} onChange={(e) => setFonts(e.target.value)} placeholder="Inter, Playfair Display" className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
        </div>

        <div>
          <label htmlFor="kit-tone" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tono de voz</label>
          <textarea id="kit-tone" value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Profesional pero cercano, optimista..." className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" rows={2} />
        </div>

        <div>
          <label htmlFor="kit-guidelines" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Guidelines de estilo</label>
          <textarea id="kit-guidelines" value={guidelines} onChange={(e) => setGuidelines(e.target.value)} placeholder="Usar fondos limpios, evitar saturación..." className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" rows={2} />
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
