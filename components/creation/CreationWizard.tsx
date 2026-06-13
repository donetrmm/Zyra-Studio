'use client';

import { useRef, useState } from 'react';
import { Loader2, Sparkles, ChevronLeft, ChevronRight, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { clarifyCreationAction, analyzeProductImageAction } from '@/server-actions/creation';
import { generateCharacter, editImage, editUploaded, generateAngle, isGenError } from './generate';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';
import type { CreationKind, ClarifyResult } from '@/lib/schemas/creation';
import type { ProductBrief } from '@/lib/campaigns/brief';

type Props = {
  kind: CreationKind;
  // El padre persiste el resultado: crea el personaje (con sus ángulos), o añade
  // la imagen al kit. angleRefIds solo aplica a personaje (máx 2).
  onSave: (refId: string, angleRefIds?: string[]) => Promise<void>;
  onClose: () => void;
};

// Una versión navegable. Las generadas traen generationId (se editan con
// editImage / parent). La foto SUBIDA del modo producto trae storagePath y NO
// generationId (se edita con editUploaded / reference).
type Version = { refId: string; previewUrl: string; generationId?: string; storagePath?: string };

type Step = 'intent' | 'clarify' | 'brief' | 'preview';

// Las mejoras de producto nunca inventan: solo ajustan fondo/luz manteniendo el
// producto idéntico. (Por eso NO hay acción "generar ángulo": fabricaría una
// cara no vista del producto — contradice la regla dura de no inventar atributos.)
const KEEP_PRODUCT = 'Keep the product identical — same shape, label, logo, colors and proportions. Do not invent, restyle or alter the product itself.';
const QUICK_ACTIONS: Array<{ label: string; instruction: string; noBackground?: boolean }> = [
  { label: 'Quitar fondo', instruction: `Place the exact same product on a clean plain white background. ${KEEP_PRODUCT}`, noBackground: true },
  { label: 'Mejorar luz', instruction: `Relight the scene with even, soft, professional product lighting that shows form and material texture. ${KEEP_PRODUCT}` },
];

export function CreationWizard({ kind, onSave, onClose }: Props) {
  const [step, setStep] = useState<Step>('intent');
  const [text, setText] = useState('');
  const [clarify, setClarify] = useState<ClarifyResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [brief, setBrief] = useState<ProductBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [current, setCurrent] = useState(0);
  const [angles, setAngles] = useState<Array<{ refId: string; previewUrl: string }>>([]);
  const [editPrompt, setEditPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const composedAppearance = () => {
    const extra = Object.values(answers).filter(Boolean).join(', ');
    const base = clarify?.enrichedPrompt ?? text.trim();
    return extra ? `${base}, ${extra}` : base;
  };

  // ---- character ----
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
      if (isGenError(out)) { toast.error(out.message || 'No se pudo generar'); return; }
      setVersions([out]);
      setCurrent(0);
      setStep('preview');
    } finally { setBusy(false); }
  }

  // ---- product ----
  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const res = await uploadReferenceFile(file);
      if (!res.ok) { toast.error(res.message); return; }
      setVersions([{ refId: res.ref.id, previewUrl: res.ref.previewUrl, storagePath: res.ref.storagePath }]);
      setCurrent(0);
      setStep('brief');
      setBriefLoading(true);
      const analyzed = await analyzeProductImageAction(res.ref.id);
      if (analyzed.ok) setBrief(analyzed.data);
      setBriefLoading(false);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ---- shared edit (rama según el origen de la versión actual) ----
  async function applyEdit(instruction: string, opts?: { noBackground?: boolean }) {
    const v = versions[current];
    if (!v || instruction.trim().length < 3) return;
    setBusy(true);
    try {
      const out = v.generationId
        ? await editImage(v.generationId, instruction.trim(), opts)
        : v.storagePath
          ? await editUploaded({ id: v.refId, storagePath: v.storagePath }, instruction.trim(), opts)
          : null;
      if (!out) return;
      if (isGenError(out)) { toast.error(out.message || 'No se pudo editar'); return; }
      const next = [...versions, out];
      setVersions(next);
      setCurrent(next.length - 1);
      setEditPrompt('');
    } finally { setBusy(false); }
  }

  function handleFreeEdit() {
    const instruction = kind === 'product' ? `${editPrompt.trim()}. ${KEEP_PRODUCT}` : editPrompt.trim();
    void applyEdit(instruction);
  }

  // Genera un ángulo del retrato actual (perfil / 3-4) para consistencia. Máx 2
  // (tope de angle_image_ids del Cast).
  async function addAngle(view: 'profile' | 'three-quarter') {
    const v = versions[current];
    if (!v?.generationId || angles.length >= 2 || busy) return;
    setBusy(true);
    try {
      const out = await generateAngle(v.generationId, view);
      if (isGenError(out)) { toast.error(out.message || 'No se pudo generar el ángulo'); return; }
      setAngles((a) => [...a, { refId: out.refId, previewUrl: out.previewUrl }]);
    } finally { setBusy(false); }
  }

  async function handleSave() {
    if (versions.length === 0) return;
    setBusy(true);
    try {
      await onSave(versions[current].refId, kind === 'character' ? angles.map((a) => a.refId) : []);
      toast.success('Guardado');
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3.5">
          <h2 className="text-[15px] font-medium text-foreground">
            {kind === 'character' ? 'Crear personaje con IA' : 'Preparar producto con IA'}
          </h2>
          <button type="button" onClick={onClose} className="text-[13px] text-muted-foreground hover:text-foreground">Cerrar</button>
        </div>

        <div className="space-y-4 p-5">
          {step === 'intent' && kind === 'character' && (
            <>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Describe lo que quieres
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="una creadora de cocina, pelo rizado, entrega cercana…"
                className="w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus:border-primary/40"
              />
              <button type="button" onClick={handleIntentNext} disabled={busy || text.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Continuar
              </button>
            </>
          )}

          {step === 'intent' && kind === 'product' && (
            <>
              <p className="text-[13px] text-muted-foreground">
                Sube una foto de tu producto. La IA la limpia y mejora — nunca inventa tu producto.
              </p>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                className="inline-flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-[13px] text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-50">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
                Subir foto del producto
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => handleUpload(e.target.files?.[0])} />
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

          {step === 'brief' && (
            <>
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                {briefLoading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {briefLoading ? 'Analizando el producto…' : 'Esto es lo que la IA ve en tu producto:'}
              </div>
              {brief && (
                <div className="space-y-1 rounded-lg border border-border bg-muted/20 p-3 text-[12.5px] text-foreground">
                  <p><span className="text-muted-foreground">Producto:</span> {brief.productName}</p>
                  <p><span className="text-muted-foreground">Categoría:</span> {brief.category}</p>
                  {brief.visualDetails && <p><span className="text-muted-foreground">Detalles:</span> {brief.visualDetails}</p>}
                  {brief.palette.length > 0 && <p><span className="text-muted-foreground">Paleta:</span> {brief.palette.join(', ')}</p>}
                </div>
              )}
              <button type="button" onClick={() => setStep('preview')} disabled={busy || briefLoading}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                Continuar
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

              {kind === 'product' && (
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_ACTIONS.map((a) => (
                    <button key={a.label} type="button" disabled={busy}
                      onClick={() => void applyEdit(a.instruction, { noBackground: a.noBackground })}
                      className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-50">
                      {a.label}
                    </button>
                  ))}
                </div>
              )}

              {kind === 'character' && (
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Ángulos para consistencia (del retrato actual)
                  </label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {angles.map((a, i) => (
                      <div key={a.refId} className="group relative size-14 overflow-hidden rounded-lg border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.previewUrl} alt={`angulo ${i + 1}`} className="size-full object-cover" />
                        <button type="button" aria-label="Quitar ángulo"
                          onClick={() => setAngles((xs) => xs.filter((x) => x.refId !== a.refId))}
                          className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100">
                          <X className="size-3" aria-hidden />
                        </button>
                      </div>
                    ))}
                    {angles.length < 2 && (
                      <>
                        <button type="button" onClick={() => void addAngle('profile')} disabled={busy}
                          className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-50">
                          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : '+ Perfil (lado)'}
                        </button>
                        <button type="button" onClick={() => void addAngle('three-quarter')} disabled={busy}
                          className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-50">
                          + 3/4
                        </button>
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground/60">Mejoran la consistencia del personaje entre videos. Opcional.</p>
                </div>
              )}

              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Editar (un cambio por vez)</label>
                <div className="mt-1.5 flex gap-2">
                  <input value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)}
                    placeholder={kind === 'character' ? 'ej. pelo más corto' : 'ej. fondo más cálido'}
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary/40" />
                  <button type="button" onClick={handleFreeEdit} disabled={busy || editPrompt.trim().length < 3}
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
