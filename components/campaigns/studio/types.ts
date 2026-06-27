export type { StudioItem } from '@/lib/campaigns/studio-item';

export type StudioTemplate = {
  id: string;
  name: string;
  formatName: string;
  usesCount: number;
};

export type StudioCharacterOption = { id: string; name: string; states: string[] };
export type StudioLocationOption = { id: string; name: string };

export type StudioCampaign = {
  id: string;
  name: string;
  status: string;
  goal: string | null;
  productName: string;
  category: string;
  creditsEstimated: number | null;
  // Idea con que se generó el plan (P: reprocesar idea). null = se generó por mix.
  ideaText: string | null;
};

// Mirror de server-actions/campaigns.ts (requestFinalAction): el final se renderiza con
// Seedance reference-to-video; el costo per-item = duración × tarifa/segundo de la resolución.
export const FINAL_MODEL = 'bytedance/seedance-2.0/reference-to-video';

export const STATUS_LABEL: Record<string, { label: string; tone: string; live?: boolean }> = {
  planned: { label: 'planificado', tone: 'text-muted-foreground/70 border-border' },
  sample: { label: 'muestra…', tone: 'text-brand/90 border-brand/30', live: true },
  queued: { label: 'generando…', tone: 'text-brand/90 border-brand/30', live: true },
  draft_ready: { label: 'borrador listo', tone: 'text-emerald-400/90 border-emerald-400/30' },
  approved: { label: 'versión final…', tone: 'text-brand/90 border-brand/30', live: true },
  final_ready: { label: 'versión final lista', tone: 'text-brand border-brand/40' },
  failed: { label: 'falló', tone: 'text-red-400/90 border-red-400/30' },
  skipped: { label: 'bloqueado', tone: 'text-amber-400/90 border-amber-400/30' },
};

export const GOAL_LABEL: Record<string, string> = {
  '': 'Sin objetivo',
  awareness: 'Reconocimiento',
  conversion: 'Conversión',
  mixed: 'Mixto',
};

export const STUDIO_TABS = ['plan', 'produccion', 'plantillas', 'calendario'] as const;
