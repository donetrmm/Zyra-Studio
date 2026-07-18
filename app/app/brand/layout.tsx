import { SectionTabs } from '@/components/layout/SectionTabs';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

// Marca: los activos que el sistema inyecta en cada generación.
// Brand Kits y Cast son la columna vertebral de las campañas (V2 §4.4);
// las voces clonadas y las referencias sueltas también son activos de marca.
// Los contadores por pestaña se resuelven con head-counts (sin traer filas) para
// que se vea de un vistazo qué está poblado. Espejan el filtro de cada ruta:
// characters/locations/brand_kits/media_references por workspace; voice_clones
// por usuario.
export default async function BrandLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [kits, cast, locations, voices, references] = await Promise.all([
    supabase.from('brand_kits').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
    supabase.from('characters').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
    supabase.from('locations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
    supabase.from('voice_clones').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('media_references').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <SectionTabs
        tabs={[
          { label: 'Brand Kits', href: '/app/brand/kits', count: kits.count ?? undefined },
          { label: 'Cast', href: '/app/brand/cast', count: cast.count ?? undefined },
          { label: 'Locaciones', href: '/app/brand/locations', count: locations.count ?? undefined },
          { label: 'Voces', href: '/app/brand/voices', count: voices.count ?? undefined },
          { label: 'Referencias', href: '/app/brand/references', count: references.count ?? undefined },
        ]}
      />
      {children}
    </div>
  );
}
