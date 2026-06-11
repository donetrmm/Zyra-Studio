import { redirect } from 'next/navigation';

// Ruta V1: Presets vive ahora dentro de Creación rápida (specs/v2/06 §4.1).
export default function PresetsLegacyRoute() {
  redirect('/app/create/presets');
}
