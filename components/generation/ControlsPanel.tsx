'use client';

import { useEffect, useRef, useState } from 'react';
import { Coins, Loader2, MessageSquareText, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Step } from './Step';
import { ReferencesPanel, type ReferenceClient } from './ReferencesPanel';
import { cn } from '@/lib/utils';
import type { ModelKey, Selection, SessionItem } from './types';

const NANO_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;

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
  pending: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  // En modo chat, el prompt se mueve al thread footer; el panel oculta el
  // bloque de prompt + CTA y solo deja modelo/config/refs.
  hidePromptAndCta?: boolean;
};

export function ControlsPanel(props: ControlsPanelProps) {
  const aspects = NANO_ASPECTS;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h1 className="font-heading text-lg font-semibold">Imagen</h1>
          <p className="text-xs text-muted-foreground">
            {props.conversational
              ? 'Modo conversacional activo'
              : 'Describe y genera con IA'}
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Coins className="size-3" aria-hidden /> {fmt(props.balance)}
        </Badge>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-6">
          {!props.hidePromptAndCta && (
            <PromptBlock
              value={props.prompt}
              onChange={props.setPrompt}
              negativePrompt={props.negativePrompt}
              setNegativePrompt={props.setNegativePrompt}
            />
          )}

          <Step
            index={1}
            title="Modelo"
            hint={labelForSelection(props.selection)}
            done={!!props.modelKey}
          >
            <ModelPicker value={props.modelKey} onChange={props.setModelKey} />
          </Step>

          <Step
            index={2}
            title="Configuración"
            hint={
              props.selection.provider === 'flux'
                ? `${props.aspectRatio} · ${props.megapixels} MP${props.photoreal ? ' · photoreal' : ''}`
                : `${props.aspectRatio} · ${props.resolution.toUpperCase()}`
            }
            done={true}
          >
            <div>
              <Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
                Aspect ratio
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {aspects.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => props.setAspectRatio(a)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs transition-colors',
                      props.aspectRatio === a
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-muted-foreground/40',
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            {props.selection.provider === 'nano-banana' ? (
              <>
                <div>
                  <Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
                    Resolución
                  </Label>
                  <div className="flex gap-1.5">
                    {(['1k', '2k', '4k'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => props.setResolution(r)}
                        className={cn(
                          'flex-1 rounded-md border px-2.5 py-1 text-xs uppercase transition-colors',
                          props.resolution === r
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-muted-foreground/40',
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {props.resolution === '4k' && (
                    <p className="mt-1 text-xs text-amber-400">
                      4K toma ~25–55s y se acerca al límite del servidor.
                    </p>
                  )}
                </div>
                <ToggleRow
                  label="Texto en imagen"
                  checked={props.hasTextInImage}
                  onCheckedChange={props.setHasTextInImage}
                  hint="Mejora la fidelidad del texto dentro de la imagen."
                />
                <ToggleRow
                  icon={<MessageSquareText className="size-3.5" aria-hidden />}
                  label="Edición conversacional"
                  checked={props.conversational}
                  onCheckedChange={props.setConversational}
                  hint={
                    props.conversational
                      ? props.activeResult
                        ? '+50% créditos · Iterando sobre la última imagen.'
                        : '+50% créditos · Genera una primera imagen para iniciar el hilo.'
                      : '+50% créditos · Mantiene composición entre iteraciones.'
                  }
                />
                <ToggleRow
                  label="Grounding (Google Search)"
                  checked={props.useGrounding}
                  onCheckedChange={props.setUseGrounding}
                  hint="+20% créditos · Usa datos en tiempo real (clima, eventos)."
                />
              </>
            ) : (
              <>
                <div>
                  <Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
                    Megapixels
                  </Label>
                  <div className="flex gap-1.5">
                    {([1, 2, 4] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => props.setMegapixels(m)}
                        className={cn(
                          'flex-1 rounded-md border px-2.5 py-1 text-xs transition-colors',
                          props.megapixels === m
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-muted-foreground/40',
                        )}
                      >
                        {m} MP
                      </button>
                    ))}
                  </div>
                </div>
                <ToggleRow
                  label="Photoreal"
                  checked={props.photoreal}
                  onCheckedChange={props.setPhotoreal}
                  hint="Optimiza el prompt para fotografía hiperrealista."
                />
              </>
            )}
          </Step>

          <Step
            index={3}
            title="Referencias"
            hint={`Opcional · hasta ${props.selection.provider === 'flux' ? 8 : 11}`}
            done={props.references.length > 0}
            badge={
              props.references.length > 0 ? (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {props.references.length}
                </Badge>
              ) : null
            }
          >
            <ReferencesPanel
              value={props.references}
              onChange={props.setReferences}
              maxRefs={props.selection.provider === 'flux' ? 8 : 11}
            />
          </Step>
        </div>
      </div>

      {!props.hidePromptAndCta && (
        <footer className="shrink-0 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
          <CostLine cost={props.cost} balance={props.balance} selection={props.selection} />
          <Button
            size="lg"
            className="mt-3 w-full"
            disabled={!props.canGenerate}
            onClick={props.onGenerate}
          >
            {props.pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden /> Generando…
              </>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden /> Generar imagen
              </>
            )}
          </Button>
          {props.cost > props.balance && (
            <p className="mt-2 text-center text-xs text-amber-400">
              Te faltan {fmt(props.cost - props.balance)} créditos.
            </p>
          )}
        </footer>
      )}
    </div>
  );
}

function PromptBlock({
  value,
  onChange,
  negativePrompt,
  setNegativePrompt,
}: {
  value: string;
  onChange: (v: string) => void;
  negativePrompt: string;
  setNegativePrompt: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);
  const [negOpen, setNegOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="prompt" className="font-heading text-sm font-medium">
          Prompt
        </Label>
        <span className="text-xs text-muted-foreground">{value.length}/8000</span>
      </div>
      <Textarea
        id="prompt"
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={8000}
        placeholder="Una toma cinematográfica de un mercado en CDMX al atardecer…"
        className="resize-none"
      />
      <Collapsible open={negOpen} onOpenChange={setNegOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {negOpen ? '− Ocultar' : '+ Negative prompt'}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Textarea
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Elementos a evitar…"
            className="mt-2 resize-none text-sm"
          />
        </CollapsibleContent>
      </Collapsible>
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
  const options: { key: ModelKey; label: string; subtitle: string }[] = [
    { key: 'auto', label: 'Auto', subtitle: 'Recomendado' },
    { key: 'nano-pro', label: 'Nano Banana Pro', subtitle: 'Calidad máxima' },
    { key: 'nano-flash', label: 'Nano Flash', subtitle: 'Velocidad' },
    { key: 'flux', label: 'FLUX 2 Pro', subtitle: 'Fotorrealismo' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            'rounded-md border px-3 py-2 text-left text-sm transition-colors',
            value === opt.key
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/40',
          )}
        >
          <div className="font-medium">{opt.label}</div>
          <div className="text-xs text-muted-foreground">{opt.subtitle}</div>
        </button>
      ))}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
  hint,
  icon,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label className="flex items-center gap-1.5 text-sm font-normal">
          {icon}
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function CostLine({
  cost,
  balance,
  selection,
}: {
  cost: number;
  balance: number;
  selection: Selection;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Costo
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {labelForSelection(selection)}
        </span>
      </div>
      <span
        className={cn(
          'font-heading text-2xl font-semibold tabular-nums',
          cost > balance ? 'text-amber-400' : 'text-foreground',
        )}
      >
        {fmt(cost)}
      </span>
    </div>
  );
}

function labelForSelection(sel: Selection) {
  if (sel.provider === 'flux') return 'FLUX 2 Pro';
  if (sel.model === 'gemini-3-pro-image-preview')
    return `Nano Banana Pro · ${sel.variant.toUpperCase()}`;
  return `Nano Banana Flash · ${sel.variant.toUpperCase()}`;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-MX').format(n);
}
