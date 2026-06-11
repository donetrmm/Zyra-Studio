import { redirect } from 'next/navigation';

// Ruta V1: Cast vive ahora en Marca (specs/v2/06-rediseno-ux.md §4.1).
export default function CastLegacyRoute() {
  redirect('/app/brand/cast');
}
