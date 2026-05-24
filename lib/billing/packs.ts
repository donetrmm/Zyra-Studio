// Catálogo de packs de créditos. Vive fuera de server-actions/ porque ese
// archivo usa 'use server' y Next solo permite exports async ahí (un objeto
// quedaría undefined del lado cliente al importarlo).

export const PACK_CATALOG = {
  starter: { credits: 2000, priceMxn: 99 },
  creator: { credits: 10000, priceMxn: 399 },
  pro: { credits: 50000, priceMxn: 1499 },
  studio: { credits: 200000, priceMxn: 4999 },
} as const;

export type PackId = keyof typeof PACK_CATALOG;
export const PACKS = PACK_CATALOG;
