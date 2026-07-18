// Slug estable para el matcher (los LLM citan slugs, no UUIDs). Espeja la
// expresión del backfill de la migración 060, con recorte de guiones de borde.
export function productSlug(name: string): string {
  const s = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'producto';
}
