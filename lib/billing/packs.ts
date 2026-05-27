// Catálogo de packs de créditos. Vive fuera de server-actions/ porque ese
// archivo usa 'use server' y Next solo permite exports async ahí (un objeto
// quedaría undefined del lado cliente al importarlo).

export const PACK_CATALOG = {
  starter: { credits: 500, priceMxn: 49 },
  creator: { credits: 2000, priceMxn: 179 },
  pro: { credits: 5000, priceMxn: 399 },
  studio: { credits: 15000, priceMxn: 999 },
} as const;

export type PackId = keyof typeof PACK_CATALOG;
export const PACKS = PACK_CATALOG;
