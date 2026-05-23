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
  hideCta?: boolean; // en modo chat el CTA vive en el composer
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
    <div
      className="flex h-full min-h-0 flex-col"
      style={{
        background: 'var(--zyra-bg-1)',
        borderRight: '1px solid var(--zyra-hairline)',
        fontFamily: 'var(--zyra-font-sans)',
        color: 'var(--zyra-text-1)',
      }}
    >
      <div
        className="scroll-thin flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto"
        style={{ padding: '18px 16px 8px' }}
      >
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
            <span
              className="text-[11px]"
              style={{ fontFamily: 'var(--zyra-font-mono)', color: 'var(--zyra-text-3)' }}
            >
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
    <div
      className="mt-2 flex gap-1.5 rounded-lg px-2.5 py-2 text-[11.5px] leading-[1.5]"
      style={{
        background: 'var(--zyra-bg-2)',
        border: '1px solid var(--zyra-hairline)',
        color: 'var(--zyra-text-2)',
      }}
    >
      <Info
        className="mt-px size-3 shrink-0"
        style={{ color: 'var(--zyra-text-3)' }}
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
              className="rounded-[10px] text-left transition-all"
              style={{
                padding: '10px 11px 11px',
                background: active ? 'var(--zyra-bg-3)' : 'var(--zyra-bg-2)',
                border: `1px solid ${active ? 'var(--zyra-accent-rim)' : 'var(--zyra-hairline)'}`,
                boxShadow: active
                  ? '0 0 0 3px rgba(123, 97, 255, 0.10) inset'
                  : 'none',
              }}
            >
              <div className="mb-0.5 flex items-center gap-1.5">
                <span
                  className="size-[5px] rounded-full"
                  style={{
                    background: active ? 'var(--zyra-accent)' : 'var(--zyra-text-4)',
                    boxShadow: active ? '0 0 8px var(--zyra-accent-glow)' : 'none',
                  }}
                />
                <span
                  className="text-[13px] font-medium"
                  style={{ color: 'var(--zyra-text-1)' }}
                >
                  {meta.label}
                </span>
              </div>
              <div
                className="text-[11px]"
                style={{
                  fontFamily: 'var(--zyra-font-mono)',
                  color: 'var(--zyra-text-3)',
                }}
              >
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
    <div
      className="relative rounded-[14px] transition-colors focus-within:!border-[var(--zyra-accent-rim)]"
      style={{
        background: 'var(--zyra-bg-2)',
        border: '1px solid var(--zyra-hairline)',
      }}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 8000))}
        placeholder="Describe la imagen que quieres crear. Sé específico — luz, lente, atmósfera, materiales."
        className="w-full resize-none border-0 bg-transparent outline-none"
        style={{
          minHeight: 96,
          maxHeight: 280,
          padding: '14px 14px 36px',
          color: 'var(--zyra-text-1)',
          fontSize: 15,
          lineHeight: 1.5,
        }}
      />
      <div className="pointer-events-none absolute inset-x-3.5 bottom-2.5 flex items-center justify-between">
        <div
          className="text-[10.5px]"
          style={{ fontFamily: 'var(--zyra-font-mono)', color: 'var(--zyra-text-3)' }}
        >
          {value.length} / 8 000
        </div>
        <div className="pointer-events-auto flex gap-1.5">
          <button
            type="button"
            title="Mejorar prompt"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid var(--zyra-hairline)',
              color: 'var(--zyra-text-2)',
            }}
          >
            <Sparkles className="size-3" aria-hidden /> Mejorar
          </button>
        </div>
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
        className="flex items-center gap-1.5 py-1 text-[12px]"
        style={{ color: 'var(--zyra-text-2)' }}
      >
        <ChevronDown
          className="size-3 transition-transform"
          style={{ transform: open ? 'rotate(0)' : 'rotate(-90deg)' }}
          aria-hidden
        />
        Prompt negativo
        {!open && value.length > 0 && (
          <span
            className="text-[10.5px]"
            style={{ fontFamily: 'var(--zyra-font-mono)', color: 'var(--zyra-text-3)' }}
          >
            · {value.length}
          </span>
        )}
      </button>
      {open && (
        <div
          className="zyra-fade-in mt-2 rounded-[10px]"
          style={{
            background: 'var(--zyra-bg-2)',
            border: '1px solid var(--zyra-hairline)',
          }}
        >
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, 2000))}
            placeholder="Qué quieres evitar. Ej: texto borroso, manos deformadas, marca de agua."
            className="w-full resize-none border-0 bg-transparent outline-none"
            style={{
              height: 64,
              padding: '10px 12px',
              color: 'var(--zyra-text-2)',
              fontSize: 13,
              lineHeight: 1.45,
            }}
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
            className="inline-flex items-center gap-1.5 rounded-lg transition-colors"
            style={{
              padding: '6px 10px 6px 8px',
              background: active ? 'var(--zyra-accent-soft)' : 'var(--zyra-bg-2)',
              border: `1px solid ${active ? 'var(--zyra-accent-rim)' : 'var(--zyra-hairline)'}`,
              color: active ? 'var(--zyra-text-1)' : 'var(--zyra-text-2)',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <span
              className="inline-block rounded-sm"
              style={{
                width: w,
                height: h,
                border: `1.4px solid ${active ? 'var(--zyra-accent-2)' : 'var(--zyra-text-3)'}`,
              }}
            />
            <span
              style={{ fontFamily: 'var(--zyra-font-mono)', fontSize: 11.5 }}
            >
              {a.id}
            </span>
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
    <div
      className="flex gap-0.5 rounded-[9px] p-[3px]"
      style={{
        background: 'var(--zyra-bg-2)',
        border: '1px solid var(--zyra-hairline)',
      }}
    >
      {options.map((o) => {
        const active = value === o.id;
        const warn = warnOn === o.id && active;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md transition-colors"
            style={{
              padding: '6px 10px',
              background: active ? 'var(--zyra-bg-3)' : 'transparent',
              border: active
                ? '1px solid var(--zyra-hairline-strong)'
                : '1px solid transparent',
              color: active ? 'var(--zyra-text-1)' : 'var(--zyra-text-2)',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <span style={{ fontFamily: 'var(--zyra-font-mono)' }}>{o.label}</span>
            {warn && (
              <span
                className="inline-block size-[6px] rounded-full"
                style={{ background: 'var(--zyra-warn)' }}
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
      className="flex items-start justify-between rounded-[10px]"
      style={{
        padding: '10px 12px',
        background: 'var(--zyra-bg-2)',
        border: '1px solid var(--zyra-hairline)',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <div className="flex items-start gap-2.5">
        {Icon && (
          <span
            className="mt-px"
            style={{ color: on ? 'var(--zyra-accent-2)' : 'var(--zyra-text-3)' }}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
        <div>
          <div
            className="text-[12.5px] font-medium"
            style={{ color: 'var(--zyra-text-1)' }}
          >
            {label}
          </div>
          {hint && (
            <div className="mt-0.5 text-[11px]" style={{ color: 'var(--zyra-text-3)' }}>
              {hint}
            </div>
          )}
          {costNote && (
            <div
              className="mt-1 text-[10.5px]"
              style={{
                fontFamily: 'var(--zyra-font-mono)',
                color: 'var(--zyra-accent-2)',
              }}
            >
              {costNote}
            </div>
          )}
        </div>
      </div>
      <PillSwitch on={on} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function PillSwitch({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      className="relative shrink-0 transition-colors"
      style={{
        width: 30,
        height: 18,
        borderRadius: 999,
        background: on ? 'var(--zyra-accent)' : 'rgba(255, 255, 255, 0.10)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        className="absolute top-0.5 transition-all"
        style={{
          left: on ? 14 : 2,
          width: 14,
          height: 14,
          borderRadius: 999,
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
        }}
      />
    </button>
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
            resolution === '4k' ? (
              <span style={{ color: 'var(--zyra-warn)' }}>~50s</span>
            ) : null
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
    <div
      className="sticky bottom-0 backdrop-blur"
      style={{
        padding: '12px 16px 14px',
        borderTop: '1px solid var(--zyra-hairline)',
        background:
          'linear-gradient(to top, rgba(14, 19, 34, 0.95) 60%, rgba(14, 19, 34, 0.6))',
      }}
    >
      {hint && (
        <div
          className="mb-2.5 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px]"
          style={{
            background: 'rgba(123, 97, 255, 0.07)',
            border: '1px solid rgba(123, 97, 255, 0.18)',
            color: 'var(--zyra-text-2)',
          }}
        >
          <Info
            className="mt-px size-3 shrink-0"
            style={{ color: 'var(--zyra-accent-2)' }}
            aria-hidden
          />
          <span>{hint}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="relative flex w-full items-center justify-center gap-2 rounded-xl"
        style={{
          padding: '12px 14px',
          background: disabled
            ? 'rgba(255, 255, 255, 0.05)'
            : 'linear-gradient(180deg, #8C75FF 0%, #6D52F0 100%)',
          color: disabled ? 'var(--zyra-text-3)' : '#fff',
          fontSize: 14,
          fontWeight: 600,
          boxShadow: disabled
            ? 'none'
            : '0 8px 28px -10px var(--zyra-accent-glow), 0 0 0 1px rgba(255, 255, 255, 0.08) inset',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="size-3.5" aria-hidden />
        )}
        {pending ? 'Generando…' : 'Generar'}
        <span
          className="ml-1 inline-flex items-center gap-1 border-l pl-2.5 text-[12px]"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.18)',
            fontFamily: 'var(--zyra-font-mono)',
            opacity: 0.9,
          }}
        >
          −{cost} cr
        </span>
      </button>
      <div
        className="mt-2 flex items-center justify-between text-[11px]"
        style={{
          fontFamily: 'var(--zyra-font-mono)',
          color: 'var(--zyra-text-3)',
        }}
      >
        <span>{modelLabel}</span>
        <span>~{etaSeconds}s</span>
      </div>
      {insufficient && !disabled && (
        <div
          className="mt-1.5 text-center text-[11px]"
          style={{ color: 'var(--zyra-warn)' }}
        >
          Te faltan {(cost - balance).toLocaleString('es-MX')} créditos.
        </div>
      )}
    </div>
  );
}
