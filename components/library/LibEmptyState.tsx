'use client';

import { FolderKanban, Image as ImageIcon, Library, Sparkles } from 'lucide-react';
import { PageEmptyState } from '@/components/ui/page-empty-state';
import type { Tab } from '@/lib/library/types';

export function LibEmptyState({ tab }: { tab: Tab }) {
  const cfg: Record<Tab, { icon: typeof Library; title: string; sub: string }> = {
    sessions: {
      icon: Library,
      title: 'Aún no hay sesiones',
      sub: 'Cuando generes imágenes aparecerán agrupadas aquí.',
    },
    grid: {
      icon: ImageIcon,
      title: 'Tu cuadrícula está vacía',
      sub: 'Crea tu primera imagen para verla aquí.',
    },
    collections: {
      icon: FolderKanban,
      title: 'Sin colecciones',
      sub: 'Agrupa generaciones sueltas por proyecto o cliente.',
    },
  };
  return (
    <PageEmptyState
      icon={cfg[tab].icon}
      title={cfg[tab].title}
      sub={cfg[tab].sub}
      cta={{ href: '/app/create/image', label: 'Crear imagen', icon: Sparkles }}
    />
  );
}
