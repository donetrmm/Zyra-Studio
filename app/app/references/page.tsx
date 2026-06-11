import { redirect } from 'next/navigation';

// Ruta V1: Referencias vive ahora en Marca (specs/v2/06-rediseno-ux.md §4.1).
export default function ReferencesLegacyRoute() {
  redirect('/app/brand/references');
}
