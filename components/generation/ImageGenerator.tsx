'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  Coins,
  Download,
  ImagePlus,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ReferencesPanel, type ReferenceClient } from './ReferencesPanel';
import type { PricingRow } from '@/lib/credits/types';
import { estimateCredits } from '@/lib/credits/estimator';
import { selectImageModel } from '@/lib/router/model-selector';
import { submitGenerationAction } from '@/server-actions/generations';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import { cn } from '@/lib/utils';

type ModelKey = 'auto' | 'nano-pro' | 'nano-flash' | 'flux';

type SessionItem = {
  id: string;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  prompt: string;
  model: string;
  variant: string;
  credits: number;
  createdAt: number;
};

const NANO_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;
const FLUX_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;

export function ImageGenerator(props: {
  userId: string;
  workspaceId: string;
  initialBalance: number;
  pricing: PricingRow[];
}) {
  const balance = useLiveBalance(props.userId, props.initialBalance);

  const [modelKey, setModelKey] = useState<ModelKey>('nano-pro');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [resolution, setResolution] = useState<'1k' | '2k' | '4k'>('2k');
  const [hasTextInImage, setHasTextInImage] = useState(false);
  const [conversational, setConversational] = useState(false);
  const [useGrounding, setUseGrounding] = useState(false);
  const [photoreal, setPhotoreal] = useState(false);
  const [megapixels, setMegapixels] = useState<1 | 2 | 4>(1);
  const [references, setReferences] = useState<ReferenceClient[]>([]);
  const [session, setSession] = useState<SessionItem[]>([]);
  const [activeResult, setActiveResult] = useState<SessionItem | null>(null);
  const [pending, startTransition] = useTransition();

  const selection = useMemo(() => {
    if (modelKey === 'auto') {
      return selectImageModel({
        hasTextInImage,
        references,
        useGrounding,
        resolution,
        priority: 'quality',
      });
    }
    if (modelKey === 'nano-pro') {
      return {
        provider: 'nano-banana' as const,
        model: 'gemini-3-pro-image-preview',
        variant: resolution,
      };
    }
    if (modelKey === 'nano-flash') {
      return {
        provider: 'nano-banana' as const,
        model: 'gemini-3.1-flash-image-preview',
        variant: resolution === '4k' ? '2k' : resolution,
      };
    }
    return {
      provider: 'flux' as const,
      model: 'flux-2-pro-preview',
      variant: 'default',
    };
  }, [modelKey, hasTextInImage, references, useGrounding, resolution]);

  const breakdown = useMemo(() => {
    try {
      return estimateCredits(props.pricing, {
        provider: selection.provider,
        model: selection.model,
        variant: selection.variant,
        params:
          selection.provider === 'flux'
            ? { megapixels, references: references.length }
            : { conversational, useGrounding },
      });
    } catch {
      return null;
    }
  }, [props.pricing, selection, conversational, useGrounding, megapixels, references.length]);

  const cost = breakdown?.total ?? 0;
  const canGenerate = prompt.trim().length > 0 && cost > 0 && cost <= balance && !pending;

  const buildInput = useCallback(() => {
    if (selection.provider === 'nano-banana') {
      return {
        provider: 'nano-banana' as const,
        model: selection.model as 'gemini-3-pro-image-preview' | 'gemini-3.1-flash-image-preview',
        variant: selection.variant as '1k' | '2k' | '4k',
        prompt,
        negativePrompt: negativePrompt.trim() || undefined,
        aspectRatio,
        references: references.map((r) => ({ id: r.id, storagePath: r.storagePath })),
        hasTextInImage,
        conversational,
        useGrounding,
        // En modo conversacional, anclamos la generación previa para que el
        // server la inyecte como referencia y mantenga la composición.
        parentGenerationId:
          conversational && activeResult ? activeResult.id : undefined,
      };
    }
    return {
      provider: 'flux' as const,
      model: 'flux-2-pro-preview' as const,
      variant: 'default' as const,
      prompt,
      negativePrompt: negativePrompt.trim() || undefined,
      aspectRatio,
      megapixels,
      references: references.map((r) => ({ id: r.id, storagePath: r.storagePath })),
      photoreal,
    };
  }, [
    selection,
    prompt,
    negativePrompt,
    aspectRatio,
    references,
    hasTextInImage,
    conversational,
    useGrounding,
    megapixels,
    photoreal,
    activeResult,
  ]);

  function handleGenerate() {
    if (!canGenerate) return;
    const input = buildInput();
    startTransition(async () => {
      const res = await submitGenerationAction(input);
      if (!res.ok) {
        const msg =
          res.error === 'insufficient_credits'
            ? 'Créditos insuficientes para esta generación.'
            : res.error === 'safety'
              ? 'El proveedor rechazó el contenido por políticas de seguridad.'
              : res.error === 'validation_error'
                ? 'Parámetros inválidos. Revisa el prompt y los ajustes.'
                : res.message || 'No se pudo generar la imagen.';
        toast.error(msg);
        return;
      }
      const detail = await fetchGenerationDetail(res.data.generationId);
      if (detail) {
        setSession((prev) => [detail, ...prev].slice(0, 12));
        setActiveResult(detail);
        toast.success('Imagen lista');
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[420px,1fr]">
      <Card className="space-y-5 p-5">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-xl font-semibold">Imagen</h1>
            <p className="text-xs text-muted-foreground">
              Describe lo que quieres y elige modelo.
            </p>
          </div>
          <Badge variant="outline" className="gap-1">
            <Coins className="size-3" aria-hidden /> {fmt(balance)}
          </Badge>
        </header>

        <ModelPicker value={modelKey} onChange={setModelKey} />

        <PromptInput value={prompt} onChange={setPrompt} />

        <NegativePromptInput value={negativePrompt} onChange={setNegativePrompt} />

        <ParamsPanel
          provider={selection.provider}
          aspectRatio={aspectRatio}
          setAspectRatio={setAspectRatio}
          resolution={resolution}
          setResolution={setResolution}
          hasTextInImage={hasTextInImage}
          setHasTextInImage={setHasTextInImage}
          conversational={conversational}
          setConversational={setConversational}
          useGrounding={useGrounding}
          setUseGrounding={setUseGrounding}
          megapixels={megapixels}
          setMegapixels={setMegapixels}
          photoreal={photoreal}
          setPhotoreal={setPhotoreal}
          activeResult={activeResult}
        />

        <ReferencesPanel value={references} onChange={setReferences} maxRefs={selection.provider === 'flux' ? 8 : 11} />

        <CostPreview cost={cost} balance={balance} selection={selection} />

        <Button
          size="lg"
          className="w-full"
          disabled={!canGenerate}
          onClick={handleGenerate}
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden /> Generando…
            </>
          ) : (
            <>
              <Sparkles className="size-4" aria-hidden /> Generar imagen
            </>
          )}
        </Button>
        {cost > balance && (
          <p className="text-center text-xs text-amber-400">
            Te faltan {fmt(cost - balance)} créditos.
          </p>
        )}
      </Card>

      <div className="space-y-5">
        <PreviewPanel pending={pending} result={activeResult} provider={selection.provider} />
        {session.length > 0 && (
          <Card className="space-y-3 p-5">
            <h2 className="font-heading text-sm text-muted-foreground">
              Esta sesión ({session.length})
            </h2>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {session.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveResult(item)}
                  className={cn(
                    'aspect-square overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-primary/60',
                    activeResult?.id === item.id && 'border-primary',
                  )}
                >
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">…</span>
                  )}
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
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

function PromptInput({
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
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor="prompt">Prompt</Label>
        <span className="text-xs text-muted-foreground">{value.length}/8000</span>
      </div>
      <Textarea
        id="prompt"
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={8000}
        placeholder='Una toma cinematográfica de un mercado en CDMX al atardecer…'
        className="resize-none"
      />
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
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? '− Ocultar' : '+ Negative prompt'}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Elementos a evitar…"
          className="mt-2 resize-none text-sm"
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

function ParamsPanel(props: {
  provider: 'nano-banana' | 'flux';
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
  megapixels: 1 | 2 | 4;
  setMegapixels: (v: 1 | 2 | 4) => void;
  photoreal: boolean;
  setPhotoreal: (v: boolean) => void;
  activeResult: SessionItem | null;
}) {
  const aspects = props.provider === 'flux' ? FLUX_ASPECTS : NANO_ASPECTS;
  return (
    <div className="space-y-3">
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

      {props.provider === 'nano-banana' ? (
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
                4K toma ~25–55s y puede acercarse al límite.
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
            label="Edición conversacional"
            checked={props.conversational}
            onCheckedChange={props.setConversational}
            hint={
              props.conversational
                ? props.activeResult
                  ? '+50% créditos. Iterando sobre la última generación.'
                  : '+50% créditos. Genera una imagen primero para tener una base.'
                : '+50% créditos. Mantiene composición entre iteraciones.'
            }
          />
          <ToggleRow
            label="Grounding (Google Search)"
            checked={props.useGrounding}
            onCheckedChange={props.setUseGrounding}
            hint="+20% créditos. Usa datos en tiempo real (clima, eventos)."
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
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label className="text-sm font-normal">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function CostPreview({
  cost,
  balance,
  selection,
}: {
  cost: number;
  balance: number;
  selection: { provider: string; model: string; variant: string };
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Costo estimado
        </span>
        <span
          className={cn(
            'font-heading text-2xl font-semibold tabular-nums',
            cost > balance ? 'text-amber-400' : 'text-foreground',
          )}
        >
          {fmt(cost)}
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {labelForSelection(selection)}
      </p>
    </div>
  );
}

function PreviewPanel({
  pending,
  result,
  provider,
}: {
  pending: boolean;
  result: SessionItem | null;
  provider: string;
}) {
  if (pending) {
    return (
      <Card className="flex aspect-video flex-col items-center justify-center gap-3 p-10">
        <Skeleton className="size-24 rounded-full" />
        <div className="space-y-2 text-center">
          <p className="font-medium">Generando…</p>
          <p className="text-xs text-muted-foreground">
            {provider === 'flux'
              ? 'FLUX 2 Pro · ~8–15s'
              : 'Nano Banana · ~10–25s'}
          </p>
        </div>
      </Card>
    );
  }
  if (!result) {
    return (
      <Card className="flex aspect-video flex-col items-center justify-center gap-3 border-dashed p-10 text-center">
        <Wand2 className="size-8 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-medium">Lista para crear</p>
          <p className="text-xs text-muted-foreground">
            Escribe un prompt y presiona Generar.
          </p>
        </div>
      </Card>
    );
  }
  return (
    <Card className="space-y-3 p-5">
      <div className="overflow-hidden rounded-md bg-muted">
        {result.outputUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.outputUrl}
            alt={result.prompt}
            className="size-full object-contain"
          />
        ) : (
          <Skeleton className="aspect-video w-full" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">{result.model}</Badge>
        <Badge variant="outline">{result.variant}</Badge>
        <Badge variant="outline" className="gap-1">
          <Coins className="size-3" aria-hidden /> {fmt(result.credits)}
        </Badge>
        <span className="text-muted-foreground">{relativeTime(result.createdAt)}</span>
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{result.prompt}</p>
      <div className="flex gap-2">
        {result.outputUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={result.outputUrl} download target="_blank" rel="noreferrer">
              <Download className="size-4" aria-hidden /> Descargar
            </a>
          </Button>
        )}
        <Button asChild variant="ghost" size="sm">
          <a href="/app/library">
            <ImagePlus className="size-4" aria-hidden /> Ver biblioteca
          </a>
        </Button>
      </div>
    </Card>
  );
}

function labelForSelection(sel: { provider: string; model: string; variant: string }) {
  if (sel.provider === 'flux') return 'FLUX 2 Pro';
  if (sel.model === 'gemini-3-pro-image-preview') return `Nano Banana Pro · ${sel.variant.toUpperCase()}`;
  return `Nano Banana Flash · ${sel.variant.toUpperCase()}`;
}

async function fetchGenerationDetail(id: string): Promise<SessionItem | null> {
  try {
    const res = await fetch(`/api/generations/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data as SessionItem;
  } catch {
    return null;
  }
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-MX').format(n);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  return `hace ${Math.floor(m / 60)}h`;
}
