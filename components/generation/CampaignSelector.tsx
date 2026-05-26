'use client';

import { useEffect, useState } from 'react';
import { FolderKanban } from 'lucide-react';
import { listCampaignsAction } from '@/server-actions/campaigns';

export type SelectedCampaign = { id: string; name: string } | null;

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
      <select
        value={value?.id ?? ''}
        onChange={(e) => {
          const c = campaigns.find((x) => x.id === e.target.value) ?? null;
          onChange(c ? { id: c.id, name: c.name } : null);
        }}
        className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none"
      >
        <option value="">Sin campaña</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}
