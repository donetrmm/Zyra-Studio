// Constructor client-safe de la URL pública de un thumbnail. El bucket
// 'thumbnails' es público, así que la URL es concatenación directa con
// NEXT_PUBLIC_SUPABASE_URL. Existe aparte de publicThumbnailUrl (server-only,
// vive en lib/supabase/storage.ts junto al admin client) para poder usarse en
// componentes cliente sin arrastrar 'server-only' al bundle.
const THUMBNAILS_BUCKET = 'thumbnails';

export function publicThumbnailUrlClient(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${THUMBNAILS_BUCKET}/${path}`;
}
