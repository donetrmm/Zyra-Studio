import { redirect } from 'next/navigation';

// Ruta V1: Voces vive ahora en Marca (specs/v2/06-rediseno-ux.md §4.1).
export default function VoicesLegacyRoute() {
  redirect('/app/brand/voices');
}
