'use client';

import { useEffect, useState } from 'react';
import { Palette } from 'lucide-react';
import { listBrandKitsAction } from '@/server-actions/brand-kits';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const NONE = '__none__';

type BrandKitOption = {
  id: string;
  name: string;
  colors: { name: string; hex: string }[];
  fonts: string[];
  tone_description: string | null;
  style_guidelines: string | null;
};

export type SelectedBrandKit = BrandKitOption | null;

export function BrandKitSelector({
  value,
  onChange,
}: {
  value: SelectedBrandKit;
  onChange: (kit: SelectedBrandKit) => void;
}) {
  const [kits, setKits] = useState<BrandKitOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    listBrandKitsAction().then((res) => {
      if (res.ok) setKits(res.data as BrandKitOption[]);
      setLoaded(true);
    });
  }, []);

  if (!loaded || kits.length === 0) return null;

  return (
    <div className="mt-4">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Brand Kit
      </label>
      <Select
        value={value?.id ?? NONE}
        onValueChange={(v) => {
          if (v === NONE) return onChange(null);
          const kit = kits.find((k) => k.id === v) ?? null;
          onChange(kit);
        }}
      >
        <SelectTrigger className="mt-1.5 h-auto w-full rounded-md border-border bg-background px-3 py-2 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Sin brand kit</SelectItem>
          {kits.map((k) => (
            <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && value.colors.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Palette className="size-3 text-muted-foreground/50" aria-hidden />
          {value.colors.slice(0, 5).map((c, i) => (
            <div
              key={i}
              className="size-4 rounded-full border border-border"
              style={{ backgroundColor: c.hex }}
              title={c.name}
            />
          ))}
          {value.tone_description && (
            <span className="ml-1 truncate text-[10px] text-muted-foreground/50">
              {value.tone_description.slice(0, 40)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
