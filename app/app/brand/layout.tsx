import { SectionTabs } from '@/components/layout/SectionTabs';

// Marca: los activos que el sistema inyecta en cada generación.
// Brand Kits y Cast son la columna vertebral de las campañas (V2 §4.4);
// las voces clonadas y las referencias sueltas también son activos de marca.
export default function BrandLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <SectionTabs
        tabs={[
          { label: 'Brand Kits', href: '/app/brand/kits' },
          { label: 'Cast', href: '/app/brand/cast' },
          { label: 'Locaciones', href: '/app/brand/locations' },
          { label: 'Voces', href: '/app/brand/voices' },
          { label: 'Referencias', href: '/app/brand/references' },
        ]}
      />
      {children}
    </div>
  );
}
