'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Package, Palette, Plus, Trash2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { createBrandKitAction, updateBrandKitAction, deleteBrandKitAction } from '@/server-actions/brand-kits';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { ProductsSection } from '@/components/products/ProductsSection';
import type { ProductView } from '@/components/products/ProductEditor';

type ColorEntry = { name: string; hex: string };
type BrandKit = {
  id: string;
  name: string;
  colors: ColorEntry[];
  fonts: string[];
  logo_url: string | null;
  tone_description: string | null;
  style_guidelines: string | null;
  created_at: string;
};

export function BrandKitsPage({
  kits: initial,
  angleCost,
  products,
  productPreviews,
  productUsages,
}: {
  kits: BrandKit[];
  angleCost: number | null;
  products: ProductView[];
  productPreviews: Record<string, string>;
  productUsages: Record<string, string>;
}) {
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
  // Un kit expandido a la vez: sus productos se muestran en un panel a lo ancho
  // debajo de la grilla. Antes iban DENTRO de la tarjeta de ~1/3 de ancho y el
  // editor y las tarjetas de producto quedaban apretados e ilegibles.
  const [expandedKitId, setExpandedKitId] = useState<string | null>(null);
  const expandedKit = kits.find((k) => k.id === expandedKitId) ?? null;

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
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
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
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {kits.map((kit) => (
              <BrandKitCard
                key={kit.id}
                kit={kit}
                productCount={products.filter((p) => p.brand_id === kit.id).length}
                expanded={expandedKitId === kit.id}
                onToggleProducts={() => setExpandedKitId((cur) => (cur === kit.id ? null : kit.id))}
                onEdit={() => setEditing(kit)}
                onDelete={async () => {
                  const ok = await confirm({ title: `¿Eliminar "${kit.name}"?`, description: 'El brand kit se eliminara permanentemente.', confirmLabel: 'Eliminar', destructive: true });
                  if (!ok) return;
                  deleteBrandKitAction(kit.id).then((res) => {
                    if (res.ok) {
                      setKits((k) => k.filter((x) => x.id !== kit.id));
                      if (expandedKitId === kit.id) setExpandedKitId(null);
                      toast.success('Kit eliminado');
                    } else toast.error(res.message || 'Error');
                  });
                }}
              />
            ))}
          </div>

          {expandedKit && (
            <div className="mt-4 overflow-hidden rounded-xl border border-primary/30 bg-card/40">
              <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-5 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Package className="size-4 shrink-0 text-primary" aria-hidden />
                  <h2 className="truncate text-[14px] font-medium text-foreground">
                    Productos · {expandedKit.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedKitId(null)}
                  aria-label="Cerrar productos"
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <div className="p-5">
                <ProductsSection
                  brandKitId={expandedKit.id}
                  products={products.filter((p) => p.brand_id === expandedKit.id)}
                  previews={productPreviews}
                  usages={productUsages}
                  angleCost={angleCost}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BrandKitCard({
  kit,
  productCount,
  expanded,
  onToggleProducts,
  onEdit,
  onDelete,
}: {
  kit: BrandKit;
  productCount: number;
  expanded: boolean;
  onToggleProducts: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-card/50 transition-colors ${
        expanded ? 'border-primary/50' : 'border-border hover:border-muted-foreground/20'
      }`}
    >
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
        {productCount} {productCount === 1 ? 'producto' : 'productos'}
      </p>
      </div>
      <div className="flex gap-2 border-t border-border/30 p-3">
        <button type="button" onClick={onEdit} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Pencil className="size-3" aria-hidden /> Editar
        </button>
        <button
          type="button"
          onClick={onToggleProducts}
          aria-expanded={expanded}
          className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            expanded
              ? 'border-primary/50 bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          <Package className="size-3" aria-hidden /> {expanded ? 'Ocultar productos' : `Productos (${productCount})`}
        </button>
        <button type="button" onClick={onDelete} aria-label="Eliminar kit" className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Trash2 className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function BrandKitEditor({ kit, onClose, onSaved }: { kit: BrandKit | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(kit?.name ?? '');
  const [colors, setColors] = useState<ColorEntry[]>(kit?.colors ?? [{ name: 'Primary', hex: '#009fff' }]);
  const [fonts, setFonts] = useState(kit?.fonts?.join(', ') ?? '');
  const [tone, setTone] = useState(kit?.tone_description ?? '');
  const [guidelines, setGuidelines] = useState(kit?.style_guidelines ?? '');
  const [saving, startSave] = useTransition();

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
