'use client';

import { useRef, useState } from 'react';
import { Loader2, Sparkles, ChevronLeft, ChevronRight, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { clarifyCreationAction, analyzeKitFromImageAction } from '@/server-actions/creation';
import {
  generateCharacter,
  editImage,
  editUploaded,
  generateAngle,
  generateProductConcept,
  generatePackaging,
  isGenError,
} from './generate';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';
import { VisualStyleSelector } from '@/components/shared/VisualStyleSelector';
import type { VisualStyle } from '@/lib/prompt-director/style-profiles';
import type { CreationKind, ClarifyResult } from '@/lib/schemas/creation';

// Imagen ya existente del kit (para el flujo "mejorar").
export type ImgRef = { id: string; storagePath: string; previewUrl: string };

// Resultado tipado: el padre decide cómo persistir según la variante.
export type SaveResult =
  | { kind: 'character'; refId: string; angleRefIds: string[] }
  | {
      kind: 'product-create';
      productRefId: string;
      packagingRefId?: string;
      // Campos del kit auto-detectados y editados en el paso final.
      name: string;
      colors: { name: string; hex: string }[];
      tone?: string;
    }
  | { kind: 'product-improve'; refId: string; target: 'product' | 'packaging' };

type Props = {
  kind: CreationKind;
  // Producto: 'create' (header → kit nuevo) | 'improve' (tarjeta → modificar lo cargado).
  productFlow?: 'create' | 'improve';
  // Imágenes que el kit ya tiene (solo para 'improve'): se leen automáticamente.
  existing?: { product?: ImgRef; packaging?: ImgRef };
  onSave: (result: SaveResult) => Promise<void>;
  onClose: () => void;
};

// Versión navegable. Las generadas y las subidas traen storagePath; solo las
// generadas traen generationId (que decide editar por parent vs por reference).
type Version = { refId: string; previewUrl: string; generationId?: string; storagePath: string };

type Step = 'intent' | 'clarify' | 'preview' | 'kitfields';

const KEEP_PRODUCT = 'Keep the product identical — same shape, label, logo, colors and proportions. Do not invent, restyle or alter the product itself.';
const QUICK_ACTIONS: Array<{ label: string; instruction: string; noBackground?: boolean }> = [
  { label: 'Quitar fondo', instruction: `Place the exact same product on a clean plain white background. ${KEEP_PRODUCT}`, noBackground: true },
  { label: 'Mejorar luz', instruction: `Relight the scene with even, soft, professional product lighting that shows form and material texture. ${KEEP_PRODUCT}` },
];

export function CreationWizard({ kind, productFlow, existing, onSave, onClose }: Props) {
  const [step, setStep] = useState<Step>('intent');
  const [text, setText] = useState('');
  const [clarify, setClarify] = useState<ClarifyResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<Version[]>([]);
  const [current, setCurrent] = useState(0);
  const [angles, setAngles] = useState<Array<{ refId: string; previewUrl: string }>>([]);
  const [packaging, setPackaging] = useState<{ refId: string; previewUrl: string } | null>(null);
  const [improveTarget, setImproveTarget] = useState<'product' | 'packaging'>('product');
  const [editPrompt, setEditPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Campos del kit (flujo crear): prellenados desde el análisis de la imagen.
  const [kitName, setKitName] = useState('');
  const [kitColors, setKitColors] = useState<{ name: string; hex: string }[]>([]);
  const [kitTone, setKitTone] = useState('');
  const [kitLoading, setKitLoading] = useState(false);
  // Perfil de estilo visual del personaje (mismo selector que CastPage/wizard).
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('ultra_realista');
  const [visualStyleCustom, setVisualStyleCustom] = useState('');

  const title =
    kind === 'character' ? 'Crear personaje con IA'
      : productFlow === 'improve' ? 'Mejorar con IA'
        : 'Crear producto con IA';

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
      if (res.data.questions.length === 0) await runCharacter(res.data.enrichedPrompt);
      else setStep('clarify');
    } finally { setBusy(false); }
  }

  async function runCharacter(appearance: string) {
    setBusy(true);
    try {
      const out = await generateCharacter(
        appearance,
        undefined,
        visualStyle,
        visualStyle === 'custom' ? visualStyleCustom.trim() : undefined,
      );
      if (isGenError(out)) { toast.error(out.message || 'No se pudo generar'); return; }
      setVersions([out]); setCurrent(0); setStep('preview');
    } finally { setBusy(false); }
  }

  // ---- product: crear concepto desde cero ----
  async function runConcept() {
    if (text.trim().length < 3 || busy) return;
    setBusy(true);
    try {
      const out = await generateProductConcept(text.trim());
      if (isGenError(out)) { toast.error(out.message || 'No se pudo generar'); return; }
      setVersions([out]); setCurrent(0); setStep('preview');
    } finally { setBusy(false); }
  }

  // ---- product create: empaque a partir del producto actual ----
  async function addPackaging() {
    const v = versions[current];
    if (!v || busy) return;
    setBusy(true);
    try {
      const out = await generatePackaging({ id: v.refId, storagePath: v.storagePath }, '');
      if (isGenError(out)) { toast.error(out.message || 'No se pudo generar el empaque'); return; }
      setPackaging({ refId: out.refId, previewUrl: out.previewUrl });
    } finally { setBusy(false); }
  }

  // ---- product improve: elegir qué mejorar (lee lo que el kit ya tiene) ----
  function chooseImproveTarget(target: 'product' | 'packaging') {
    setImproveTarget(target);
    const ex = existing?.[target];
    if (ex) {
      setVersions([{ refId: ex.id, previewUrl: ex.previewUrl, storagePath: ex.storagePath }]);
      setCurrent(0);
      setStep('preview');
    } else {
      fileRef.current?.click();
    }
  }

  async function improveUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const res = await uploadReferenceFile(file);
      if (!res.ok) { toast.error(res.message); return; }
      setVersions([{ refId: res.ref.id, previewUrl: res.ref.previewUrl, storagePath: res.ref.storagePath }]);
      setCurrent(0);
      setStep('preview');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Empaque a partir del PRODUCTO que el kit ya tiene (no subir uno): la foto
  // del producto entra como referencia y se genera el empaque, editable y luego
  // guardable en packaging.
  async function genPackagingFromExisting() {
    const p = existing?.product;
    if (!p || busy) return;
    setImproveTarget('packaging');
    setBusy(true);
    try {
      const out = await generatePackaging({ id: p.id, storagePath: p.storagePath }, '');
      if (isGenError(out)) { toast.error(out.message || 'No se pudo generar el empaque'); return; }
      setVersions([out]); setCurrent(0); setStep('preview');
    } finally { setBusy(false); }
  }

  // ---- edición (rama según el origen de la versión actual) ----
  async function applyEdit(instruction: string, opts?: { noBackground?: boolean }) {
    const v = versions[current];
    if (!v || instruction.trim().length < 3) return;
    setBusy(true);
    try {
      const out = v.generationId
        ? await editImage(v.generationId, instruction.trim(), opts)
        : await editUploaded({ id: v.refId, storagePath: v.storagePath }, instruction.trim(), opts);
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

  // Guardado directo: personaje y "mejorar" (producto crear pasa por kitfields).
  async function handleSave() {
    if (versions.length === 0) return;
    setBusy(true);
    try {
      const refId = versions[current].refId;
      if (kind === 'character') {
        await onSave({ kind: 'character', refId, angleRefIds: angles.map((a) => a.refId) });
      } else {
        await onSave({ kind: 'product-improve', refId, target: improveTarget });
      }
      toast.success('Guardado');
      onClose();
    } finally { setBusy(false); }
  }

  // Crear producto: paso final con los campos del kit, prellenados del análisis.
  async function goToKitFields() {
    setStep('kitfields');
    setKitLoading(true);
    try {
      const res = await analyzeKitFromImageAction(versions[current].refId);
      if (res.ok) {
        setKitName(res.data.name);
        setKitColors(res.data.colors);
        setKitTone(res.data.tone ?? '');
      }
    } finally { setKitLoading(false); }
  }

  async function handleCreateKit() {
    if (versions.length === 0) return;
    setBusy(true);
    try {
      await onSave({
        kind: 'product-create',
        productRefId: versions[current].refId,
        packagingRefId: packaging?.refId,
        name: kitName.trim() || 'Producto IA',
        colors: kitColors,
        tone: kitTone.trim() || undefined,
      });
      toast.success('Kit creado');
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="w-full max-w-2xl gap-0 overflow-hidden rounded-xl border border-border bg-card p-0"
      >
        <DialogHeader className="border-b border-border bg-muted/30 px-5 py-3.5">
          <DialogTitle className="text-[15px] font-medium text-foreground">{title}</DialogTitle>
        </DialogHeader>

        <div className="scroll-thin max-h-[78vh] space-y-4 overflow-y-auto p-5">
          {step === 'intent' && kind === 'character' && (
            <>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Describe lo que quieres</label>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000}
                placeholder="una creadora de cocina, pelo rizado, entrega cercana…"
                className="w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estilo visual</span>
                <div className="mt-1.5">
                  <VisualStyleSelector
                    compact
                    value={visualStyle}
                    customText={visualStyleCustom}
                    onValueChange={setVisualStyle}
                    onCustomTextChange={setVisualStyleCustom}
                  />
                </div>
              </div>
              <button type="button" onClick={handleIntentNext}
                disabled={busy || text.trim().length < 3 || (visualStyle === 'custom' && visualStyleCustom.trim().length < 3)}
                title={
                  visualStyle === 'custom' && visualStyleCustom.trim().length < 3
                    ? 'Describe el estilo personalizado (mínimo 3 caracteres)'
                    : undefined
                }
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Continuar
              </button>
            </>
          )}

          {step === 'intent' && kind === 'product' && productFlow !== 'improve' && (
            <>
              <p className="text-[13px] text-muted-foreground">Describe el producto. La IA generará un <span className="text-foreground">concepto</span> — no una foto real.</p>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000}
                placeholder="ej. una lata de té matcha de 330ml, acabado mate verde salvia"
                className="w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
              <button type="button" onClick={runConcept} disabled={busy || text.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />} Generar concepto
              </button>
            </>
          )}

          {step === 'intent' && kind === 'product' && productFlow === 'improve' && (
            <>
              <p className="text-[13px] text-muted-foreground">¿Qué quieres mejorar?</p>
              {(['product', 'packaging'] as const).map((t) => {
                const ex = existing?.[t];
                return (
                  <div key={t} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                    {ex ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ex.previewUrl} alt={t} className="size-12 shrink-0 rounded-md border border-border object-cover" />
                    ) : (
                      <div className="grid size-12 shrink-0 place-items-center rounded-md border border-dashed border-border text-muted-foreground/50">
                        <ImagePlus className="size-4" aria-hidden />
                      </div>
                    )}
                    <span className="flex-1 text-[13px] text-foreground">{t === 'product' ? 'Producto' : 'Empaque'}</span>
                    {ex ? (
                      <button type="button" onClick={() => chooseImproveTarget(t)} disabled={busy}
                        className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-primary/15 disabled:opacity-50">
                        Mejorar
                      </button>
                    ) : t === 'packaging' && existing?.product ? (
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => void genPackagingFromExisting()} disabled={busy}
                          className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-primary/15 disabled:opacity-50">
                          Generar del producto
                        </button>
                        <button type="button" onClick={() => chooseImproveTarget(t)} disabled={busy}
                          className="rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50">
                          Subir
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => chooseImproveTarget(t)} disabled={busy}
                        className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-primary/15 disabled:opacity-50">
                        Subir y mejorar
                      </button>
                    )}
                  </div>
                );
              })}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => improveUpload(e.target.files?.[0])} />
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
                      <button key={s} type="button" onClick={() => setAnswers((a) => ({ ...a, [q.id]: s }))}
                        className={`rounded-full border px-2.5 py-1 text-[11.5px] ${answers[q.id] === s ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                  <input value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    placeholder="o escribe…" maxLength={120}
                    className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-1.5 text-[12.5px] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
                </div>
              ))}
              <button type="button" onClick={() => runCharacter(composedAppearance())} disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />} Generar
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

              {kind === 'product' && productFlow !== 'improve' && (
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Empaque (opcional)</label>
                  <div className="mt-1.5 flex items-center gap-2">
                    {packaging ? (
                      <div className="group relative size-14 overflow-hidden rounded-lg border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={packaging.previewUrl} alt="empaque" className="size-full object-cover" />
                        <button type="button" aria-label="Quitar empaque" onClick={() => setPackaging(null)}
                          className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100">
                          <X className="size-3" aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={addPackaging} disabled={busy}
                        className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-50">
                        {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : '+ Generar empaque'}
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground/60">Crea una caja/etiqueta coherente con el producto. Opcional.</p>
                </div>
              )}

              {kind === 'character' && (
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ángulos para consistencia (del retrato actual)</label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {angles.map((a, i) => (
                      <div key={a.refId} className="group relative size-14 overflow-hidden rounded-lg border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.previewUrl} alt={`angulo ${i + 1}`} className="size-full object-cover" />
                        <button type="button" aria-label="Quitar ángulo" onClick={() => setAngles((xs) => xs.filter((x) => x.refId !== a.refId))}
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
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
                  <button type="button" onClick={handleFreeEdit} disabled={busy || editPrompt.trim().length < 3}
                    className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-primary/15 disabled:opacity-50">
                    {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Aplicar'}
                  </button>
                </div>
              </div>

              {kind === 'product' && productFlow !== 'improve' ? (
                <button type="button" onClick={() => void goToKitFields()} disabled={busy}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Continuar
                </button>
              ) : (
                <button type="button" onClick={handleSave} disabled={busy}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Guardar
                </button>
              )}
            </>
          )}

          {step === 'kitfields' && (
            <>
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                {kitLoading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {kitLoading ? 'Detectando los datos del kit…' : 'Revisa los datos del kit y ajústalos:'}
              </div>

              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nombre del kit</label>
                <input value={kitName} onChange={(e) => setKitName(e.target.value)} maxLength={100}
                  className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
              </div>

              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Paleta de colores</label>
                <div className="mt-1.5 space-y-1.5">
                  {kitColors.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="size-6 shrink-0 rounded-md border border-border" style={{ backgroundColor: c.hex }} />
                      <input value={c.hex} maxLength={7}
                        onChange={(e) => setKitColors((cs) => cs.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))}
                        className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
                      <input value={c.name}
                        onChange={(e) => setKitColors((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
                      <button type="button" onClick={() => setKitColors((cs) => cs.filter((_, j) => j !== i))}
                        className="text-[11px] text-muted-foreground hover:text-destructive">x</button>
                    </div>
                  ))}
                  {kitColors.length < 6 && (
                    <button type="button" onClick={() => setKitColors((cs) => [...cs, { name: '', hex: '#000000' }])}
                      className="text-[11px] text-muted-foreground hover:text-foreground">+ Agregar color</button>
                  )}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tono de voz</label>
                <input value={kitTone} onChange={(e) => setKitTone(e.target.value)} maxLength={200}
                  placeholder="ej. minimalista y fresco"
                  className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50" />
              </div>

              <button type="button" onClick={handleCreateKit} disabled={busy || kitLoading}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Crear kit
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
