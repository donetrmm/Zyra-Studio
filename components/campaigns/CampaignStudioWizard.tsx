'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { createCampaignStudioAction, generatePlanAction } from '@/server-actions/campaigns';

type BrandKitOption = {
  id: string;
  name: string;
  productImages: number;
  packagingImages: number;
};

const GOALS = [
  { value: 'mixed', label: 'Mixto (awareness + conversión)' },
  { value: 'awareness', label: 'Awareness' },
  { value: 'conversion', label: 'Conversión' },
] as const;

const VOLUME_OPTIONS = [6, 12, 18, 24, 30];

export function CampaignStudioWizard({
  brandKits,
  hasCharacters,
}: {
  brandKits: BrandKitOption[];
  hasCharacters: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState<string>('mixed');
  const [productUrl, setProductUrl] = useState('');
  const [brandKitId, setBrandKitId] = useState(brandKits[0]?.id ?? '');
  const [totalItems, setTotalItems] = useState(12);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<'idle' | 'brief' | 'plan'>('idle');

  const selectedKit = brandKits.find((k) => k.id === brandKitId);
  const canSubmit = name.trim().length > 0 && !!selectedKit && !submitting;

  async function handleCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    setStep('brief');
    const created = await createCampaignStudioAction({
      name: name.trim(),
      goal,
      brandKitId,
      ...(productUrl.trim() ? { productUrl: productUrl.trim() } : {}),
    });
    if (!created.ok) {
      setSubmitting(false);
      setStep('idle');
      toast.error(
        created.error === 'validation_error'
          ? created.message ?? 'Revisa los datos'
          : created.error === 'provider_error'
            ? 'No se pudo analizar el producto, intenta de nuevo'
            : 'No se pudo crear la campaña',
      );
      return;
    }
    setStep('plan');
    const planned = await generatePlanAction({ campaignId: created.data.id, totalItems });
    setSubmitting(false);
    if (!planned.ok) {
      toast.error(planned.message ?? 'No se pudo generar el plan');
      router.push(`/app/campaigns/${created.data.id}`);
      return;
    }
    toast.success(`Plan listo: ${planned.data.items} creativos · ~${planned.data.creditsEstimated} cr en draft`);
    router.push(`/app/campaigns/${created.data.id}`);
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link
        href="/app/campaigns"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Campañas
      </Link>

      <h1 className="text-[18px] font-semibold text-foreground">Nueva campaña</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        El sistema analiza tu producto, propone el mix de formatos y arma el plan completo.
      </p>

      {brandKits.length === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-card/50 p-6 text-center">
          <p className="text-[14px] text-foreground/80">Necesitas un Brand Kit con imágenes de producto</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            El Brand Kit es la columna vertebral de la campaña: producto, paleta y tono.
          </p>
          <Link
            href="/app/brand-kits"
            className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
          >
            Crear Brand Kit
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <div>
            <label htmlFor="campaign-name" className="text-[12.5px] font-medium text-foreground/80">
              Nombre
            </label>
            <input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lanzamiento verano"
              maxLength={120}
              className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50"
            />
          </div>

          <div>
            <label htmlFor="campaign-kit" className="text-[12.5px] font-medium text-foreground/80">
              Brand Kit
            </label>
            <select
              id="campaign-kit"
              value={brandKitId}
              onChange={(e) => setBrandKitId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] text-foreground outline-none focus:border-primary/50"
            >
              {brandKits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} · {k.productImages} img producto
                </option>
              ))}
            </select>
            {selectedKit && selectedKit.productImages === 0 && (
              <p className="mt-1 text-[11.5px] text-amber-400/80">
                Este kit no tiene imágenes de producto; el brief se analizará con sus referencias generales.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="campaign-url" className="text-[12.5px] font-medium text-foreground/80">
              URL del producto <span className="text-muted-foreground/50">(opcional)</span>
            </label>
            <input
              id="campaign-url"
              type="url"
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              placeholder="https://mitienda.com/producto"
              maxLength={500}
              className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50"
            />
            <p className="mt-1 text-[11.5px] text-muted-foreground/60">
              El texto de la página (nombre, descripción, tono) enriquece el análisis del producto.
            </p>
          </div>

          <div>
            <label htmlFor="campaign-goal" className="text-[12.5px] font-medium text-foreground/80">
              Objetivo
            </label>
            <select
              id="campaign-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] text-foreground outline-none focus:border-primary/50"
            >
              {GOALS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="text-[12.5px] font-medium text-foreground/80">Volumen de creativos</span>
            <div className="mt-1.5 flex gap-2">
              {VOLUME_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTotalItems(n)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[13px] transition-colors ${
                    totalItems === n
                      ? 'border-primary/60 bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground/60">
              Techo demo: 30 creativos por campaña. Los drafts se generan en calidad de exploración (480p).
            </p>
          </div>

          {!hasCharacters && (
            <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
              Sin personajes en el Cast, el plan omite los formatos con presentador (Voz Cercana, A Pie de
              Calle).{' '}
              <Link href="/app/cast" className="text-primary hover:underline">
                Crear personaje en Cast
              </Link>
            </p>
          )}

          <button
            type="button"
            onClick={handleCreate}
            disabled={!canSubmit}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {step === 'brief' ? 'Analizando producto…' : 'Armando plan…'}
              </>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden />
                Analizar producto y armar plan
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
