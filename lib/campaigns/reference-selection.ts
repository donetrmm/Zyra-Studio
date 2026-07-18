// Selección manual de referencias de video (por campaña). Lógica pura: el IO
// (columna campaigns.reference_selection, pool desde brand kit/cast/locaciones)
// vive en lib/campaigns/reference-pool.ts y las server actions.
//
// CLAVE: la selección se aplica UPSTREAM (filtra el DirectorContext antes de
// compile) — nunca post-filtro sobre las referencias compiladas, porque
// buildReferences emite citas @image1..N amarradas al orden de construcción y
// un post-filtro las desalinea todas.
import type { DirectorContext } from '@/lib/prompt-director';
import type { CharacterInventory, ProductInventory } from '@/lib/prompt-director/types';
import { describeCharacter, describeProduct, describeProductCompact } from '@/lib/prompt-director/inventory';
import { perProductImageCap } from './ref-budget';

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
    ...(ctx.products
      ? {
          products: ctx.products.map((product) => ({
            ...product,
            imagePaths: keep(product.imagePaths),
            ...(product.packagingImagePaths
              ? { packagingImagePaths: keep(product.packagingImagePaths) }
              : {}),
          })),
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

// Dónde viaja cada categoría — contrato de honestidad del dialog. Los PANELES
// (compiler FLUX de storyboard) solo adjuntan producto, hoja maestra del cast y
// locación; empaque/ángulos/mapa/extras son de video (Seedance). Y en paneles
// encadenados/refinados ni siquiera esas viajan salvo por los toggles del beat
// (refSlots=0 en chat): el dialog lo explica en copy, no aquí.
export const CATEGORY_APPLIES: Record<ReferencePoolCategory, { video: boolean; panel: boolean }> = {
  product: { video: true, panel: true },
  packaging: { video: true, panel: false },
  character_master: { video: true, panel: true },
  character_angle: { video: true, panel: false },
  location: { video: true, panel: true },
  scale_map: { video: true, panel: false },
  extra: { video: true, panel: false },
};

// Las cláusulas de TEXTO que anclan identidad (lo que viaja aunque las imágenes
// no: encadenado/refinado usan exactamente estas, via chainedProductFidelity /
// chainedCharacterFidelity). fidelity:false = la variante sin "as in the
// reference images", que es la que sobrevive en chat. Read-only en la UI: se
// editan en el Brand Kit / Cast / Locaciones, no por envío (bifurcar la verdad
// hace derivar el siguiente panel).
export type ReferencePoolTexts = {
  products: { name: string; text: string }[];
  characters: { name: string; text: string }[];
  locations: { name: string; description: string | null }[];
};

export function buildReferencePoolTexts(input: {
  products: ProductInventory[];
  characters: CharacterInventory[];
  locations: { name: string; description: string | null }[];
}): ReferencePoolTexts {
  return {
    products: input.products.map((p, i) => ({
      name: p.name,
      text: input.products.length > 1 ? describeProductCompact(p, i, input.products.length) : describeProduct(p, { fidelity: false }),
    })),
    characters: input.characters.map((c) => ({
      name: c.name,
      text: describeCharacter(c, { fidelity: false }).text,
    })),
    locations: input.locations,
  };
}

export type ReferencePoolEntry = {
  path: string;
  category: ReferencePoolCategory;
  label: string;
  // Masters del cast: siempre viajan, la UI los muestra marcados y deshabilitados.
  locked?: boolean;
  // Lo que el recorte AUTOMÁTICO mandaría (aprox.: los ángulos de cast dependen
  // del presupuesto por clip; se marca el mejor caso y la UI lo aclara en copy).
  autoIncluded: boolean;
  // Uso PERSISTIDO de la imagen (usage_description): lo que ya se aplicó de un
  // análisis previo o se escribió a mano. Visible en el dialog sin re-analizar.
  usage?: string;
};

export type ReferencePoolInput = {
  products: {
    name?: string;
    imagePaths: string[];
    imageUsages?: Record<string, string>;
    packagingImagePaths: string[];
  }[];
  characters: { name: string; masterImagePath: string; angleImagePaths?: string[] }[];
  locations: { name: string; imagePaths: string[]; scaleMap?: { path: string } }[];
  extraImagePaths: string[];
};

// Topes del recorte automático (mirror de buildReferences en modo auto). El de
// producto ahora depende de cuántos productos trae el clip (Task 3, ref-budget.ts):
// perProductImageCap. AUTO_PRODUCT_CAP queda borrado — lo sustituye ese import.
const AUTO_PACKAGING_CAP = 2;
const AUTO_ANGLES_BEST_CASE = 2;

// Aplana el pool de candidatos en entradas categorizadas para el dialog.
// Deduplica por path (dos productos/locaciones pueden compartir imagen): gana
// la primera — por eso el orden en input.products importa para el empate.
export function buildReferencePool(input: ReferencePoolInput): ReferencePoolEntry[] {
  const entries: ReferencePoolEntry[] = [];
  const seen = new Set<string>();
  const push = (e: ReferencePoolEntry) => {
    if (seen.has(e.path)) return;
    seen.add(e.path);
    entries.push(e);
  };

  // Multi-producto (spec 2026-07-15): el tope por imagen baja con más productos
  // (menos vistas de cada uno = menos confusión de conteo en Seedance) y el
  // empaque se omite del recorte automático salvo con un solo producto — mismo
  // criterio que estimateItemImageRefs, así el badge y este pool no divergen.
  const multi = input.products.length > 1;
  const productCap = perProductImageCap(input.products.length);
  for (const product of input.products) {
    const productName = product.name?.trim() || 'Producto';
    product.imagePaths.forEach((path, i) => {
      const usage = product.imageUsages?.[path];
      push({
        path,
        category: 'product',
        label: usage ? `${productName} — ${usage}` : productName,
        autoIncluded: i < productCap,
        ...(usage ? { usage } : {}),
      });
    });
    product.packagingImagePaths.forEach((path, i) => {
      push({
        path,
        category: 'packaging',
        label: multi ? `Empaque — ${productName}` : 'Empaque',
        autoIncluded: !multi && i < AUTO_PACKAGING_CAP,
      });
    });
  }
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
