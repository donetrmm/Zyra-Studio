// Normalización compartida para comparar menciones de texto: quita diacríticos,
// baja a minúsculas y trimea. Antes duplicada en planner.ts (normName) e
// ingest.ts (norm).
export function normalizeText(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
