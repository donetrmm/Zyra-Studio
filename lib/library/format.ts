import type { LibraryGeneration } from './types';

export const CAMPAIGN_NONE = '__none__';

const MODEL_LABEL: Record<string, string> = {
  'gemini-3-pro-image-preview': 'Nano Banana Pro',
  'gemini-3.1-flash-image-preview': 'Nano Flash',
  'flux-2-pro-preview': 'FLUX 2 Pro',
};

export function modelLabel(g: { provider: string; model: string }): string {
  return MODEL_LABEL[g.model] ?? `${g.provider}/${g.model}`;
}

// Mapeo modelo provider -> ModelKey usado por el create page.
// Si no matchea (modelo legacy o eliminado), cae a 'auto' y deja que
// el router decida.
export function generationToModelKey(g: { provider: string; model: string }): string {
  if (g.provider === 'flux') return 'flux';
  if (g.model === 'gemini-3.1-flash-image-preview') return 'nano-flash';
  if (g.model === 'gemini-3-pro-image-preview') return 'nano-pro';
  return 'auto';
}

export function extFromMime(type: string): string {
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('wav')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  return 'jpg';
}

export function batchLabel(kind: string): string {
  switch (kind) {
    case 'storyboard': return 'SB';
    case 'variations': return 'VAR';
    case 'smart_crop': return 'CROP';
    default: return 'BATCH';
  }
}

export function reuseHref(g: LibraryGeneration): string {
  const params = new URLSearchParams();
  if (g.prompt) params.set('prompt', g.prompt);
  if (g.aspectRatio) params.set('aspect', g.aspectRatio);
  params.set('model', generationToModelKey(g));
  const base =
    g.type === 'video' ? '/app/create/video'
    : g.type === 'audio' ? '/app/create/audio'
    : '/app/create/image';
  return `${base}?${params.toString()}`;
}

export function bucketOf(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const t = date.getTime();
  if (t >= today0) return 'Hoy';
  if (t >= today0 - dayMs) return 'Ayer';
  if (t >= today0 - 7 * dayMs) return 'Esta semana';
  if (date.getFullYear() === now.getFullYear()) {
    const m = date.toLocaleString('es-MX', { month: 'long' });
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  return `${date.toLocaleString('es-MX', { month: 'short' })} ${date.getFullYear()}`;
}

export function shortTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const t = date.getTime();
  const hhmm = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  if (t >= today0) return `Hoy · ${hhmm}`;
  if (t >= today0 - dayMs) return `Ayer · ${hhmm}`;
  if (t >= today0 - 7 * dayMs) {
    return date.toLocaleDateString('es-MX', { weekday: 'short' }) + ` · ${hhmm}`;
  }
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

// Convierte 'w:h' al ratio numerico que usa style.aspectRatio. null -> 1,
// divisor 0 o basura -> 1 (replica el calculo inline de LibTile/DetailAside).
export function aspectRatioToNumber(raw: string | null): number {
  const aspect = raw ?? '1:1';
  const [w, h] = aspect.split(':').map(Number);
  return h > 0 ? w / h : 1;
}
