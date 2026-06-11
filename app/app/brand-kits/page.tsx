import { redirect } from 'next/navigation';

// Ruta V1: Brand Kits vive ahora en Marca (specs/v2/06-rediseno-ux.md §4.1).
export default function BrandKitsLegacyRoute() {
  redirect('/app/brand/kits');
}
