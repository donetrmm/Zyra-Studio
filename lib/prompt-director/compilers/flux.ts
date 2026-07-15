// Compiler de FLUX (specs/v2/02 tarea 5): generación de imagen desde cero.
// Estructura: sujeto + entorno + iluminación (palanca de calidad #1) + estilo
// + paleta. Sin keyword soup (el antislop limpia al final en index.ts).

import { describeCharacter, describeProduct, describeProductCompact, multiProductCountClause, productUsageClause } from '../inventory';
import { creativeGuidelineClauses } from '@/lib/campaigns/guidelines';
import { SCENE_INTEGRATION_CLAUSE } from '../spatial';
import type { CompiledPrompt, CompiledReference, CompileRequest, DirectorContext } from '../types';

// FLUX trabaja con width/height explícitos (lib/providers/types.ts).
const DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
  '4:3': { width: 1152, height: 896 },
  '3:4': { width: 896, height: 1152 },
  '21:9': { width: 1536, height: 640 },
};

export function compileFlux(req: CompileRequest, ctx: DirectorContext): CompiledPrompt {
  const sections: string[] = [];
  const products = ctx.products ?? [];
  const product = products[0];

  sections.push(req.scenePrompt.trim().replace(/\.?$/, '.'));
  if (ctx.scene?.fragment) sections.push(`Setting: ${ctx.scene.fragment}.`);
  if (products.length === 1) {
    sections.push(describeProduct(product));
  } else if (products.length > 1) {
    // Multi: ficha compacta por producto + anti-conteo (mismo criterio que
    // Seedance, spec multi-producto 2026-07-15).
    for (const p of products) sections.push(describeProductCompact(p));
    sections.push(multiProductCountClause(products.map((p) => p.name)));
  }
  // Personajes: descripción al prompt + (abajo) la hoja maestra como referencia,
  // para que FLUX mantenga la IDENTIDAD entre imágenes. Sin esto el storyboard
  // "perdía el hilo del personaje": cada panel inventaba una cara distinta del puro
  // texto. Mismo anclaje que el compiler de Seedance.
  for (const character of (ctx.characters ?? []).slice(0, 3)) {
    if (!character.description?.trim()) continue;
    const { text } = describeCharacter(character, { fidelity: !character.masterImagePath });
    sections.push(text);
  }
  if ((ctx.characters ?? []).some((c) => c.masterImagePath)) {
    sections.push(
      'Keep the people consistent with the provided character reference image(s): same face, hair and build across shots.',
    );
  }
  // Locación: el lugar como escena (consistencia entre paneles del storyboard).
  // Descripción al prompt + imagen como referencia environment (abajo).
  if (ctx.location?.description?.trim()) {
    sections.push(`Location: ${ctx.location.description.trim()}.`);
  }
  if ((ctx.location?.imagePaths?.length ?? 0) > 0) {
    sections.push(
      'The setting must match the provided location reference image: same place, architecture and background.',
    );
  }
  // Perfil de luz de la locación (052): la luz REAL de la escena descrita en
  // texto — el modelo integra a las personas con ESA luz, no con una genérica.
  if (ctx.location?.lightProfile?.trim()) {
    sections.push(`Scene light and space: ${ctx.location.lightProfile.trim().replace(/\.+$/, '')}.`);
  }
  // Integración personaje-locación: solo cuando hay ambos (la cláusula habla
  // de "the people" y "the scene"; sin locación o sin personas sobra).
  if (
    (ctx.characters?.length ?? 0) > 0 &&
    ((ctx.location?.imagePaths?.length ?? 0) > 0 || ctx.location?.description?.trim())
  ) {
    sections.push(SCENE_INTEGRATION_CLAUSE);
  }
  // Iluminación por defecto orientada a producto si el prompt no la trae y la
  // locación no aporta su propio perfil de luz (competirían).
  if (!ctx.location?.lightProfile && !/light|lighting|luz|iluminaci/i.test(req.scenePrompt)) {
    sections.push('Soft directional lighting that shows form, volume and material texture.');
  }
  if (ctx.format?.register) sections.push(`Mood: ${ctx.format.register}.`);

  // Guías creativas opt-in de la campaña: encuadre producto-completo / hook-hero /
  // recorte seguro. El panel es el fotograma de apertura; las tres guías aplican.
  const guidelineClauses = creativeGuidelineClauses(ctx.guidelines, { isOpeningBeat: req.isOpeningBeat });
  if (guidelineClauses) sections.push(guidelineClauses.trim());

  const dims = DIMENSIONS[req.aspectRatio ?? '1:1'] ?? DIMENSIONS['1:1'];

  // Referencias: producto (hasta 4, o 1 por producto en multi) + hoja maestra de
  // cada personaje (hasta 3). El personaje ancla la identidad; va después del
  // producto. Tope 8 (FLUX 2).
  const references: CompiledReference[] = [];
  // Multi: 1 imagen por producto (mitigación anti-conteo, spec 2026-07-15) — con
  // varios productos, varias vistas del mismo producto multiplica la confusión.
  const productPaths =
    products.length > 1
      ? products.map((p) => p.imagePaths[0]).filter((p): p is string => !!p)
      : (product?.imagePaths.slice(0, 4) ?? []);
  for (const storagePath of productPaths) {
    references.push({ storagePath, kind: 'image', role: 'product' });
  }
  // Uso por imagen (usage_description del brand kit): sin esto, una vista de
  // canto/perfil viaja como píxeles sin función y el grosor/construcción que
  // fija se ignora. El compiler de video ya cita usos por @imageN; aquí no hay
  // numeración, así que se enumeran en bloque. En multi se mergean los usages
  // declarados de TODOS los productos (los paths ya son disjuntos, uno por producto).
  const usageClause = productUsageClause(
    productPaths,
    products.length > 1
      ? Object.assign({}, ...products.map((p) => p.imageUsages ?? {}))
      : product?.imageUsages,
  );
  if (usageClause) sections.push(usageClause.trim());
  for (const character of (ctx.characters ?? []).slice(0, 3)) {
    if (character.masterImagePath) {
      references.push({
        storagePath: character.masterImagePath,
        kind: 'image',
        role: 'character',
        scope: 'rostro, peinado y complexión; no la ropa ni el fondo',
      });
      // Vestuario (specs/v2/16): cuerpo completo INMEDIATAMENTE tras la maestra —
      // mismo patrón que el compiler de Seedance (seedance.ts, bucle de characters:
      // pushImage de la maestra seguido del cuerpo completo). FLUX no numera sus
      // referencias (@imageN es un mecanismo exclusivo de Seedance), así que la
      // cita nombra al personaje en el texto del prompt en vez de citar un índice.
      // Sin presupuesto nuevo: la posición (antes de cualquier otra ref) es la
      // prioridad y el tope references.slice(0, 8) de abajo sigue siendo la red.
      if (character.fullBodyImagePath) {
        references.push({
          storagePath: character.fullBodyImagePath,
          kind: 'image',
          role: 'character',
          scope: 'vestuario, silueta y proporciones de cuerpo completo',
        });
        sections.push(
          `The image is ${character.name}'s full-body wardrobe reference — keep this exact same clothing, silhouette and body proportions; identity (face and hair) comes from the master reference.`,
        );
      }
    }
  }
  // Locación: imagen del lugar como referencia de escena (después de producto/personaje).
  for (const path of ctx.location?.imagePaths ?? []) {
    references.push({ storagePath: path, kind: 'image', role: 'environment' });
  }

  return {
    modelSlug: req.modelSlug,
    prompt: sections.filter(Boolean).join(' '),
    params: {
      width: dims.width,
      height: dims.height,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    },
    references: references.slice(0, 8),
    warnings: [],
  };
}
