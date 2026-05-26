'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { FolderKanban, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { createCampaignAction, updateCampaignAction, deleteCampaignAction } from '@/server-actions/campaigns';
import { cn } from '@/lib/utils';

type CampaignRow = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  generationCount: number;
};

export function CampaignsPage({ campaigns: initial }: { campaigns: CampaignRow[] }) {
  const [campaigns, setCampaigns] = useState(initial);
  const [editing, setEditing] = useState<CampaignRow | 'new' | null>(null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Campañas</h1>
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
            Organiza tus generaciones por campaña o proyecto. Agrupa contenido por contexto para mantener orden.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden />
          Nueva campaña
        </button>
      </div>

      {editing && (
        <CampaignEditor
          campaign={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => window.location.reload()}
        />
      )}

      {campaigns.length === 0 && !editing ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground/60">
          <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
            <FolderKanban className="size-7" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/70">No tienes campañas</p>
          <p className="max-w-xs text-[12.5px]">Crea tu primera campaña para organizar generaciones</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="group overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20"
            >
              <Link href={`/app/campaigns/${c.id}`} className="block">
                <div className="h-2" style={{ backgroundColor: c.color }} />
                <div className="p-4">
                  <h3 className="truncate text-[14px] font-medium text-foreground">{c.name}</h3>
                {c.description && (
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{c.description}</p>
                )}
                <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/50">
                  <span>{c.generationCount} generacion{c.generationCount !== 1 ? 'es' : ''}</span>
                  <span>{new Date(c.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                </div>
              </Link>
              <div className="flex gap-2 border-t border-border/30 p-3">
                <button type="button" onClick={() => setEditing(c)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground">
                  <Pencil className="size-3" aria-hidden /> Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(`Eliminar "${c.name}"?`)) return;
                    deleteCampaignAction(c.id).then((res) => {
                      if (res.ok) { setCampaigns((cs) => cs.filter((x) => x.id !== c.id)); toast.success('Campaña eliminada'); }
                      else toast.error(res.message || 'Error');
                    });
                  }}
                  className="inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="size-3" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignEditor({ campaign, onClose, onSaved }: { campaign: CampaignRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(campaign?.name ?? '');
  const [description, setDescription] = useState(campaign?.description ?? '');
  const [color, setColor] = useState(campaign?.color ?? '#7c3aed');
  const [saving, startSave] = useTransition();

  function handleSave() {
    const payload = { name, description: description || undefined, color };
    startSave(async () => {
      const res = campaign
        ? await updateCampaignAction(campaign.id, payload)
        : await createCampaignAction(payload);
      if (!res.ok) { toast.error(res.message || 'Error'); return; }
      toast.success(campaign ? 'Campaña actualizada' : 'Campaña creada');
      onSaved();
    });
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-3.5">
        <h2 className="text-[15px] font-medium text-foreground">{campaign ? 'Editar' : 'Nueva'} campaña</h2>
      </div>
      <div className="space-y-3 p-5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la campaña" className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción (opcional)" className="w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none" rows={2} />
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Color</label>
          <div className="flex items-center gap-1.5">
            <div className="size-7 rounded-md border border-border" style={{ backgroundColor: color }} />
            <input type="text" value={color} onChange={(e) => setColor(e.target.value)} maxLength={7} className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none" />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={handleSave} disabled={saving || !name.trim()} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground hover:bg-muted">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
