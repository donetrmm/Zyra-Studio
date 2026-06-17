'use client';

import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, ImagePlus, Loader2, Volume2, VolumeOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CampaignSelector, type SelectedCampaign } from './CampaignSelector';
import { EnhanceButton } from './EnhanceButton';
import { Step, SectionHeading } from './Step';
import { CreateModeTabs } from './CreateModeTabs';
import { GenerateBar } from './GenerateBar';
import { SeedanceRefsPanel, type SeedanceRef } from './SeedanceRefsPanel';
import {
  SeedanceBrandCastPanel,
  type BrandKitOption,
  type CastOption,
} from './SeedanceBrandCastPanel';
import { MODEL_LABEL, estimateVideoEta } from '@/lib/generation/video-meta';

export type ModelKey =
  | 'fal-ai/kling-video/v3/standard/text-to-video'
  | 'fal-ai/kling-video/v3/pro/text-to-video'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-lite-generate-preview'
  // Claves de UI: el slug real de fal se arma al enviar según la operación
  // (text/image/reference-to-video) — un slug por endpoint.
  | 'seedance-2.0'
  | 'seedance-2.0-fast';

export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
export type SeedanceResolutionUi = '480p' | '720p' | '1080p';

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
  // Seedance
  seedanceDuration: number;
  setSeedanceDuration: (v: number) => void;
  seedanceResolution: SeedanceResolutionUi;
  setSeedanceResolution: (v: SeedanceResolutionUi) => void;
  seedanceSeed: string;
  setSeedanceSeed: (v: string) => void;
  seedanceRefs: SeedanceRef[];
  setSeedanceRefs: (v: SeedanceRef[]) => void;
  seedanceStartFrame: boolean;
  setSeedanceStartFrame: (v: boolean) => void;
  brandKits: BrandKitOption[];
  cast: CastOption[];
  // Reference images
  referenceImages: ReferenceImage[];
  setReferenceImages: (v: ReferenceImage[]) => void;
  // Common
  aspectRatio: VideoAspectRatio;
  setAspectRatio: (v: VideoAspectRatio) => void;
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
  const isSeedance = props.model.startsWith('seedance');
  const isKling = !isVeo && !isSeedance;
  const maxImages = isVeo ? 1 : 2;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [useRefImages, setUseRefImages] = useState(false);

  const isVeoStandard = props.model === 'veo-3.1-generate-preview';
  const supportsImages = isKling || isVeoStandard;
  const klingHasImage = isKling && props.referenceImages.length > 0;
  const seedanceRatios: VideoAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
  const seedanceMaxRes: SeedanceResolutionUi = props.model === 'seedance-2.0-fast' ? '720p' : '1080p';

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

  function handleModelChange(next: ModelKey) {
    props.setModel(next);

    const isVeoNext = next.startsWith('veo-');
    const isSeedanceNext = next.startsWith('seedance');
    const isVeoStandardNext = next === 'veo-3.1-generate-preview';
    const supportsImagesNext = (!isVeoNext && !isSeedanceNext) || isVeoStandardNext;
    const maxImagesNext = isVeoNext ? 1 : 2;

    // Clamp de ratio según lo que soporta cada modelo.
    if (isVeoNext && props.aspectRatio !== '16:9' && props.aspectRatio !== '9:16') {
      props.setAspectRatio('16:9');
    }
    if (!isVeoNext && !isSeedanceNext && !['16:9', '9:16', '1:1'].includes(props.aspectRatio)) {
      props.setAspectRatio('16:9');
    }
    // Seedance fast no soporta 1080p.
    if (next === 'seedance-2.0-fast' && props.seedanceResolution === '1080p') {
      props.setSeedanceResolution('720p');
    }
    if (!isSeedanceNext && props.seedanceRefs.length > 0) {
      props.seedanceRefs.forEach((r) => URL.revokeObjectURL(r.previewUrl));
      props.setSeedanceRefs([]);
    }
    if (!supportsImagesNext && props.referenceImages.length > 0) {
      props.referenceImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      props.setReferenceImages([]);
      setUseRefImages(false);
    } else if (props.referenceImages.length > maxImagesNext) {
      const kept = props.referenceImages.slice(0, maxImagesNext);
      const dropped = props.referenceImages.slice(maxImagesNext);
      dropped.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      props.setReferenceImages(kept);
    }
  }

  const etaSeconds = estimateVideoEta(
    props.model,
    props.duration,
    props.veoDuration,
    props.veoResolution,
    props.seedanceDuration,
  );

  const hint = !props.prompt.trim()
    ? 'Describe la escena para empezar.'
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-card/30">
      <div className="border-b border-border/60 px-4 py-2.5">
        <CreateModeTabs />
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-4 py-[18px] pb-2">
        <h2 className="font-heading text-[15px] font-medium tracking-tight text-foreground">
          Crear video
        </h2>

        <Step index={1} title="Elige el modelo" subtitle="Seedance es multimodal; Kling rápido; Veo premium">
          <Select value={props.model} onValueChange={(v) => handleModelChange(v as ModelKey)}>
            <SelectTrigger className="h-auto w-full rounded-md border-border bg-background px-3 py-2 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Seedance 2.0 (multimodal, audio nativo)</SelectLabel>
                <SelectItem value="seedance-2.0">Seedance 2.0</SelectItem>
                <SelectItem value="seedance-2.0-fast">Seedance 2.0 Fast (draft)</SelectItem>
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Kling 3.0 (rápido)</SelectLabel>
                <SelectItem value="fal-ai/kling-video/v3/standard/text-to-video">Kling 3.0 Standard</SelectItem>
                <SelectItem value="fal-ai/kling-video/v3/pro/text-to-video">Kling 3.0 Pro</SelectItem>
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Veo 3.1 (premium)</SelectLabel>
                <SelectItem value="veo-3.1-fast-generate-preview">Veo Fast</SelectItem>
                <SelectItem value="veo-3.1-generate-preview">Veo Standard</SelectItem>
                <SelectItem value="veo-3.1-lite-generate-preview">Veo Lite</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Step>

        <Step index={2} title="Duración y calidad">
          {isSeedance ? (
            <>
              <div className="mb-2.5 flex items-center justify-between">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                  Duración
                </div>
                <span className="font-mono text-[12.5px] text-foreground">{props.seedanceDuration}s</span>
              </div>
              <input
                type="range"
                min={4}
                max={15}
                step={1}
                value={props.seedanceDuration}
                onChange={(e) => props.setSeedanceDuration(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="mt-0.5 flex justify-between text-[11px] text-muted-foreground/50">
                <span>4s</span>
                <span>15s</span>
              </div>
              <p className="mt-1 px-0.5 text-[11px] text-muted-foreground/60">
                Una idea ≈ 4s; para varias acciones usa más duración o divide en clips.
              </p>
              <div className="mt-3.5">
                <SectionHeading>Resolución</SectionHeading>
                <div className="flex gap-2">
                  {(['480p', '720p', '1080p'] as const).map((r) => {
                    const locked = r === '1080p' && seedanceMaxRes !== '1080p';
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => !locked && props.setSeedanceResolution(r)}
                        title={locked ? 'Fast llega a 720p; usa Seedance 2.0 para 1080p' : undefined}
                        className={cn(
                          'flex-1 rounded-md border px-3 py-1.5 text-[12.5px] transition-colors',
                          locked
                            ? 'cursor-not-allowed border-border/50 text-muted-foreground/30'
                            : props.seedanceResolution === r
                              ? 'border-primary bg-primary/10 text-foreground'
                              : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                        )}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3.5">
                <SectionHeading>Seed (opcional)</SectionHeading>
                <input
                  type="number"
                  min={0}
                  max={2147483647}
                  step={1}
                  value={props.seedanceSeed}
                  onChange={(e) => {
                    // Solo enteros no negativos (es lo que acepta el modelo).
                    const v = e.target.value.replace(/[^\d]/g, '');
                    props.setSeedanceSeed(v);
                  }}
                  placeholder="Fija la composición para iterar"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[12.5px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <p className="mt-1 px-0.5 text-[11px] text-muted-foreground/60">
                  Mismo seed + mismo prompt = misma composición. Vacío = aleatorio (se guarda en la
                  generación para reusarlo).
                </p>
              </div>
            </>
          ) : isVeo ? (
            <>
              <SectionHeading>Duración</SectionHeading>
              <div className="flex gap-2">
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
              <div className="mt-3.5">
                <SectionHeading>Resolución</SectionHeading>
                <div className="flex gap-2">
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
              </div>
            </>
          ) : (
            <>
              <div className="mb-2.5 flex items-center justify-between">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                  Duración
                </div>
                <span className="font-mono text-[12.5px] text-foreground">{props.duration}s</span>
              </div>
              <input
                type="range"
                min={5}
                max={10}
                step={1}
                value={props.duration}
                onChange={(e) => props.setDuration(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="mt-0.5 flex justify-between text-[11px] text-muted-foreground/50">
                <span>5s</span>
                <span>10s</span>
              </div>
            </>
          )}
        </Step>

        <Step
          index={3}
          title="Proporción"
          subtitle={klingHasImage ? 'La define la imagen de referencia' : undefined}
        >
          <div className={cn('gap-2', isSeedance ? 'grid grid-cols-3' : 'flex')}>
            {(isSeedance
              ? seedanceRatios
              : isVeo
                ? (['16:9', '9:16'] as VideoAspectRatio[])
                : (['16:9', '9:16', '1:1'] as VideoAspectRatio[])
            ).map((r) => (
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
        </Step>

        {isSeedance && (
          <Step
            index={4}
            title="Referencias multimodales"
            subtitle="Opcional · Brand Kit, Cast o archivos propios (9 img + 3 video + 3 audio)"
          >
            <SeedanceBrandCastPanel
              brandKits={props.brandKits}
              cast={props.cast}
              refs={props.seedanceRefs}
              setRefs={props.setSeedanceRefs}
            />
            <div className="mt-3">
              <SeedanceRefsPanel
                refs={props.seedanceRefs}
                setRefs={props.setSeedanceRefs}
                onCite={(text) => {
                  const next = props.prompt.trim() ? `${props.prompt.trimEnd()} ${text}` : text;
                  props.setPrompt(next.slice(0, 4000));
                }}
              />
            </div>
            {props.seedanceRefs.length > 0 &&
              props.seedanceRefs[0].kind === 'image' &&
              props.seedanceRefs.every((r) => r.kind === 'image') &&
              props.seedanceRefs.length <= 2 && (
                <button
                  type="button"
                  onClick={() => props.setSeedanceStartFrame(!props.seedanceStartFrame)}
                  className={cn(
                    'mt-2 flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-[12px] transition-colors',
                    props.seedanceStartFrame
                      ? 'border-primary/40 bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                  )}
                >
                  <ImagePlus className={cn('size-4', props.seedanceStartFrame && 'text-primary')} aria-hidden />
                  {props.seedanceStartFrame
                    ? props.seedanceRefs.length === 2
                      ? 'Frame inicial + final (image-to-video)'
                      : 'Usar como frame inicial (image-to-video)'
                    : 'Usar como frames inicial/final en vez de @referencias'}
                </button>
              )}
          </Step>
        )}

        {supportsImages && (
          <Step
            index={4}
            title={isVeo ? 'Imagen de referencia' : 'Imágenes de referencia'}
            subtitle={isVeo ? 'Opcional · 1 imagen guía la escena' : 'Opcional · frame inicial + final'}
          >
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
                'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-[12.5px] transition-colors',
                useRefImages
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40',
              )}
            >
              <ImagePlus className={cn('size-4', useRefImages && 'text-primary')} aria-hidden />
              {useRefImages ? 'Activado' : 'Activar referencias'}
            </button>

            {useRefImages && (
              <div className="mt-2.5 space-y-2">
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
                        <div className="absolute bottom-1 left-1 rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80 backdrop-blur">
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
                    {uploading ? 'Subiendo…' : isVeo ? 'Subir imagen' : 'Subir imágenes (max 2)'}
                  </button>
                )}

                {props.referenceImages.length > 0 && (
                  <p className="px-1 text-[11px] text-muted-foreground/50">
                    {props.referenceImages.length === 1 ? 'Frame inicial' : 'Frame inicial + final'}
                  </p>
                )}
              </div>
            )}
          </Step>
        )}

        <Step
          index={5}
          title="Audio"
          subtitle={isSeedance ? 'Nativo estéreo, sin costo extra' : isVeo ? 'Incluido con Veo' : 'Opcional con Kling'}
        >
          {isSeedance ? (
            <div className="space-y-1.5">
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
                Audio nativo estéreo
              </button>
              {props.generateAudio && (
                <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
                  Describe qué se oye y cuándo: diálogos entre comillas, efectos, ambiente. También puedes
                  subir un audio de referencia (@Audio1) para el ritmo.
                </p>
              )}
            </div>
          ) : isVeo ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[12.5px] text-foreground">
                <Volume2 className="size-4 text-primary" aria-hidden />
                Audio nativo incluido
              </div>
              <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
                Describe en el prompt lo que quieras escuchar: diálogos, efectos de sonido o ambiente.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
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
                  Describe en el prompt diálogos, efectos o ambiente.
                </p>
              )}
            </div>
          )}
        </Step>

        <Step index={6} title="Estilo" subtitle="Opcional · combinables">
          <div className="flex flex-wrap gap-1.5">
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
                    'rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
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
        </Step>

        <Step index={7} title="Colección" subtitle="Opcional · agrupa generaciones">
          <CampaignSelector value={props.campaign} onChange={props.setCampaign} />
        </Step>

        <Step
          index={8}
          title="Prompt"
          subtitle="Describe la escena"
          hint={
            <span
              className={cn(
                'font-mono text-[11px]',
                props.prompt.length > (isSeedance ? 4000 : isVeo ? 1024 : 2000) * 0.9
                  ? 'text-amber-400'
                  : 'text-muted-foreground/70',
              )}
            >
              {props.prompt.length} / {isSeedance ? '4.000' : isVeo ? '1.024' : '2.000'}
            </span>
          }
        >
          <textarea
            value={props.prompt}
            onChange={(e) => props.setPrompt(e.target.value.slice(0, isSeedance ? 4000 : isVeo ? 1024 : 2000))}
            placeholder="Describe la escena que quieres animar…"
            className="scroll-thin min-h-[110px] w-full max-h-[200px] resize-y rounded-[12px] border border-border bg-muted/30 p-3 text-[13.5px] leading-[1.5] text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 sm:max-h-[280px]"
          />
          <div className="mt-1.5">
            <EnhanceButton
              prompt={props.prompt}
              onAccept={props.setPrompt}
              type="video"
              cost={props.enhanceCost}
              balance={props.balance}
            />
          </div>
        </Step>
      </div>

      <GenerateBar
        modelLabel={MODEL_LABEL[props.model]}
        cost={props.cost}
        balance={props.balance}
        etaSeconds={etaSeconds}
        disabled={!props.canGenerate}
        pending={props.pending}
        onClick={props.onGenerate}
        idleLabel="Generar video"
        pendingLabel="Generando video…"
        hint={hint}
      />
    </div>
  );
}
