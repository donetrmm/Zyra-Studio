'use client';

import { useEffect, useState } from 'react';
import { FolderKanban } from 'lucide-react';
import { listCampaignsAction } from '@/server-actions/campaigns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type SelectedCampaign = { id: string; name: string } | null;

const NONE = '__none__';

export function CampaignSelector({
  value,
  onChange,
}: {
  value: SelectedCampaign;
  onChange: (c: SelectedCampaign) => void;
}) {
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; color: string }[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    listCampaignsAction().then((res) => {
      if (res.ok) setCampaigns(res.data);
      setLoaded(true);
    });
  }, []);

  if (!loaded || campaigns.length === 0) return null;

  return (
    <div className="mt-4">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <FolderKanban className="size-3" aria-hidden />
        Campaña
      </label>
      <Select
        value={value?.id ?? NONE}
        onValueChange={(v) => {
          if (v === NONE) return onChange(null);
          const c = campaigns.find((x) => x.id === v) ?? null;
          onChange(c ? { id: c.id, name: c.name } : null);
        }}
      >
        <SelectTrigger className="mt-1.5 h-auto w-full rounded-md border-border bg-background px-3 py-2 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Sin campaña</SelectItem>
          {campaigns.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
