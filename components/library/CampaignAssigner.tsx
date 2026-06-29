'use client';

import { useEffect, useState, useTransition } from 'react';
import { FolderKanban } from 'lucide-react';
import { toast } from 'sonner';
import { CAMPAIGN_NONE } from '@/lib/library/format';
import { assignCampaignAction, listCampaignsAction } from '@/server-actions/campaigns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LibraryGeneration } from '@/lib/library/types';

export function CampaignAssigner({ generation }: { generation: LibraryGeneration }) {
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; color: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [assigning, startAssign] = useTransition();

  useEffect(() => {
    listCampaignsAction().then((res) => {
      if (res.ok) setCampaigns(res.data);
      setLoaded(true);
    });
  }, []);

  if (!loaded || campaigns.length === 0) return null;

  function handleChange(campaignId: string) {
    startAssign(async () => {
      const res = await assignCampaignAction(generation.id, campaignId || null);
      if (res.ok) toast.success(campaignId ? 'Asignado a la colección' : 'Colección removida');
      else toast.error(res.message || 'Error');
    });
  }

  return (
    <div className="mt-3">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <FolderKanban className="size-3" aria-hidden />
        Colección
      </label>
      <Select
        value={generation.campaignId ?? CAMPAIGN_NONE}
        onValueChange={(v) => handleChange(v === CAMPAIGN_NONE ? '' : v)}
        disabled={assigning}
      >
        <SelectTrigger className="mt-1.5 h-auto w-full rounded-md border-border bg-background px-3 py-2 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CAMPAIGN_NONE}>Sin colección</SelectItem>
          {campaigns.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
