'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Sparkles, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ReferenceImagesUploader,
  type RefImage,
} from '@/components/shared/ReferenceImagesUploader';
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

// Wizard sin walls (specs/v2/06 §4.4): subir fotos del producto es el camino
// primario — el Brand Kit se crea implícito en el server. Elegir un kit
// existente es la alternativa, nunca un requisito previo.
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
  const [language, setLanguage] = useState<'es' | 'en'>('es');
  const [productUrl, setProductUrl] = useState('');
  const [productImages, setProductImages] = useState<RefImage[]>([]);
  const [mode, setMode] = useState<'upload' | 'kit'>('upload');
  const [brandKitId, setBrandKitId] = useState(brandKits[0]?.id ?? '');
  const [ideas, setIdeas] = useState('');
  const [totalItems, setTotalItems] = useState(12);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<'idle' | 'brief' | 'plan'>('idle');

  const selectedKit = brandKits.find((k) => k.id === brandKitId);
  const productReady = mode === 'upload' ? productImages.length > 0 : Boolean(selectedKit);
  const canSubmit = name.trim().length > 0 && productReady && !submitting;

  async function handleCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    setStep('brief');
    const created = await createCampaignStudioAction({
      name: name.trim(),
      goal,
      language,
      ...(mode === 'upload'
        ? { productImageIds: productImages.map((img) => img.id) }
        : { brandKitId }),
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
    const planned = await generatePlanAction({
      campaignId: created.data.id,
      totalItems,
      ...(ideas.trim() ? { userIdeas: ideas.trim() } : {}),
    });
    setSubmitting(false);
    if (!planned.ok) {
      toast.error(planned.message ?? 'No se pudo generar el plan');
      router.push(`/app/campaigns/${created.data.id}`);
      return;
    }
    toast.success(
      `Plan listo: ${planned.data.items} creativos · ~${planned.data.creditsEstimated} cr en borradores`,
    );
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
        Sube tu producto y el sistema propone el mix de formatos y arma el plan completo.
      </p>

      <div className="mt-6 space-y-6">
        <section>
          <Label className="text-[12.5px] font-medium text-foreground/80">Tu producto</Label>
          {mode === 'upload' ? (
            <div className="mt-1.5 rounded-xl border border-border bg-card/50 p-4">
              <ReferenceImagesUploader
                label="Fotos del producto"
                hint="1 a 6 imágenes: frontal, perfil, detalle. Mejor con fondo simple."
                images={productImages}
                onChange={setProductImages}
                max={6}
              />
              {brandKits.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMode('kit')}
                  className="mt-3 text-[11.5px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  ¿Ya tienes un Brand Kit? Úsalo en su lugar
                </button>
              )}
            </div>
          ) : (
            <div className="mt-1.5 rounded-xl border border-border bg-card/50 p-4">
              <Select value={brandKitId} onValueChange={setBrandKitId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Elige un Brand Kit" />
                </SelectTrigger>
                <SelectContent>
                  {brandKits.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name} · {k.productImages} img producto
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedKit && selectedKit.productImages === 0 && (
                <p className="mt-2 text-[11.5px] text-amber-400/80">
                  Este kit no tiene imágenes de producto; el análisis usará sus referencias
                  generales.
                </p>
              )}
              <button
                type="button"
                onClick={() => setMode('upload')}
                className="mt-3 text-[11.5px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                Mejor subir fotos nuevas
              </button>
            </div>
          )}
        </section>

        <section className="space-y-1.5">
          <Label htmlFor="campaign-name" className="text-[12.5px] font-medium text-foreground/80">
            Nombre de la campaña
          </Label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lanzamiento verano"
            maxLength={120}
          />
        </section>

        <section className="space-y-1.5">
          <Label htmlFor="campaign-url" className="text-[12.5px] font-medium text-foreground/80">
            URL del producto <span className="font-normal text-muted-foreground/50">(opcional)</span>
          </Label>
          <Input
            id="campaign-url"
            type="url"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder="https://mitienda.com/producto"
            maxLength={500}
          />
          <p className="text-[11.5px] text-muted-foreground/60">
            El texto de la página (nombre, descripción, tono) enriquece el análisis.
          </p>
        </section>

        <section className="space-y-1.5">
          <Label htmlFor="campaign-ideas" className="text-[12.5px] font-medium text-foreground/80">
            Describe lo que imaginas <span className="font-normal text-muted-foreground/50">(opcional)</span>
          </Label>
          <textarea
            id="campaign-ideas"
            value={ideas}
            onChange={(e) => setIdeas(e.target.value)}
            placeholder="Ej. quiero unboxings, algo ASMR, y un video donde mi perro usa el producto"
            maxLength={2000}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
          />
          <p className="text-[11.5px] text-muted-foreground/60">
            Tus ideas guían el mix de formatos; las que no encajen en el catálogo crean un formato nuevo tuyo.
          </p>
        </section>

        <section className="space-y-1.5">
          <Label htmlFor="campaign-goal" className="text-[12.5px] font-medium text-foreground/80">
            Objetivo
          </Label>
          <Select value={goal} onValueChange={setGoal}>
            <SelectTrigger id="campaign-goal" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GOALS.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        <section>
          <span className="text-[12.5px] font-medium text-foreground/80">Idioma hablado</span>
          <div className="mt-1.5 flex gap-2">
            {(
              [
                { value: 'es', label: 'Español' },
                { value: 'en', label: 'English' },
              ] as const
            ).map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setLanguage(l.value)}
                className={`flex-1 rounded-lg border px-3 py-2 text-[13px] transition-colors ${
                  language === l.value
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground/60">
            Idioma de los diálogos y voz en off de los videos; el caption sale en español.
          </p>
        </section>

        <section>
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
            Techo demo: 30 creativos por campaña. Los borradores se generan en calidad de
            exploración (480p).
          </p>
        </section>

        {!hasCharacters && (
          <section className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
            <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" aria-hidden />
            <div className="flex-1 text-[12px] leading-relaxed text-muted-foreground">
              <p>
                Sin personas en tu Cast, el plan omite los formatos con presentador (Voz Cercana, A
                Pie de Calle). Puedes continuar así y agregarlos después.
              </p>
              <Link
                href="/app/brand/cast"
                className="mt-1 inline-block text-primary underline-offset-2 hover:underline"
              >
                Crear un presentador primero
              </Link>
            </div>
          </section>
        )}

        <Button className="w-full" size="lg" disabled={!canSubmit} onClick={handleCreate}>
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
        </Button>
      </div>
    </div>
  );
}
