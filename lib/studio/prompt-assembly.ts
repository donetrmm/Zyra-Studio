// Ensamblado del prompt final del estudio: el usuario ve/edita su prompt CRUDO
// (queda en generations.prompt para mostrar en el chat), pero cuando enciende el
// toggle "mantener idéntico" el worker envía al proveedor el prompt + la cláusula
// de identidad del activo. Así el guard es OPT-IN (spec) y el chat no muestra
// texto interno de guard. Fase 2 solo cubre producto; locación/personaje se
// generalizan en Fase 4 (más cláusulas en IDENTITY_CLAUSE_BY_TYPE).

// Cláusula de identidad de PRODUCTO (misma que refineProductImage en
// components/creation/generate.ts): preserva forma, color, etiqueta, logo,
// materiales y proporciones, y prohíbe inventar texto de marca.
export const PRODUCT_IDENTITY_CLAUSE =
  'Keep the product identity perfectly consistent — identical shape, colors, label, logo, ' +
  'materials and proportions. Do not alter or invent any label text.';

const IDENTITY_CLAUSE_BY_TYPE: Record<string, string> = {
  product: PRODUCT_IDENTITY_CLAUSE,
};

export function assembleStudioPrompt(
  rawPrompt: string,
  opts: { keepIdentical?: boolean; assetType?: string | null },
): string {
  const raw = rawPrompt.trim();
  if (!opts.keepIdentical) return raw;
  const clause = opts.assetType ? IDENTITY_CLAUSE_BY_TYPE[opts.assetType] : undefined;
  if (!clause) return raw;
  return `${raw} ${clause}`;
}
