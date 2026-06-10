'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, Clapperboard, Loader2, Pencil, Play, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  approveBatchAction,
  deleteCampaignItemAction,
  requestFinalAction,
  updateCampaignItemAction,
} from '@/server-actions/campaigns';

export type StudioItem = {
  id: string;
  formatId: string | null;
  formatName: string;
  durationS: number | null;
  aspectRatio: string | null;
  scene: string | null;
  scenePrompt: string;
  characterName: string | null;
  scheduledDate: string | null;
  status: string;
  warnings: string[];
};

export type StudioCampaign = {
  id: string;
  name: string;
  status: string;
  goal: string | null;
  productName: string;
  category: string;
  creditsEstimated: number | null;
};

const STATUS_LABEL: Record<string, { label: string; tone: string; live?: boolean }> = {
  planned: { label: 'planificado', tone: 'text-muted-foreground/70 border-border' },
  sample: { label: 'muestra…', tone: 'text-sky-400/90 border-sky-400/30', live: true },
  queued: { label: 'generando…', tone: 'text-sky-400/90 border-sky-400/30', live: true },
  draft_ready: { label: 'draft listo', tone: 'text-emerald-400/90 border-emerald-400/30' },
  approved: { label: 'render final…', tone: 'text-violet-400/90 border-violet-400/30', live: true },
  final_ready: { label: 'final listo', tone: 'text-violet-300 border-violet-300/40' },
  failed: { label: 'falló', tone: 'text-red-400/90 border-red-400/30' },
  skipped: { label: 'bloqueado', tone: 'text-amber-400/90 border-amber-400/30' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.planned;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] ${s.tone}`}>
      {s.live && <Loader2 className="size-2.5 animate-spin" aria-hidden />}
      {s.label}
    </span>
  );
}

export function CampaignStudioView({
  campaign,
  initialItems,
}: {
  campaign: StudioCampaign;
  initialItems: StudioItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<'plan' | 'produccion'>('plan');
  const [editing, setEditing] = useState<StudioItem | null>(null);

  // Realtime: progreso de producción sin polling (patrón del repo con setAuth).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`campaign-items:${campaign.id}`).on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'campaign_items', filter: `campaign_id=eq.${campaign.id}` },
      (payload) => {
        const r = payload.new as { id: string; status: string; warnings?: string[] };
        setItems((prev) =>
          prev.map((it) =>
            it.id === r.id ? { ...it, status: r.status, warnings: (r.warnings as string[]) ?? it.warnings } : it,
          ),
        );
      },
    );
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
    });
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });
    return () => {
      authSub.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [campaign.id]);

  const byFormat = useMemo(() => {
    const map = new Map<string, { formatId: string; formatName: string; items: StudioItem[] }>();
    for (const item of items) {
      const key = item.formatId ?? 'sin-formato';
      const entry = map.get(key) ?? { formatId: item.formatId ?? '', formatName: item.formatName, items: [] };
      entry.items.push(item);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [items]);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/app/campaigns"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Campañas
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">{campaign.name}</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {campaign.productName} · {items.length} creativos
            {campaign.creditsEstimated ? ` · ~${campaign.creditsEstimated} cr (draft)` : ''}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-card p-0.5">
          {(['plan', 'produccion'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
                tab === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'plan' ? 'Plan' : 'Producción'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'plan' ? (
        <PlanTable items={items} onEdit={setEditing} onDeleted={(id) => setItems((p) => p.filter((i) => i.id !== id))} />
      ) : (
        <ProductionView campaignId={campaign.id} groups={byFormat} />
      )}

      {editing && (
        <EditItemDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            setItems((prev) => prev.map((i) => (i.id === editing.id ? { ...i, ...patch, status: 'planned' } : i)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PlanTable({
  items,
  onEdit,
  onDeleted,
}: {
  items: StudioItem[];
  onEdit: (item: StudioItem) => void;
  onDeleted: (id: string) => void;
}) {
  const editable = (s: string) => ['planned', 'skipped', 'failed'].includes(s);

  async function handleDelete(item: StudioItem) {
    const res = await deleteCampaignItemAction(item.id);
    if (!res.ok) {
      toast.error('No se pudo eliminar');
      return;
    }
    onDeleted(item.id);
  }

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-border">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b border-border bg-muted/20 text-[11px] uppercase tracking-wide text-muted-foreground/60">
          <tr>
            <th className="px-3 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Formato</th>
            <th className="hidden px-3 py-2 font-medium md:table-cell">Escena / acción</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border/50 last:border-0">
              <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3 text-muted-foreground/40" aria-hidden />
                  {item.scheduledDate
                    ? new Date(`${item.scheduledDate}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
                    : '—'}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-foreground/90">
                {item.formatName}
                {item.characterName && (
                  <span className="ml-1.5 text-[11px] text-muted-foreground/60">· {item.characterName}</span>
                )}
              </td>
              <td className="hidden max-w-md px-3 py-2.5 md:table-cell">
                <p className="line-clamp-2 text-muted-foreground/80">{item.scenePrompt}</p>
                {item.warnings.length > 0 && (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-amber-400/70">{item.warnings[0]}</p>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <StatusBadge status={item.status} />
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right">
                {editable(item.status) && (
                  <span className="inline-flex gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      aria-label="Editar item"
                      className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      aria-label="Eliminar item"
                      className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductionView({
  campaignId,
  groups,
}: {
  campaignId: string;
  groups: Array<{ formatId: string; formatName: string; items: StudioItem[] }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function handleBatch(formatId: string, mode: 'sample' | 'full') {
    setBusy(`${formatId}:${mode}`);
    const res = await approveBatchAction({ campaignId, formatId, mode });
    setBusy(null);
    if (!res.ok) {
      toast.error(
        res.error === 'insufficient_credits' ? 'Créditos insuficientes para el lote' : res.message ?? 'No se pudo encolar',
      );
      return;
    }
    toast.success(
      `${res.data.enqueued} en cola · ${res.data.creditsReserved} cr reservados${
        res.data.skipped ? ` · ${res.data.skipped} omitidos` : ''
      }`,
    );
  }

  async function handleFinal(itemId: string) {
    setBusy(`final:${itemId}`);
    const res = await requestFinalAction({ itemId });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error === 'insufficient_credits' ? 'Créditos insuficientes' : res.message ?? 'No se pudo encolar el final');
      return;
    }
    toast.success('Render final en cola (720p, mismo seed)');
  }

  return (
    <div className="mt-5 space-y-4">
      {groups.map((group) => {
        const pending = group.items.filter((i) => ['planned', 'failed'].includes(i.status)).length;
        const generating = group.items.filter((i) => ['sample', 'queued', 'approved'].includes(i.status)).length;
        const drafts = group.items.filter((i) => i.status === 'draft_ready');
        const finals = group.items.filter((i) => i.status === 'final_ready').length;
        return (
          <div key={group.formatId || group.formatName} className="rounded-xl border border-border bg-card/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-lg bg-muted/40">
                  <Clapperboard className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <div>
                  <p className="text-[13.5px] font-medium text-foreground">{group.formatName}</p>
                  <p className="text-[11.5px] text-muted-foreground/60">
                    {group.items.length} items · {pending} pendientes
                    {generating > 0 && ` · ${generating} generando`}
                    {drafts.length > 0 && ` · ${drafts.length} drafts`}
                    {finals > 0 && ` · ${finals} finales`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending === 0 || busy !== null}
                  onClick={() => handleBatch(group.formatId, 'sample')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === `${group.formatId}:sample` ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Play className="size-3.5" aria-hidden />
                  )}
                  Muestra (2)
                </button>
                <button
                  type="button"
                  disabled={pending === 0 || busy !== null}
                  onClick={() => handleBatch(group.formatId, 'full')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === `${group.formatId}:full` ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Play className="size-3.5" aria-hidden />
                  )}
                  Lote completo
                </button>
              </div>
            </div>

            {drafts.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
                {drafts.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <p className="line-clamp-1 flex-1 text-muted-foreground/80">{d.scenePrompt}</p>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => handleFinal(d.id)}
                      className="shrink-0 rounded-lg border border-violet-400/40 px-2.5 py-1 text-[11.5px] text-violet-300 transition-colors hover:bg-violet-400/10 disabled:opacity-40"
                    >
                      {busy === `final:${d.id}` ? 'Encolando…' : 'Aprobar final 720p'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[11.5px] text-muted-foreground/50">
        Los lotes se encolan escalonados (20 s entre videos). Los resultados aparecen en la pestaña de la
        campaña en la biblioteca; el draft se genera en 480p y el final aprobado en 720p con el mismo seed.
      </p>
    </div>
  );
}

function EditItemDialog({
  item,
  onClose,
  onSaved,
}: {
  item: StudioItem;
  onClose: () => void;
  onSaved: (patch: Partial<StudioItem>) => void;
}) {
  const [scenePrompt, setScenePrompt] = useState(item.scenePrompt);
  const [scheduledDate, setScheduledDate] = useState(item.scheduledDate ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await updateCampaignItemAction({
      itemId: item.id,
      scenePrompt,
      ...(scheduledDate ? { scheduledDate: new Date(`${scheduledDate}T12:00:00`) } : {}),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo guardar');
      return;
    }
    onSaved({ scenePrompt, scheduledDate: scheduledDate || item.scheduledDate });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">Editar creativo · {item.formatName}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X className="size-4.5" aria-hidden />
          </button>
        </div>

        <label htmlFor="edit-prompt" className="mt-4 block text-[12.5px] font-medium text-foreground/80">
          Acción de la escena
        </label>
        <textarea
          id="edit-prompt"
          value={scenePrompt}
          onChange={(e) => setScenePrompt(e.target.value)}
          rows={4}
          maxLength={4000}
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
        />

        <label htmlFor="edit-date" className="mt-3 block text-[12.5px] font-medium text-foreground/80">
          Fecha programada
        </label>
        <input
          id="edit-date"
          type="date"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
          className="mt-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || scenePrompt.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
