'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ImageIcon, Mic, Sparkles, Video } from 'lucide-react';
import { cn } from '@/lib/utils';

const MODES = [
  { label: 'Imagen', href: '/app/create/image', icon: ImageIcon },
  { label: 'Video', href: '/app/create/video', icon: Video },
  { label: 'Audio', href: '/app/create/audio', icon: Mic },
  { label: 'Presets', href: '/app/create/presets', icon: Sparkles },
] as const;

// Switcher de la Creación rápida: imagen/video/audio/presets son tabs de un
// solo lugar en la navegación, no tres ítems del sidebar (specs/v2/06 §4.5).
export function CreateModeTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Tipo de creación"
      className={cn('flex gap-0.5 rounded-[9px] border border-border bg-muted/30 p-[3px]', className)}
    >
      {MODES.map(({ label, href, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors',
              active
                ? 'border border-border bg-background text-foreground'
                : 'border border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
