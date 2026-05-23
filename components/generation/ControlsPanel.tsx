'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  Globe,
  Info,
  Loader2,
  MessageSquareText,
  Sparkles,
  Type,
} from 'lucide-react';
import { Step as StepBase, SectionHeading } from './Step';
import { ReferencesPanel, type ReferenceClient } from './ReferencesPanel';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ModelKey, Selection, SessionItem } from './types';

const ASPECTS: { id: string; w: number; h: number }[] = [
  { id: '1:1', w: 1, h: 1 },
  { id: '16:9', w: 16, h: 9 },
  { id: '9:16', w: 9, h: 16 },
  { id: '4:3', w: 4, h: 3 },
  { id: '3:4', w: 3, h: 4 },
  { id: '3:2', w: 3, h: 2 },
  { id: '2:3', w: 2, h: 3 },
];

const MODEL_META: Record<
  ModelKey,
  { label: string; sub: string; desc: string }
> = {
  auto: {
    label: 'Auto',
    sub: 'Recomendado',
    desc: 'Zyra elige el mejor modelo según tu prompt.',
  },
  'nano-pro': {
    label: 'Nano Banana Pro',
    sub: 'Gemini 3 Pro Image',
    desc: 'Calidad máxima. Edición conversacional disponible.',
  },
  'nano-flash': {
    label: 'Nano Flash',
    sub: 'Gemini 3.1 Flash',
    desc: 'Velocidad. Soporta hasta 14 referencias.',
  },
  flux: {
    label: 'FLUX 2 Pro',
    sub: 'Black Forest Labs',
    desc: 'Fotorrealismo crítico.',
  },
};

export type ControlsPanelProps = {
  modelKey: ModelKey;
  setModelKey: (v: ModelKey) => void;
  selection: Selection;
  prompt: string;
  setPrompt: (v: string) => void;
  negativePrompt: string;
  setNegativePrompt: (v: string) => void;
  aspectRatio: string;
  setAspectRatio: (v: string) => void;
  resolution: '1k' | '2k' | '4k';
  setResolution: (v: '1k' | '2k' | '4k') => void;
  hasTextInImage: boolean;
  setHasTextInImage: (v: boolean) => void;
  conversational: boolean;
  setConversational: (v: boolean) => void;
  useGrounding: boolean;
  setUseGrounding: (v: boolean) => void;
  photoreal: boolean;
  setPhotoreal: (v: boolean) => void;
  megapixels: 1 | 2 | 4;
  setMegapixels: (v: 1 | 2 | 4) => void;
  references: ReferenceClient[];
  setReferences: (next: ReferenceClient[]) => void;
  activeResult: SessionItem | null;
  cost: number;
  balance: number;
  etaSeconds: number;
  pending: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  hideCta?: boolean;
};

export function ControlsPanel(props: ControlsPanelProps) {
  const isNano = props.selection.provider === 'nano-banana';
  const isPro = props.selection.model === 'gemini-3-pro-image-preview';
  const hint = !props.prompt.trim()
    ? 'Escribe un prompt para empezar.'
    : props.conversational && isPro
      ? 'Modo conversacional activo. Verás un chat para iterar.'
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-card">
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-4 py-[18px] pb-2">
        <Step n={1} title="Elige el modelo" subtitle="Auto decide por ti">
          <ModelPicker value={props.modelKey} onChange={props.setModelKey} />
          <InfoCard text={MODEL_META[props.modelKey].desc} />
        </Step>

        <Step n={2} title="Describe tu imagen" subtitle="Cuanto más concreto, mejor">
          <PromptArea value={props.prompt} onChange={props.setPrompt} />
          <div className="mt-2">
            <NegativePromptInput
              value={props.negativePrompt}
              onChange={props.setNegativePrompt}
            />
          </div>
        </Step>

        <Step
          n={3}
          title="Añade referencias"
          subtitle="Opcional · guía el estilo"
          hint={
            <span className="font-mono text-[11px] text-muted-foreground/80">
              {props.references.length} / {isNano ? 11 : 8}
            </span>
          }
        >
          <ReferencesPanel
            value={props.references}
            onChange={props.setReferences}
            maxRefs={isNano ? 11 : 8}
          />
        </Step>

        <Step n={4} title="Formato y parámetros">
          <SectionHeading>Proporción</SectionHeading>
          <AspectPicker value={props.aspectRatio} onChange={props.setAspectRatio} />
          <div className="mt-3.5">
            {isNano ? (
              <NanoParams
                isPro={isPro}
                resolution={props.resolution}
                setResolution={props.setResolution}
                hasTextInImage={props.hasTextInImage}
                setHasTextInImage={props.setHasTextInImage}
                conversational={props.conversational}
                setConversational={props.setConversational}
                useGrounding={props.useGrounding}
                setUseGrounding={props.setUseGrounding}
                activeResult={props.activeResult}
              />
            ) : (
              <FluxParams
                megapixels={props.megapixels}
                setMegapixels={props.setMegapixels}
                photoreal={props.photoreal}
                setPhotoreal={props.setPhotoreal}
              />
            )}
          </div>
        </Step>
      </div>

      {!props.hideCta && (
        <GenerateBar
          modelLabel={MODEL_META[props.modelKey].label}
          cost={props.cost}
          etaSeconds={props.etaSeconds}
          balance={props.balance}
          disabled={!props.canGenerate}
          pending={props.pending}
          onClick={props.onGenerate}
          hint={hint}
        />
      )}
    </div>
  );
}

function Step({
  n,
  title,
  subtitle,
  hint,
  children,
}: {
  n: number;
  title: string;
  subtitle?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <StepBase index={n} title={title} subtitle={subtitle} hint={hint}>
      {children}
    </StepBase>
  );
}

function InfoCard({ text }: { text: string }) {
  return (
    <div className="mt-2 flex gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-[11.5px] leading-[1.5] text-muted-foreground">
      <Info
        className="mt-px size-3 shrink-0 text-muted-foreground/70"
        aria-hidden
      />
      <span>{text}</span>
    </div>
  );
}

function ModelPicker({
  value,
  onChange,
}: {
  value: ModelKey;
  onChange: (v: ModelKey) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {(Object.entries(MODEL_META) as [ModelKey, typeof MODEL_META[ModelKey]][]).map(
        ([id, meta]) => {
          const active = value === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={cn(
                'rounded-[10px] px-2.5 pb-2.5 pt-2 text-left transition-colors',
                active
                  ? 'border border-primary/40 bg-primary/5 shadow-[inset_0_0_0_1px_var(--color-primary)] shadow-primary/10'
                  : 'border border-border bg-muted/30 hover:border-muted-foreground/30',
              )}
            >
              <div className="mb-0.5 flex items-center gap-1.5">
                <span
                  className={cn(
                    'size-[5px] rounded-full',
                    active ? 'bg-primary' : 'bg-muted-foreground/40',
                  )}
                />
                <span className="text-[13px] font-medium text-foreground">
                  {meta.label}
                </span>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground/80">
                {meta.sub}
              </div>
            </button>
          );
        },
      )}
    </div>
  );
}

function PromptArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [value]);
  return (
    <div className="rounded-[14px] border border-border bg-muted/30 transition-colors focus-within:border-primary/40">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 8000))}
        placeholder="Describe lo que quieres crear. Sé específico con luz, lente y atmósfera."
        className="w-full resize-none border-0 bg-transparent px-3.5 py-3 text-[14px] leading-[1.5] text-foreground outline-none"
        style={{ minHeight: 96, maxHeight: 280 }}
      />
      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2.5 py-1.5">
        <div className="font-mono text-[10.5px] text-muted-foreground/70">
          {value.length} / 8 000
        </div>
        <button
          type="button"
          title="Mejorar prompt"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Sparkles className="size-3" aria-hidden /> Mejorar
        </button>
      </div>
    </div>
  );
}

function NegativePromptInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(value.length > 0);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn('size-3 transition-transform', open ? 'rotate-0' : '-rotate-90')}
          aria-hidden
        />
        Prompt negativo
        {!open && value.length > 0 && (
          <span className="font-mono text-[10.5px] text-muted-foreground/70">
            · {value.length}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 rounded-[10px] border border-border bg-muted/30">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, 2000))}
            placeholder="Qué quieres evitar. Ej: texto borroso, manos deformadas, marca de agua."
            className="h-16 w-full resize-none border-0 bg-transparent px-3 py-2.5 text-[13px] leading-[1.45] text-muted-foreground outline-none"
          />
        </div>
      )}
    </div>
  );
}

function AspectPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ASPECTS.map((a) => {
        const active = a.id === value;
        const w = a.w >= a.h ? 14 : (14 * a.w) / a.h;
        const h = a.h > a.w ? 14 : (14 * a.h) / a.w;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onChange(a.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
              active
                ? 'border border-primary/40 bg-primary/10 text-foreground'
                : 'border border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground/30',
            )}
          >
            <span
              className={cn(
                'inline-block rounded-sm',
                active ? 'border border-primary' : 'border border-muted-foreground/60',
              )}
              style={{ width: w, height: h, borderWidth: 1.4 }}
            />
            <span className="font-mono text-[11.5px]">{a.id}</span>
          </button>
        );
      })}
    </div>
  );
}

function SegRow<T extends string>({
  options,
  value,
  onChange,
  warnOn,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  warnOn?: T;
}) {
  return (
    <div className="flex gap-0.5 rounded-[9px] border border-border bg-muted/30 p-[3px]">
      {options.map((o) => {
        const active = value === o.id;
        const warn = warnOn === o.id && active;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors',
              active
                ? 'border border-border bg-background text-foreground'
                : 'border border-transparent text-muted-foreground',
            )}
          >
            <span className="font-mono">{o.label}</span>
            {warn && (
              <span
                className="inline-block size-1.5 rounded-full bg-amber-400"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  hint,
  costNote,
  on,
  onChange,
  disabled,
}: {
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  label: string;
  hint?: string;
  costNote?: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 rounded-[10px] border border-border bg-muted/30 px-3 py-2.5',
        disabled && 'opacity-50',
      )}
    >
      <div className="flex items-start gap-2.5">
        {Icon && (
          <span className={cn('mt-px', on ? 'text-primary' : 'text-muted-foreground/70')}>
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
        <div>
          <div className="text-[12.5px] font-medium text-foreground">{label}</div>
          {hint && (
            <div className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</div>
          )}
          {costNote && (
            <div className="mt-1 font-mono text-[10.5px] text-primary">{costNote}</div>
          )}
        </div>
      </div>
      <Switch checked={on} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function NanoParams({
  isPro,
  resolution,
  setResolution,
  hasTextInImage,
  setHasTextInImage,
  conversational,
  setConversational,
  useGrounding,
  setUseGrounding,
  activeResult,
}: {
  isPro: boolean;
  resolution: '1k' | '2k' | '4k';
  setResolution: (v: '1k' | '2k' | '4k') => void;
  hasTextInImage: boolean;
  setHasTextInImage: (v: boolean) => void;
  conversational: boolean;
  setConversational: (v: boolean) => void;
  useGrounding: boolean;
  setUseGrounding: (v: boolean) => void;
  activeResult: SessionItem | null;
}) {
  return (
    <div className="grid gap-2.5">
      <div>
        <SectionHeading
          hint={
            resolution === '4k' ? <span className="text-amber-400">~50s</span> : null
          }
        >
          Resolución
        </SectionHeading>
        <SegRow
          options={[
            { id: '1k', label: '1K' },
            { id: '2k', label: '2K' },
            { id: '4k', label: '4K' },
          ]}
          value={resolution}
          warnOn="4k"
          onChange={setResolution}
        />
      </div>
      <ToggleRow
        icon={Type}
        label="Texto en imagen"
        hint="Mejora la fidelidad de palabras dentro de la imagen."
        on={hasTextInImage}
        onChange={setHasTextInImage}
      />
      {isPro && (
        <ToggleRow
          icon={MessageSquareText}
          label="Edición conversacional"
          hint={
            conversational && !activeResult
              ? 'Genera una primera imagen para iniciar el hilo.'
              : conversational && activeResult
                ? 'Iterando sobre la última imagen.'
                : 'Activa modo chat para iterar sobre la imagen.'
          }
          costNote="+50% en créditos"
          on={conversational}
          onChange={setConversational}
        />
      )}
      <ToggleRow
        icon={Globe}
        label="Grounding con Google Search"
        hint="Permite incorporar datos en tiempo real."
        costNote="+20% en créditos"
        on={useGrounding}
        onChange={setUseGrounding}
      />
    </div>
  );
}

function FluxParams({
  megapixels,
  setMegapixels,
  photoreal,
  setPhotoreal,
}: {
  megapixels: 1 | 2 | 4;
  setMegapixels: (v: 1 | 2 | 4) => void;
  photoreal: boolean;
  setPhotoreal: (v: boolean) => void;
}) {
  return (
    <div className="grid gap-2.5">
      <div>
        <SectionHeading>Megapíxeles</SectionHeading>
        <SegRow
          options={[
            { id: '1', label: '1 MP' },
            { id: '2', label: '2 MP' },
            { id: '4', label: '4 MP' },
          ]}
          value={String(megapixels) as '1' | '2' | '4'}
          onChange={(v) => setMegapixels(Number(v) as 1 | 2 | 4)}
        />
      </div>
      <ToggleRow
        icon={Camera}
        label="Photoreal"
        hint="Optimiza para fotorrealismo y precisión de cámara."
        on={photoreal}
        onChange={setPhotoreal}
      />
    </div>
  );
}

function GenerateBar({
  modelLabel,
  cost,
  etaSeconds,
  balance,
  disabled,
  pending,
  onClick,
  hint,
}: {
  modelLabel: string;
  cost: number;
  etaSeconds: number;
  balance: number;
  disabled: boolean;
  pending: boolean;
  onClick: () => void;
  hint: string | null;
}) {
  const insufficient = cost > balance;
  return (
    <div className="sticky bottom-0 border-t border-border bg-card/95 px-4 py-3.5 backdrop-blur">
      {hint && (
        <div className="mb-2.5 flex items-start gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
          <Info className="mt-px size-3 shrink-0 text-primary/80" aria-hidden />
          <span>{hint}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'relative flex w-full items-center justify-center gap-2 rounded-xl px-3.5 py-3 text-[14px] font-semibold transition-colors',
          disabled
            ? 'cursor-not-allowed bg-muted/40 text-muted-foreground/60'
            : 'bg-primary text-primary-foreground shadow-[0_8px_28px_-10px_color-mix(in_oklch,var(--color-primary)_55%,transparent)] hover:bg-primary/90',
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="size-3.5" aria-hidden />
        )}
        {pending ? 'Generando…' : 'Generar'}
        <span className="ml-1 inline-flex items-center gap-1 border-l border-primary-foreground/25 pl-2.5 font-mono text-[12px] opacity-90">
          −{cost} cr
        </span>
      </button>
      <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground/80">
        <span>{modelLabel}</span>
        <span>~{etaSeconds}s</span>
      </div>
      {insufficient && !disabled && (
        <div className="mt-1.5 text-center text-[11px] text-amber-400">
          Te faltan {(cost - balance).toLocaleString('es-MX')} créditos.
        </div>
      )}
    </div>
  );
}
