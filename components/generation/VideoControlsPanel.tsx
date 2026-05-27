'use client';

import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, ImagePlus, Loader2, Volume2, VolumeOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';
import { cn } from '@/lib/utils';
import { CampaignSelector, type SelectedCampaign } from './CampaignSelector';
import { EnhanceButton } from './EnhanceButton';

export type ModelKey =
  | 'fal-ai/kling-video/v3/standard/text-to-video'
  | 'fal-ai/kling-video/v3/pro/text-to-video'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-lite-generate-preview';

export type ReferenceImage = {
  storagePath: string;
  previewUrl: string;
  filename: string;
};

export const VIDEO_STYLES = [
  { id: 'cinematic', label: 'Cinematográfico', suffix: 'cinematic lighting, film grain, wide angle lens, shallow depth of field' },
  { id: 'realistic', label: 'Realista', suffix: 'photorealistic, natural lighting, high detail, lifelike textures' },
  { id: 'people', label: 'Personas', suffix: 'detailed human faces, natural expressions, realistic skin texture' },
  { id: 'slowmo', label: 'Cámara lenta', suffix: 'slow motion, smooth fluid movement, 120fps look' },
  { id: 'aerial', label: 'Aéreo', suffix: 'aerial drone shot, bird eye view, sweeping landscape' },
  { id: 'dynamic', label: 'Dinámico', suffix: 'dynamic camera movement, tracking shot, fast paced action' },
  { id: 'moody', label: 'Estético', suffix: 'moody color grading, soft desaturated tones, aesthetic atmosphere' },
  { id: 'nature', label: 'Naturaleza', suffix: 'natural environment, organic textures, golden hour lighting' },
] as const;

export type VideoControlsProps = {
  prompt: string;
  setPrompt: (v: string) => void;
  model: ModelKey;
  setModel: (v: ModelKey) => void;
  // Styles
  selectedStyles: string[];
  setSelectedStyles: (v: string[]) => void;
  // Kling
  duration: number;
  setDuration: (v: number) => void;
  generateAudio: boolean;
  setGenerateAudio: (v: boolean) => void;
  // Veo
  veoDuration: 4 | 6 | 8;
  setVeoDuration: (v: 4 | 6 | 8) => void;
  veoResolution: '720p' | '1080p';
  setVeoResolution: (v: '720p' | '1080p') => void;
  // Reference images
  referenceImages: ReferenceImage[];
  setReferenceImages: (v: ReferenceImage[]) => void;
  // Common
  aspectRatio: '16:9' | '9:16' | '1:1';
  setAspectRatio: (v: '16:9' | '9:16' | '1:1') => void;
  campaign: SelectedCampaign;
  setCampaign: (v: SelectedCampaign) => void;
  cost: number;
  balance: number;
  enhanceCost: number;
  pending: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
};

export function VideoControlsPanel(props: VideoControlsProps) {
  const isVeo = props.model.startsWith('veo-');
  const maxImages = isVeo ? 1 : 2;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [useRefImages, setUseRefImages] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
        toast.error('Solo JPG, PNG o WEBP');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error('Máximo 10 MB');
        return;
      }
      if (props.referenceImages.length >= maxImages) {
        toast.error(`Máximo ${maxImages} ${maxImages === 1 ? 'imagen' : 'imágenes'}`);
        return;
      }
      setUploading(true);
      const res = await uploadReferenceFile(file);
      setUploading(false);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      props.setReferenceImages([
        ...props.referenceImages,
        {
          storagePath: res.ref.storagePath,
          previewUrl: res.ref.previewUrl,
          filename: res.ref.filename,
        },
      ]);
    },
    [props, maxImages],
  );

  function removeRef(index: number) {
    const img = props.referenceImages[index];
    if (img) URL.revokeObjectURL(img.previewUrl);
    props.setReferenceImages(props.referenceImages.filter((_, i) => i !== index));
  }

  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto border-r border-border bg-card/30 px-4 py-[18px]">
      <h2 className="font-heading text-[15px] font-medium tracking-tight text-foreground">
        Crear video
      </h2>

      {/* ── Modelo ── */}
      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Modelo
      </label>
      <select
        value={props.model}
        onChange={(e) => props.setModel(e.target.value as ModelKey)}
        className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
      >
        <optgroup label="Kling 3.0 (rápido)">
          <option value="fal-ai/kling-video/v3/standard/text-to-video">Kling 3.0 Standard</option>
          <option value="fal-ai/kling-video/v3/pro/text-to-video">Kling 3.0 Pro</option>
        </optgroup>
        <optgroup label="Veo 3.1 (premium)">
          <option value="veo-3.1-fast-generate-preview">Veo Fast</option>
          <option value="veo-3.1-generate-preview">Veo Standard</option>
          <option value="veo-3.1-lite-generate-preview">Veo Lite</option>
        </optgroup>
      </select>

      {/* ── Duración ── */}
      {isVeo ? (
        <>
          <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Duración
          </label>
          <div className="mt-1.5 flex gap-2">
            {([4, 6, 8] as const).map((d) => {
              const locked = (props.veoResolution === '1080p' || props.referenceImages.length > 0) && d !== 8;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => !locked && props.setVeoDuration(d)}
                  title={locked ? '1080p o imagen requiere 8s' : undefined}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-1.5 text-[12.5px] transition-colors',
                    locked
                      ? 'cursor-not-allowed border-border/50 text-muted-foreground/30'
                      : props.veoDuration === d
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                  )}
                >
                  {d}s
                </button>
              );
            })}
          </div>
          <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Resolución
          </label>
          <div className="mt-1.5 flex gap-2">
            {(['720p', '1080p'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  props.setVeoResolution(r);
                  if (r === '1080p') props.setVeoDuration(8);
                }}
                className={cn(
                  'flex-1 rounded-md border px-3 py-1.5 text-[12.5px]',
                  props.veoResolution === r
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Duración
            </label>
            <span className="font-mono text-[12.5px] text-foreground">{props.duration}s</span>
          </div>
          <input
            type="range"
            min={5}
            max={10}
            step={1}
            value={props.duration}
            onChange={(e) => props.setDuration(Number(e.target.value))}
            className="mt-1.5 w-full accent-primary"
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground/50">
            <span>5s</span>
            <span>10s</span>
          </div>
        </>
      )}

      {/* ── Aspect ratio ── */}
      {(() => {
        const klingHasImage = !isVeo && props.referenceImages.length > 0;
        return (
          <>
            <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Aspect ratio
              {klingHasImage && (
                <span className="ml-1 normal-case text-muted-foreground/50">(lo define la imagen)</span>
              )}
            </label>
            <div className="mt-1.5 flex gap-2">
              {(isVeo ? (['16:9', '9:16'] as const) : (['16:9', '9:16', '1:1'] as const)).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => !klingHasImage && props.setAspectRatio(r)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-1.5 text-[12.5px] transition-colors',
                    klingHasImage
                      ? 'cursor-not-allowed border-border/50 text-muted-foreground/30'
                      : props.aspectRatio === r
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </>
        );
      })()}

      {/* ── Imágenes de referencia (Kling: 2 imgs, Veo Standard: 1 img, Veo Fast/Lite: no soporta) ── */}
      {(() => {
        const isVeoStandard = props.model === 'veo-3.1-generate-preview';
        const supportsImages = !isVeo || isVeoStandard;
        if (!supportsImages) return null;
        return (
        <>
      <button
        type="button"
        onClick={() => {
          const next = !useRefImages;
          setUseRefImages(next);
          if (!next) {
            props.referenceImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
            props.setReferenceImages([]);
          }
          if (next && isVeo) {
            props.setVeoResolution('1080p');
            props.setVeoDuration(8);
          }
        }}
        className={cn(
          'mt-5 flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-[12.5px] transition-colors',
          useRefImages
            ? 'border-primary/40 bg-primary/5 text-foreground'
            : 'border-border text-muted-foreground hover:border-muted-foreground/40',
        )}
      >
        <ImagePlus className={cn('size-4', useRefImages && 'text-primary')} aria-hidden />
        {isVeo ? 'Imagen de referencia' : 'Imágenes de referencia'}
      </button>

      {useRefImages && (
        <div className="mt-2 space-y-2">
          {isVeo && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>Imagen de referencia fuerza resolución a 1080p y duración a 8s</span>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />

          {props.referenceImages.length > 0 ? (
            <div className="flex gap-2">
              {props.referenceImages.map((img, i) => (
                <div key={img.storagePath} className="relative flex-1 overflow-hidden rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.previewUrl}
                    alt={img.filename}
                    className="h-24 w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeRef(i)}
                    className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-background/80 text-foreground backdrop-blur transition-colors hover:bg-background"
                    aria-label="Quitar imagen"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                  <div className="absolute bottom-1 left-1 rounded bg-background/70 px-1.5 py-0.5 font-mono text-[9px] text-foreground/80 backdrop-blur">
                    {!isVeo ? (i === 0 ? 'inicio' : 'final') : 'ref'}
                  </div>
                </div>
              ))}
              {props.referenceImages.length < maxImages && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex h-24 flex-1 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground/50 transition-colors hover:border-muted-foreground/40"
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ImagePlus className="size-4" aria-hidden />
                  )}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-[12px] text-muted-foreground transition-colors hover:border-muted-foreground/40"
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="size-4" aria-hidden />
              )}
              {uploading ? 'Subiendo...' : isVeo ? 'Subir imagen' : 'Subir imágenes (max 2)'}
            </button>
          )}

          {props.referenceImages.length > 0 && (
            <p className="px-1 text-[10px] text-muted-foreground/50">
              {props.referenceImages.length === 1 ? 'Frame inicial' : 'Frame inicial + final'}
            </p>
          )}
        </div>
      )}
        </>
        );
      })()}

      {/* ── Audio ── */}
      {isVeo ? (
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center gap-2.5 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[12.5px] text-foreground">
            <Volume2 className="size-4 text-primary" aria-hidden />
            Audio nativo incluido
          </div>
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
            Describe en el prompt lo que quieras escuchar: diálogos, efectos de sonido o ambiente. Ej: &quot;A man says hello while birds sing in the background&quot;
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-1.5">
          <button
            type="button"
            onClick={() => props.setGenerateAudio(!props.generateAudio)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-[12.5px] transition-colors',
              props.generateAudio
                ? 'border-primary/40 bg-primary/5 text-foreground'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40',
            )}
          >
            {props.generateAudio ? (
              <Volume2 className="size-4 text-primary" aria-hidden />
            ) : (
              <VolumeOff className="size-4" aria-hidden />
            )}
            Audio nativo
          </button>
          {props.generateAudio && (
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
              Describe en el prompt lo que quieras escuchar: diálogos, efectos de sonido o ambiente. Ej: &quot;A cat knocks a glass off a table, the glass shatters&quot;
            </p>
          )}
        </div>
      )}

      {/* ── Campaña ── */}
      <CampaignSelector value={props.campaign} onChange={props.setCampaign} />

      {/* ── Estilos ── */}
      <label className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Estilo
      </label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {VIDEO_STYLES.map((s) => {
          const active = props.selectedStyles.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                props.setSelectedStyles(
                  active
                    ? props.selectedStyles.filter((id) => id !== s.id)
                    : [...props.selectedStyles, s.id],
                )
              }
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                active
                  ? 'border-primary/50 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40',
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ── Prompt ── */}
      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Prompt
      </label>
      <textarea
        value={props.prompt}
        onChange={(e) => props.setPrompt(e.target.value.slice(0, isVeo ? 1024 : 2000))}
        placeholder="Describe la escena que quieres animar..."
        className="scroll-thin mt-1.5 min-h-[100px] max-h-[180px] resize-y rounded-md border border-border bg-background p-3 text-[13.5px] text-foreground outline-none focus:border-primary/40 sm:max-h-[280px]"
      />
      <div className="mt-1 flex items-center justify-between">
          <EnhanceButton
            prompt={props.prompt}
            onAccept={props.setPrompt}
            type="video"
            cost={props.enhanceCost}
            balance={props.balance}
          />
          <span className={cn(
            'font-mono text-[10.5px]',
            props.prompt.length > (isVeo ? 1024 : 2000) * 0.9
              ? 'text-amber-400'
              : 'text-muted-foreground/50',
          )}>
            {props.prompt.length} / {isVeo ? '1.024' : '2.000'}
          </span>
        </div>

      {/* ── Costo ── */}
      <div className="mt-6 flex items-center justify-between text-[12.5px]">
        <span className="text-muted-foreground">Costo</span>
        <span className="font-mono text-foreground">-{props.cost} cr</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Saldo</span>
        <span className="font-mono text-muted-foreground">{props.balance} cr</span>
      </div>

      <button
        type="button"
        onClick={props.onGenerate}
        disabled={!props.canGenerate}
        className={cn(
          'mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none',
          props.canGenerate
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'cursor-not-allowed bg-muted text-muted-foreground/60',
        )}
      >
        {props.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Generar video
      </button>
    </div>
  );
}
