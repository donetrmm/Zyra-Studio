'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { PricingRow } from '@/lib/credits/types';
import { estimateCredits } from '@/lib/credits/estimator';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';
import {
  STUDIO_MODELS,
  variantControlFor,
  defaultVariantFor,
  resolveSelection,
  maxReferencesFor,
  type StudioModelKey,
} from '@/lib/studio/model-options';
import { BUILTIN_PRESETS, type StudioPreset } from '@/lib/studio/presets';
import type { StudioRefOption, StudioAssetType } from './types';

const ASPECTS = ['1:1', '4:5', '9:16', '16:9'];
const VARIANT_LABEL: Record<string, string> = {
  '1k': '1K',
  '2k': '2K',
  '4k': '4K',
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
};

export type ComposerSubmit = {
  provider: 'nano-banana' | 'gpt-image';
  model: string;
  variant: string;
  prompt: string;
  aspectRatio: string;
  keepIdentical: boolean;
  referenceIds: string[];
};

export function Composer(props: {
  pricing: PricingRow[];
  balance: number;
  availableReferences: StudioRefOption[];
  hasWorkingImage: boolean;
  disabled: boolean;
  onSubmit: (input: ComposerSubmit) => void;
  assetType: StudioAssetType;
  userPresets: StudioPreset[];
  // Semilla para reintentar: al cambiar nonce, rellena el prompt y enfoca. Evita
  // levantar el estado del prompt al padre (el chat pide reintentar un fallo).
  seed?: { text: string; nonce: number };
}) {
  const [modelKey, setModelKey] = useState<StudioModelKey>('nano-pro');
  const [variant, setVariant] = useState<string>(defaultVariantFor('nano-pro'));
  const [aspect, setAspect] = useState('1:1');
  const [keepIdentical, setKeepIdentical] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [refs, setRefs] = useState<StudioRefOption[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [lastSeedNonce, setLastSeedNonce] = useState(0);

  // Reintentar desde el chat: al cambiar el nonce, rellena el prompt del fallo.
  // Patrón de React (ajustar estado en render al cambiar un prop) en vez de un
  // efecto con setState, que dispara renders en cascada.
  if (props.seed && props.seed.nonce !== lastSeedNonce) {
    setLastSeedNonce(props.seed.nonce);
    setPrompt(props.seed.text);
  }
  // El foco sí es efecto colateral (no toca estado): enfoca al aplicar la semilla.
  useEffect(() => {
    if (lastSeedNonce > 0) textareaRef.current?.focus();
  }, [lastSeedNonce]);

  const builtinPresets = BUILTIN_PRESETS[props.assetType];
  const applyPreset = (id: string) => {
    const preset =
      builtinPresets.find((p) => p.id === id) ?? props.userPresets.find((p) => p.id === id);
    if (!preset) return;
    setPrompt(preset.prompt);
    if (preset.keepIdentical) setKeepIdentical(true);
  };
  const hasPresets = builtinPresets.length > 0 || props.userPresets.length > 0;

  const variantControl = variantControlFor(modelKey);
  const selection = resolveSelection(modelKey, variant);
  const maxRefs = maxReferencesFor(selection.provider, props.hasWorkingImage);

  const cost = useMemo(() => {
    try {
      return estimateCredits(props.pricing, {
        provider: selection.provider,
        model: selection.model,
        variant: selection.variant,
      }).total;
    } catch {
      return null;
    }
  }, [props.pricing, selection.provider, selection.model, selection.variant]);

  const insufficient = cost !== null && cost > props.balance;
  const canSubmit = !props.disabled && prompt.trim().length > 0 && !insufficient;

  function changeModel(key: StudioModelKey) {
    setModelKey(key);
    setVariant(defaultVariantFor(key));
    // Recorta referencias si el nuevo proveedor admite menos.
    const nextMax = maxReferencesFor(resolveSelection(key, defaultVariantFor(key)).provider, props.hasWorkingImage);
    setRefs((r) => r.slice(0, nextMax));
  }

  function toggleRef(opt: StudioRefOption) {
    setRefs((cur) => {
      if (cur.some((r) => r.id === opt.id)) return cur.filter((r) => r.id !== opt.id);
      if (cur.length >= maxRefs) {
        toast.error(`Este modelo admite hasta ${maxRefs} referencia(s)${props.hasWorkingImage ? ' (la imagen de trabajo ocupa un cupo)' : ''}`);
        return cur;
      }
      return [...cur, opt];
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (refs.length >= maxRefs) {
      toast.error(`Este modelo admite hasta ${maxRefs} referencia(s)`);
      return;
    }
    setUploading(true);
    const res = await uploadReferenceFile(file);
    setUploading(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setRefs((cur) => [...cur, { id: res.ref.id, previewUrl: res.ref.previewUrl, filename: res.ref.filename }]);
  }

  function submit() {
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast.error('Escribe un prompt');
      return;
    }
    if (cost !== null && cost > props.balance) {
      toast.error('Créditos insuficientes');
      return;
    }
    const effectiveRefs = refs.slice(0, maxRefs);
    if (effectiveRefs.length < refs.length) {
      toast.info(
        `Se usaron ${effectiveRefs.length} de ${refs.length} referencias (la imagen de trabajo ocupa un cupo).`,
      );
    }
    props.onSubmit({
      provider: selection.provider,
      model: selection.model,
      variant: selection.variant,
      prompt: trimmed,
      aspectRatio: aspect,
      keepIdentical,
      referenceIds: effectiveRefs.map((r) => r.id),
    });
    setPrompt('');
    setRefs([]);
  }

  return (
    <div className="space-y-3 border-t border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={modelKey} onValueChange={(v) => changeModel(v as StudioModelKey)}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STUDIO_MODELS.map((m) => (
              <SelectItem key={m.key} value={m.key} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {variantControl.kind !== 'none' ? (
          <Select value={variant} onValueChange={setVariant}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {variantControl.options.map((o) => (
                <SelectItem key={o} value={o} className="text-xs">
                  {variantControl.kind === 'quality' ? `Calidad: ${VARIANT_LABEL[o] ?? o}` : VARIANT_LABEL[o] ?? o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Select value={aspect} onValueChange={setAspect}>
          <SelectTrigger className="h-8 w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASPECTS.map((a) => (
              <SelectItem key={a} value={a} className="text-xs">
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasPresets ? (
          <Select value="" onValueChange={applyPreset}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Presets" />
            </SelectTrigger>
            <SelectContent>
              {builtinPresets.length > 0 ? (
                <SelectGroup>
                  <SelectLabel className="text-xs">Sugeridos</SelectLabel>
                  {builtinPresets.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              {props.userPresets.length > 0 ? (
                <SelectGroup>
                  <SelectLabel className="text-xs">Guardados</SelectLabel>
                  {props.userPresets.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>
        ) : null}

        <label
          className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-foreground"
          title="Conserva la identidad del sujeto (rostro, forma, color) entre ediciones."
        >
          <Switch checked={keepIdentical} onCheckedChange={setKeepIdentical} />
          Mantener idéntico
        </label>
      </div>

      {props.availableReferences.length > 0 || refs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Referencias:</span>
          {props.availableReferences.map((opt) => {
            const active = refs.some((r) => r.id === opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggleRef(opt)}
                className={`h-10 w-10 overflow-hidden rounded border ${
                  active ? 'border-brand ring-1 ring-brand' : 'border-border'
                }`}
                title={opt.filename}
              >
                {opt.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={opt.previewUrl} alt={opt.filename} className="h-full w-full object-cover" />
                ) : null}
              </button>
            );
          })}
          {/* Referencias subidas que no venían del producto */}
          {refs
            .filter((r) => !props.availableReferences.some((a) => a.id === r.id))
            .map((r) => (
              <span
                key={r.id}
                className="flex h-10 items-center gap-1 rounded border border-brand bg-muted px-2 text-xs text-foreground"
              >
                {r.filename.slice(0, 12)}
                <button type="button" onClick={() => setRefs((cur) => cur.filter((x) => x.id !== r.id))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || refs.length >= maxRefs}
            className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onFile}
          />
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || refs.length >= maxRefs}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            Adjuntar referencia
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onFile}
          />
        </div>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) submit();
          }}
          placeholder={props.hasWorkingImage ? 'Describe el cambio sobre la imagen de trabajo…' : 'Describe la imagen…'}
          rows={2}
          className="resize-none text-sm"
        />
        <Button type="button" onClick={submit} disabled={!canSubmit} className="h-10 gap-1.5">
          {props.disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar
        </Button>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          <kbd className="rounded border border-border px-1 py-0.5 font-sans text-[10px]">⌘/Ctrl</kbd>
          {' + '}
          <kbd className="rounded border border-border px-1 py-0.5 font-sans text-[10px]">Enter</kbd>
          {' para enviar'}
        </span>
        {cost !== null ? (
          <span className={insufficient ? 'font-medium text-destructive' : 'text-muted-foreground'}>
            {cost} créditos{insufficient ? ' · saldo insuficiente' : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}
