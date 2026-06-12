'use client';

// Conjunto de referencias por video + contador contra el tope del modelo
// (9 imágenes en Seedance vía fal). Reusado por el wizard de campaña y el
// panel del refinado. El presupuesto de ángulos por personaje replica el del
// compiler (lib/prompt-director/compilers/seedance.ts): 1→2, 2→1, 3→0.

export const MAX_REFERENCE_IMAGES = 9;

export type BudgetCharacter = {
  id: string;
  name: string;
  previewUrl: string | null;
  angleCount: number;
};

export function referenceSlots(input: {
  productCount: number;
  packagingCount?: number;
  characters: BudgetCharacter[];
}): number {
  const product = Math.min(input.productCount, 3);
  const packaging = Math.min(input.packagingCount ?? 0, 2);
  const n = input.characters.length;
  const anglesPer = n >= 3 ? 0 : n === 2 ? 1 : 2;
  const chars = input.characters.reduce(
    (acc, c) => acc + 1 + Math.min(c.angleCount, anglesPer),
    0,
  );
  return Math.min(product + packaging + chars, MAX_REFERENCE_IMAGES);
}

export function ReferenceBudget({
  productPreviews,
  productCount,
  packagingCount = 0,
  characters,
  extraCount = 0,
}: {
  // Previews de producto (hasta 3 se muestran); productCount puede ser mayor.
  productPreviews: Array<string | null>;
  productCount: number;
  packagingCount?: number;
  characters: BudgetCharacter[];
  // Referencias extra adjuntas (refinado): informativas, fuera del cómputo base.
  extraCount?: number;
}) {
  const slots = referenceSlots({ productCount, packagingCount, characters });
  const thumbs: Array<{ key: string; url: string | null; label: string }> = [
    ...productPreviews.slice(0, 3).map((url, i) => ({ key: `p${i}`, url, label: 'Producto' })),
    ...characters.map((c) => ({ key: c.id, url: c.previewUrl, label: c.name })),
  ];

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Referencias por video
        </span>
        <span aria-live="polite" className="text-[11.5px] tabular-nums text-muted-foreground">
          {slots}/{MAX_REFERENCE_IMAGES} imágenes
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {thumbs.map((t) =>
          t.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={t.key} src={t.url} alt={t.label} title={t.label} className="size-9 rounded-md border border-border object-cover" />
          ) : (
            <div key={t.key} title={t.label} className="grid size-9 place-items-center rounded-md border border-border bg-muted/30 text-[9px] text-muted-foreground/60">
              {t.label.slice(0, 2)}
            </div>
          ),
        )}
        {packagingCount > 0 && (
          <span className="text-[11px] text-muted-foreground/60">+{Math.min(packagingCount, 2)} empaque</span>
        )}
        {extraCount > 0 && (
          <span className="text-[11px] text-muted-foreground/60">+{extraCount} extra</span>
        )}
      </div>
    </div>
  );
}
