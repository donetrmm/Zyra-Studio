'use client';

import { useState } from 'react';
import { Loader2, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { clarifyCreationAction } from '@/server-actions/creation';
import { generateCharacter, editImage, isGenError, type GeneratedImage } from './generate';
import type { CreationKind, ClarifyResult } from '@/lib/schemas/creation';

type Props = {
  kind: CreationKind; // Plan 1 implementa 'character'; 'product' lo añade Plan 2.
  // El padre persiste el resultado (crea el personaje con la imagen elegida).
  onSave: (refId: string) => Promise<void>;
  onClose: () => void;
};

type Step = 'intent' | 'clarify' | 'preview';

export function CreationWizard({ kind, onSave, onClose }: Props) {
  const [step, setStep] = useState<Step>('intent');
  const [text, setText] = useState('');
  const [clarify, setClarify] = useState<ClarifyResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<GeneratedImage[]>([]);
  const [current, setCurrent] = useState(0);
  const [editPrompt, setEditPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const composedAppearance = () => {
    const extra = Object.values(answers).filter(Boolean).join(', ');
    const base = clarify?.enrichedPrompt ?? text.trim();
    return extra ? `${base}, ${extra}` : base;
  };

  async function handleIntentNext() {
    if (text.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await clarifyCreationAction({ text: text.trim(), hasReference: false });
      if (!res.ok) { toast.error(res.message || 'No se pudo procesar'); return; }
      setClarify(res.data);
      if (res.data.questions.length === 0) await runGenerate(res.data.enrichedPrompt);
      else setStep('clarify');
    } finally { setBusy(false); }
  }

  async function runGenerate(appearance: string) {
    setBusy(true);
    try {
      const out = await generateCharacter(appearance);
      if (isGenError(out)) {
        toast.error(out.message || 'No se pudo generar');
        return;
      }
      setVersions([out]);
      setCurrent(0);
      setStep('preview');
    } finally { setBusy(false); }
  }

  async function handleEdit() {
    if (editPrompt.trim().length < 3 || versions.length === 0) return;
    setBusy(true);
    try {
      const parent = versions[current].generationId;
      const out = await editImage(parent, editPrompt.trim());
      if (isGenError(out)) { toast.error(out.message || 'No se pudo editar'); return; }
      const next = [...versions, out];
      setVersions(next);
      setCurrent(next.length - 1);
      setEditPrompt('');
    } finally { setBusy(false); }
  }

  async function handleSave() {
    if (versions.length === 0) return;
    setBusy(true);
    try {
      await onSave(versions[current].refId);
      toast.success('Guardado');
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3.5">
          <h2 className="text-[15px] font-medium text-foreground">
            Crear {kind === 'character' ? 'personaje' : 'producto'} con IA
          </h2>
          <button type="button" onClick={onClose} className="text-[13px] text-muted-foreground hover:text-foreground">Cerrar</button>
        </div>

        <div className="space-y-4 p-5">
          {step === 'intent' && (
            <>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Describe lo que quieres
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder={kind === 'character'
                  ? 'una creadora de cocina, pelo rizado, entrega cercana…'
                  : 'mi lata de refresco sobre fondo limpio…'}
                className="w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus:border-primary/40"
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleIntentNext} disabled={busy || text.trim().length < 3}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  Continuar
                </button>
              </div>
            </>
          )}

          {step === 'clarify' && clarify && (
            <>
              <p className="text-[13px] text-muted-foreground">Aclaremos un par de cosas:</p>
              {clarify.questions.map((q) => (
                <div key={q.id}>
                  <label className="text-[12.5px] text-foreground">{q.question}</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {q.suggestions.map((s) => (
                      <button key={s} type="button"
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: s }))}
                        className={`rounded-full border px-2.5 py-1 text-[11.5px] ${answers[q.id] === s ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                  <input value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    placeholder="o escribe…" maxLength={120}
                    className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-1.5 text-[12.5px] outline-none focus:border-primary/40" />
                </div>
              ))}
              <button type="button" onClick={() => runGenerate(composedAppearance())} disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
                Generar
              </button>
            </>
          )}

          {step === 'preview' && versions.length > 0 && (
            <>
              <div className="relative grid place-items-center rounded-lg border border-border bg-muted/20 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={versions[current].previewUrl} alt="preview" className="max-h-80 rounded object-contain" />
                {versions.length > 1 && (
                  <div className="mt-2 flex items-center gap-3 text-[12px] text-muted-foreground">
                    <button type="button" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}><ChevronLeft className="size-4" /></button>
                    v{current + 1} / {versions.length}
                    <button type="button" onClick={() => setCurrent((c) => Math.min(versions.length - 1, c + 1))} disabled={current === versions.length - 1}><ChevronRight className="size-4" /></button>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Editar (un cambio por vez)</label>
                <div className="mt-1.5 flex gap-2">
                  <input value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} placeholder="ej. pelo más corto"
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary/40" />
                  <button type="button" onClick={handleEdit} disabled={busy || editPrompt.trim().length < 3}
                    className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-primary/15 disabled:opacity-50">
                    {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Aplicar'}
                  </button>
                </div>
              </div>
              <button type="button" onClick={handleSave} disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Guardar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
