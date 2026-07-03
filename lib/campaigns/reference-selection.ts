// Selección manual de referencias de video (por campaña). Lógica pura: el IO
// (columna campaigns.reference_selection, pool desde brand kit/cast/locaciones)
// vive en lib/campaigns/reference-pool.ts y las server actions.
//
// CLAVE: la selección se aplica UPSTREAM (filtra el DirectorContext antes de
// compile) — nunca post-filtro sobre las referencias compiladas, porque
// buildReferences emite citas @image1..N amarradas al orden de construcción y
// un post-filtro las desalinea todas.
import type { DirectorContext } from '@/lib/prompt-director';

export type ReferenceSelection = { include: string[] };

// Parsea el jsonb crudo de campaigns.reference_selection. Cualquier forma
// inválida o lista vacía = null (comportamiento automático).
export function normalizeReferenceSelection(raw: unknown): ReferenceSelection | null {
  if (!raw || typeof raw !== 'object') return null;
  const inc = (raw as { include?: unknown }).include;
  if (!Array.isArray(inc)) return null;
  const paths = inc.filter((p): p is string => typeof p === 'string' && p.length > 0);
  return paths.length ? { include: paths } : null;
}

// Filtra el contexto a las referencias incluidas y marca manualRefs (el compiler
// levanta los topes por categoría: el usuario es el presupuesto; el tope global
// de 9 del modelo queda como red). Las hojas maestras del cast NO se filtran:
// son el ancla de identidad (masterImagePath es requerido a propósito) y
// quitarlas es un foot-gun. Paths stale (brand kit editado) filtran a no-op.
export function applyReferenceSelection(
  ctx: DirectorContext,
  selection: ReferenceSelection | null,
): DirectorContext {
  if (!selection) return ctx;
  const inc = new Set(selection.include);
  const keep = (paths: string[] | undefined): string[] => (paths ?? []).filter((p) => inc.has(p));
  return {
    ...ctx,
    manualRefs: true,
    ...(ctx.product
      ? {
          product: {
            ...ctx.product,
            imagePaths: keep(ctx.product.imagePaths),
            ...(ctx.product.packagingImagePaths
              ? { packagingImagePaths: keep(ctx.product.packagingImagePaths) }
              : {}),
          },
        }
      : {}),
    ...(ctx.characters
      ? {
          characters: ctx.characters.map((c) => ({
            ...c,
            ...(c.angleImagePaths ? { angleImagePaths: keep(c.angleImagePaths) } : {}),
          })),
        }
      : {}),
    ...(ctx.location
      ? {
          location: {
            ...ctx.location,
            imagePaths: keep(ctx.location.imagePaths),
            scaleMap:
              ctx.location.scaleMap && inc.has(ctx.location.scaleMap.path)
                ? ctx.location.scaleMap
                : undefined,
          },
        }
      : {}),
    extraImagePaths: (() => {
      const kept = keep(ctx.extraImagePaths);
      return kept.length ? kept : undefined;
    })(),
  };
}

// --- Pool para la UI del selector -------------------------------------------

export type ReferencePoolCategory =
  | 'product'
  | 'packaging'
  | 'character_master'
  | 'character_angle'
  | 'location'
  | 'scale_map'
  | 'extra';

export type ReferencePoolEntry = {
  path: string;
  category: ReferencePoolCategory;
  label: string;
  // Masters del cast: siempre viajan, la UI los muestra marcados y deshabilitados.
  locked?: boolean;
  // Lo que el recorte AUTOMÁTICO mandaría (aprox.: los ángulos de cast dependen
  // del presupuesto por clip; se marca el mejor caso y la UI lo aclara en copy).
  autoIncluded: boolean;
};

export type ReferencePoolInput = {
  product: { name?: string; imagePaths: string[]; imageUsages?: Record<string, string> };
  packagingImagePaths: string[];
  characters: { name: string; masterImagePath: string; angleImagePaths?: string[] }[];
  locations: { name: string; imagePaths: string[]; scaleMap?: { path: string } }[];
  extraImagePaths: string[];
};

// Topes del recorte automático (mirror de buildReferences en modo auto).
const AUTO_PRODUCT_CAP = 3;
const AUTO_PACKAGING_CAP = 2;
const AUTO_ANGLES_BEST_CASE = 2;

// Aplana el pool de candidatos en entradas categorizadas para el dialog.
// Deduplica por path (dos locaciones pueden compartir imagen): gana la primera.
export function buildReferencePool(input: ReferencePoolInput): ReferencePoolEntry[] {
  const entries: ReferencePoolEntry[] = [];
  const seen = new Set<string>();
  const push = (e: ReferencePoolEntry) => {
    if (seen.has(e.path)) return;
    seen.add(e.path);
    entries.push(e);
  };

  const productName = input.product.name?.trim() || 'Producto';
  input.product.imagePaths.forEach((path, i) => {
    const usage = input.product.imageUsages?.[path];
    push({
      path,
      category: 'product',
      label: usage ? `${productName} — ${usage}` : productName,
      autoIncluded: i < AUTO_PRODUCT_CAP,
    });
  });
  input.packagingImagePaths.forEach((path, i) => {
    push({ path, category: 'packaging', label: 'Empaque', autoIncluded: i < AUTO_PACKAGING_CAP });
  });
  for (const c of input.characters) {
    push({
      path: c.masterImagePath,
      category: 'character_master',
      label: `${c.name} — hoja maestra`,
      locked: true,
      autoIncluded: true,
    });
    (c.angleImagePaths ?? []).forEach((path, i) => {
      push({
        path,
        category: 'character_angle',
        label: `${c.name} — ángulo ${i + 1}`,
        autoIncluded: i < AUTO_ANGLES_BEST_CASE,
      });
    });
  }
  for (const loc of input.locations) {
    for (const path of loc.imagePaths) {
      push({ path, category: 'location', label: loc.name, autoIncluded: true });
    }
    if (loc.scaleMap) {
      push({
        path: loc.scaleMap.path,
        category: 'scale_map',
        label: `${loc.name} — mapa de escala`,
        autoIncluded: true,
      });
    }
  }
  for (const path of input.extraImagePaths) {
    push({ path, category: 'extra', label: 'Referencia extra', autoIncluded: true });
  }
  return entries;
}
