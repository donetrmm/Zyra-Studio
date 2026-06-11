import { redirect } from 'next/navigation';

// La Creación rápida abre en imagen; el switcher interno cambia de modo.
export default function CreateIndexRoute() {
  redirect('/app/create/image');
}
