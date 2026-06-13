'use client';

// Página del refinado conversacional (specs/v2/07): chat con etapas a la
// izquierda, el creativo armándose en vivo a la derecha. El estado de la
// conversación vive aquí; nada se persiste ni cobra hasta "Aceptar".
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { acceptRefinedItemAction, refineItemTurnAction } from '@/server-actions/refine';
import { STAGES, STAGE_LABEL, type ChatTurn, type RefineDraft, type Stage } from '@/lib/refine/types';
import { SHOTS, shotBySlug } from '@/lib/shots/catalog';
import { insufficientCreditsToast } from '@/components/campaigns/credits-toast';
import {
  ReferenceImagesUploader,
  type RefImage,
} from '@/components/shared/ReferenceImagesUploader';
import { ReferenceBudget } from '@/components/shared/ReferenceBudget';

const GREETING =
  'Cuéntame qué quieres mostrar en este creativo. Puedes describirlo en tus palabras: yo me encargo de convertirlo en una buena dirección.';

export function RefineView({
  campaignId, campaignName, productName, itemId, initialDraft, formatNames, inherited,
}: {
  campaignId: string;
  campaignName: string;
  productName: string;
  itemId: string | null;
  initialDraft: RefineDraft;
  formatNames: Record<string, string>;
  inherited: {
    productPreviews: Array<string | null>;
    productCount: number;
    packagingCount: number;
    characters: Array<{ id: string; name: string; previewUrl: string | null; angleCount: number }>;
  };
}) {
  const router = useRouter();
  const turnId = useRef(1);
  const [history, setHistory] = useState<Array<ChatTurn & { id: number }>>([{ id: 0, role: 'assistant', text: GREETING }]);
  const [draft, setDraft] = useState(initialDraft);
  const [stage, setStage] = useState<Stage>('what');
  const [chips, setChips] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [showDictionary, setShowDictionary] = useState(false);
  const [refImages, setRefImages] = useState<RefImage[]>(
    initialDraft.referenceIds.map((id) => ({ id, previewUrl: null })),
  );

  async function sendTurn(text: string) {
    if (!text.trim() || pending) return;
    setPending(true);
    setFailedMessage(null);
    const res = await refineItemTurnAction({
      campaignId, itemId, history: history.map(({ role, text }) => ({ role, text })), draft, stage, userMessage: text.trim(),
    });
    setPending(false);
    if (!res.ok) {
      // El historial no se pierde: el turno fallido se puede reintentar.
      setFailedMessage(text.trim());
      toast.error('No se pudo procesar el turno. Reintenta.');
      return;
    }
    setHistory((h) => [
      ...h,
      { id: turnId.current++, role: 'user', text: text.trim() },
      { id: turnId.current++, role: 'assistant', text: res.data.reply },
    ]);
    setDraft(res.data.draft);
    setStage(res.data.stage);
    setChips(res.data.chips);
    setWarnings(res.data.validation.warnings);
    setErrors(res.data.validation.errors);
    setMessage('');
  }

  async function handleAccept() {
    setAccepting(true);
    const res = await acceptRefinedItemAction({
      campaignId, itemId, draft, acceptedWarnings: warnings,
    });
    setAccepting(false);
    if (!res.ok) {
      if (res.error === 'insufficient_credits') insufficientCreditsToast();
      else toast.error(res.message ?? 'No se pudo guardar el creativo');
      return;
    }
    toast.success('Creativo guardado en el plan');
    router.push(`/app/campaigns/${campaignId}`);
  }

  const formatLabel = draft.formatId
    ? (formatNames[draft.formatId] ?? 'Formato')
    : draft.customFormat?.name ?? 'Formato por definir';
  const shot = draft.shot ? shotBySlug(draft.shot) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/app/campaigns/${campaignId}`}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {campaignName}
        </Link>
        <p className="text-[12px] text-muted-foreground">
          Refinar creativo · {formatLabel} · el costo de la sesión se cobra solo al aceptar
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Chat */}
        <section className="flex min-h-[60dvh] flex-col rounded-xl border border-border bg-card/50">
          <nav aria-label="Etapas del refinado" className="flex gap-3 border-b border-border/60 px-4 py-2.5 text-[11.5px]">
            {STAGES.map((s) => (
              <span
                key={s}
                aria-current={s === stage ? 'step' : undefined}
                className={cn(
                  s === stage ? 'font-medium text-primary'
                    : STAGES.indexOf(s) < STAGES.indexOf(stage) ? 'text-foreground/70'
                    : 'text-muted-foreground/50',
                )}
              >
                {STAGE_LABEL[s]}
              </span>
            ))}
          </nav>

          <div aria-live="polite" aria-label="Conversación de refinado" className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {history.map((t) => (
              <div key={t.id} className={cn('max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed', t.role === 'assistant' ? 'bg-muted/40 text-foreground' : 'ml-auto bg-primary/10 text-foreground')}>
                {t.text}
              </div>
            ))}
            {pending && (
              <div className="inline-flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Pensando…
              </div>
            )}
            {failedMessage && (
              <button
                type="button"
                onClick={() => sendTurn(failedMessage)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 px-3 py-2 text-[12.5px] text-amber-300 hover:bg-amber-400/10"
              >
                <RotateCcw className="size-3.5" aria-hidden /> Reintentar el último mensaje
              </button>
            )}
          </div>

          {chips.length > 0 && !pending && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => sendTurn(c)}
                  className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {stage === 'shot' && (
            <div className="px-4 pb-2">
              <button
                type="button"
                onClick={() => setShowDictionary((v) => !v)}
                className="text-[11.5px] text-primary underline-offset-2 hover:underline"
              >
                {showDictionary ? 'Ocultar diccionario de tomas' : 'Ver todas las tomas'}
              </button>
              {showDictionary && (
                <div className="mt-2 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                  {SHOTS.map((s) => (
                    <button
                      key={s.slug}
                      type="button"
                      onClick={() => sendTurn(`Quiero la toma ${s.name} (${s.slug})`)}
                      className={cn('rounded-lg border p-2 text-left transition-colors', draft.shot === s.slug ? 'border-primary/60 bg-primary/5' : 'border-border hover:border-muted-foreground/30')}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.image} alt={s.name} loading="lazy" className="mb-1.5 aspect-[3/2] w-full rounded object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <p className="text-[12px] font-medium text-foreground">{s.name}</p>
                      <p className="text-[11px] leading-snug text-muted-foreground">{s.whenToUse}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {stage === 'refs' && (
            <div className="border-t border-border/40 px-4 py-3">
              <ReferenceImagesUploader
                label="Referencias del creativo"
                hint="Producto, empaque o entorno: lo que el modelo debe respetar fiel."
                images={refImages}
                onChange={(imgs) => {
                  setRefImages(imgs);
                  setDraft((d) => ({ ...d, referenceIds: imgs.map((i) => i.id) }));
                }}
                max={6}
              />
            </div>
          )}

          <form
            className="flex gap-2 border-t border-border/60 p-3"
            onSubmit={(e) => { e.preventDefault(); sendTurn(message); }}
          >
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escribe tu respuesta…"
              aria-label="Tu respuesta"
              className="min-h-11 flex-1 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <button
              type="submit"
              disabled={pending || !message.trim()}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
            >
              <Sparkles className="size-4" aria-hidden /> Enviar
            </button>
          </form>
        </section>

        {/* Borrador en vivo */}
        <aside className="h-fit rounded-xl border border-border bg-card/30 p-4 text-[12.5px]">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tu creativo</p>
          <dl aria-live="polite" className="mt-3 space-y-3">
            <div>
              <dt className="text-muted-foreground/80">Producto</dt>
              <dd className="text-foreground/90">{productName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground/80">Formato</dt>
              <dd className="text-foreground/90">{formatLabel}{draft.customFormat && ' · nuevo, se creará al aceptar'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground/80">Escena</dt>
              <dd className="text-foreground/90">
                {draft.sceneSummary || draft.scenePrompt || '— construyéndose —'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground/80">Toma</dt>
              <dd className="text-foreground/90">{shot ? `${shot.name} — ${shot.description}` : 'La decide el director según el formato'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground/80">Referencias</dt>
              <dd>
                <ReferenceBudget
                  productPreviews={inherited.productPreviews}
                  productCount={inherited.productCount}
                  packagingCount={inherited.packagingCount}
                  characters={inherited.characters}
                  extraCount={draft.referenceIds.length}
                />
              </dd>
            </div>
            {errors.length > 0 && (
              <div>
                <dt className="text-red-400">Bloqueos</dt>
                {errors.map((e) => <dd key={e} className="text-red-300/90">{e}</dd>)}
              </div>
            )}
            {warnings.length > 0 && (
              <div>
                <dt className="text-amber-400">Puede afectar el resultado</dt>
                {warnings.map((w) => <dd key={w} className="text-amber-200/80">{w}</dd>)}
              </div>
            )}
          </dl>
          <button
            type="button"
            disabled={accepting || errors.length > 0 || !draft.scenePrompt.trim() || stage !== 'review'}
            onClick={handleAccept}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {accepting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            Aceptar y guardar
          </button>
          <Link
            href={`/app/campaigns/${campaignId}`}
            className="mt-2 block text-center text-[12px] text-muted-foreground hover:text-foreground"
          >
            Descartar (no cuesta nada)
          </Link>
        </aside>
      </div>
    </div>
  );
}
