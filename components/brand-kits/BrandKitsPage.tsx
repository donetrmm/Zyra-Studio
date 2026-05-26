'use client';

import { useState, useTransition } from 'react';
import { Loader2, Palette, Plus, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { createBrandKitAction, updateBrandKitAction, deleteBrandKitAction } from '@/server-actions/brand-kits';
import { cn } from '@/lib/utils';

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

export function BrandKitsPage({ kits: initial }: { kits: BrandKit[] }) {
  const [kits, setKits] = useState(initial);
  const [editing, setEditing] = useState<BrandKit | 'new' | null>(null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Brand Kits</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Paleta, fuentes y tono para inyectar en tus generaciones
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden />
          Nuevo kit
        </button>
      </div>

      {editing && (
        <BrandKitEditor
          kit={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => window.location.reload()}
        />
      )}

      {kits.length === 0 && !editing ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground/60">
          <Palette className="size-12" aria-hidden />
          <p className="text-[14px]">No tienes brand kits</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kits.map((kit) => (
            <BrandKitCard
              key={kit.id}
              kit={kit}
              onEdit={() => setEditing(kit)}
              onDelete={() => {
                if (!confirm(`Eliminar "${kit.name}"?`)) return;
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

function BrandKitCard({ kit, onEdit, onDelete }: { kit: BrandKit; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 transition-colors hover:border-muted-foreground/20">
      <h3 className="truncate text-[14px] font-medium text-foreground">{kit.name}</h3>
      {kit.colors.length > 0 && (
        <div className="mt-2 flex gap-1">
          {kit.colors.slice(0, 6).map((c, i) => (
            <div
              key={i}
              className="size-5 rounded-full border border-border"
              style={{ backgroundColor: c.hex }}
              title={`${c.name}: ${c.hex}`}
            />
          ))}
          {kit.colors.length > 6 && (
            <span className="text-[10px] text-muted-foreground">+{kit.colors.length - 6}</span>
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
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onEdit} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground">
          <Pencil className="size-3" aria-hidden /> Editar
        </button>
        <button type="button" onClick={onDelete} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-destructive/40 hover:text-destructive">
          <Trash2 className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function BrandKitEditor({ kit, onClose, onSaved }: { kit: BrandKit | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(kit?.name ?? '');
  const [colors, setColors] = useState<ColorEntry[]>(kit?.colors ?? [{ name: 'Primary', hex: '#7c3aed' }]);
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
      onSaved();
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-5">
      <h2 className="text-[15px] font-medium text-foreground">{kit ? 'Editar' : 'Nuevo'} Brand Kit</h2>
      <div className="mt-4 space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del kit" className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none" />

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Paleta de colores</label>
          <div className="mt-1.5 space-y-1.5">
            {colors.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="size-7 rounded-md border border-border" style={{ backgroundColor: c.hex }} />
                  <input
                    type="text"
                    value={c.hex}
                    onChange={(e) => {
                      const val = e.target.value;
                      const next = [...colors];
                      next[i] = { ...c, hex: val };
                      setColors(next);
                    }}
                    maxLength={7}
                    placeholder="#7c3aed"
                    className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none"
                  />
                </div>
                <input value={c.name} onChange={(e) => { const next = [...colors]; next[i] = { ...c, name: e.target.value }; setColors(next); }} placeholder="Nombre" className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none" />
                <button type="button" onClick={() => setColors(colors.filter((_, j) => j !== i))} className="text-[11px] text-muted-foreground hover:text-destructive">x</button>
              </div>
            ))}
            {colors.length < 10 && (
              <button type="button" onClick={() => setColors([...colors, { name: '', hex: '#000000' }])} className="text-[11px] text-muted-foreground hover:text-foreground">+ Agregar color</button>
            )}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fuentes (separadas por coma)</label>
          <input value={fonts} onChange={(e) => setFonts(e.target.value)} placeholder="Inter, Playfair Display" className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none" />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tono de voz</label>
          <textarea value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Profesional pero cercano, optimista..." className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none" rows={2} />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Guidelines de estilo</label>
          <textarea value={guidelines} onChange={(e) => setGuidelines(e.target.value)} placeholder="Usar fondos limpios, evitar saturación..." className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none" rows={2} />
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={handleSave} disabled={saving || !name.trim()} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground hover:bg-muted">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
