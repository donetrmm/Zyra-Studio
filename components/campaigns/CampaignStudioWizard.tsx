'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, Sparkles, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ReferenceBudget } from '@/components/shared/ReferenceBudget';
import { CreationWizard } from '@/components/creation/CreationWizard';
import { createBrandKitAction, setBrandKitImagesAction } from '@/server-actions/brand-kits';
import { createCampaignStudioAction, generatePlanAction } from '@/server-actions/campaigns';

type BrandKitOption = {
  id: string;
  name: string;
  productImages: number;
  packagingImages: number;
};

// Motivos legibles del fallback del plan dirigido (codes de ProviderError
// más 'sin_match' del saneo de la action).
const MATCHER_ERROR_HINTS: Record<string, string> = {
  rate_limit: 'Gemini alcanzó su límite de peticiones, intenta en un minuto',
  auth: 'la API key de Gemini no es válida en este entorno',
  server: 'Gemini respondió con error',
  unknown: 'la respuesta de Gemini no se pudo interpretar',
  sin_match: 'Gemini no logró mapear tus ideas al catálogo',
};

const GOALS = [
  { value: 'mixed', label: 'Mixto (awareness + conversión)' },
  { value: 'awareness', label: 'Awareness' },
  { value: 'conversion', label: 'Conversión' },
] as const;

// Wizard sin walls (specs/v2/06 §4.4): subir fotos del producto es el camino
// primario — el Brand Kit se crea implícito en el server. Elegir un kit
// existente es la alternativa, nunca un requisito previo.
// El plan sale de lo que el usuario describe (specs/v2/07): no hay selector
// de volumen — el matcher decide cuántos creativos por idea. Sin ideas, un
// paso intermedio ofrece el plan sugerido.
export function CampaignStudioWizard({
  brandKits: initialBrandKits,
  characters,
}: {
  brandKits: BrandKitOption[];
  characters: Array<{ id: string; name: string; previewUrl: string | null; angleCount: number }>;
}) {
  const router = useRouter();
  // Estado local: el producto creado con IA inline se guarda como Brand Kit y se
  // añade aquí para que aparezca en el selector sin recargar.
  const [brandKits, setBrandKits] = useState(initialBrandKits);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState<string>('mixed');
  const [language, setLanguage] = useState<'es' | 'en'>('es');
  // Formato de video de la campaña (034): default de todos los creativos.
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [productUrl, setProductUrl] = useState('');
  const [productImages, setProductImages] = useState<RefImage[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [mode, setMode] = useState<'upload' | 'kit'>('upload');
  const [brandKitId, setBrandKitId] = useState(initialBrandKits[0]?.id ?? '');
  const [ideas, setIdeas] = useState('');
  const [askIdeasOpen, setAskIdeasOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<'idle' | 'brief' | 'plan'>('idle');
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  // Empaque del Brand Kit: el usuario decide si entra a la campaña (032).
  const [includePackaging, setIncludePackaging] = useState(true);
  const ideasRef = useRef<HTMLTextAreaElement>(null);

  // El orden de selección importa: [0] es el personaje principal.
  function toggleCharacter(id: string) {
    setSelectedCharacterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id],
    );
  }
  function makePrincipal(id: string) {
    setSelectedCharacterIds((prev) => (prev.includes(id) ? [id, ...prev.filter((x) => x !== id)] : prev));
  }

  const selectedKit = brandKits.find((k) => k.id === brandKitId);
  const productReady = mode === 'upload' ? productImages.length > 0 : Boolean(selectedKit);
  const canSubmit = name.trim().length > 0 && productReady && !submitting;

  function handleCreate() {
    if (!canSubmit) return;
    // Sin ideas, el plan saldría genérico: preguntar antes de generar.
    if (!ideas.trim()) {
      setAskIdeasOpen(true);
      return;
    }
    void runCreate();
  }

  async function runCreate() {
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
      ...(selectedCharacterIds.length ? { characterIds: selectedCharacterIds } : {}),
      includePackaging,
      aspectRatio,
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
    // Con ideas, el matcher deriva cuántos creativos salen; sin ideas el
    // server arma el plan sugerido (default del schema).
    const planned = await generatePlanAction({
      campaignId: created.data.id,
      ...(ideas.trim() ? { userIdeas: ideas.trim() } : {}),
    });
    setSubmitting(false);
    if (!planned.ok) {
      toast.error(planned.message ?? 'No se pudo generar el plan');
      router.push(`/app/campaigns/${created.data.id}`);
      return;
    }
    // Nunca degradar en silencio: si dio ideas y el plan salió del mix
    // genérico (matcher caído), el usuario debe saber qué pasó y por qué.
    if (ideas.trim() && planned.data.source === 'mix') {
      const reason =
        MATCHER_ERROR_HINTS[planned.data.matcherError ?? ''] ?? 'no se pudo consultar a Gemini';
      toast.warning(`No pude interpretar tus ideas (${reason}): te propuse un plan genérico.`, {
        description: 'Edita o refina cada creativo, o crea la campaña de nuevo.',
        duration: 10000,
      });
    } else {
      toast.success(
        `Plan listo: ${planned.data.items} creativos · ~${planned.data.creditsEstimated} cr en borradores`,
      );
    }
    // Nombres mencionados en las ideas que no están en el pool: el planner
    // les inventa apariencia — avisar para que no sorprenda la cara distinta.
    if (planned.data.inventedNames?.length) {
      toast.info(
        `${planned.data.inventedNames.join(', ')}: no está(n) en la campaña, se inventó su apariencia (sin imagen de referencia).`,
        { duration: 9000 },
      );
    }
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
        Sube tu producto y describe lo que imaginas: el plan se arma con esos creativos.
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
                  className="mt-3 block text-[11.5px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  ¿Ya tienes un Brand Kit? Úsalo en su lugar
                </button>
              )}
              <button
                type="button"
                onClick={() => setAiOpen(true)}
                className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-primary underline-offset-2 hover:underline"
              >
                ¿No tienes una foto del producto? Créala con IA
                <ArrowRight className="size-3" aria-hidden />
              </button>
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
              {selectedKit && selectedKit.packagingImages > 0 && (
                <label className="mt-3 flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={includePackaging}
                    onChange={(e) => setIncludePackaging(e.target.checked)}
                    className="mt-0.5 size-3.5 accent-primary"
                  />
                  <span className="text-[12px] leading-snug text-muted-foreground">
                    Incluir las {selectedKit.packagingImages} imagen
                    {selectedKit.packagingImages !== 1 ? 'es' : ''} de empaque del kit
                    <span className="block text-[11px] text-muted-foreground/60">
                      Solo viajan al video en formatos que las usan (ej. unboxing). Si lo
                      desactivas, el plan no propondrá esos formatos.
                    </span>
                  </span>
                </label>
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
            Describe lo que imaginas
          </Label>
          <textarea
            id="campaign-ideas"
            ref={ideasRef}
            value={ideas}
            onChange={(e) => setIdeas(e.target.value)}
            placeholder="Ej. quiero 3 unboxings, algo ASMR, y un video donde mi perro usa el producto"
            maxLength={6000}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <p className="text-[11.5px] text-muted-foreground/60">
            El plan tendrá un creativo por cada idea (o los que pidas: &ldquo;3 versiones
            de&hellip;&rdquo;). Lo que no encaje en el catálogo crea un formato nuevo tuyo.
            Techo demo: 30 creativos; los borradores salen en 480p.
          </p>
        </section>

        <section>
          <Label className="text-[12.5px] font-medium text-foreground/80">
            Personajes <span className="font-normal text-muted-foreground/50">(hasta 3)</span>
          </Label>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground/60">
            Los personajes asignados pueden aparecer en los videos; nómbralos en tus ideas
            para dirigirlos (&ldquo;María hace un unboxing&rdquo;). Nombres que no asignes
            se inventan sin imagen de referencia.
          </p>
          {characters.length === 0 ? (
            <div className="mt-1.5 flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
              <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" aria-hidden />
              <div className="flex-1 text-[12px] leading-relaxed text-muted-foreground">
                <p>
                  Sin personajes en tu Cast, los formatos con presentador usarán un
                  personaje inventado (la cara cambiará entre videos).
                </p>
                <Link
                  href="/app/brand/cast"
                  className="mt-1 inline-block text-primary underline-offset-2 hover:underline"
                >
                  Crear un personaje primero
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {characters.map((c) => {
                  const idx = selectedCharacterIds.indexOf(c.id);
                  const selected = idx >= 0;
                  const full = selectedCharacterIds.length >= 3 && !selected;
                  return (
                    <div key={c.id} className="relative">
                      <button
                        type="button"
                        onClick={() => toggleCharacter(c.id)}
                        disabled={full}
                        aria-pressed={selected}
                        className={`w-full rounded-xl border p-2 text-left transition-colors ${
                          selected
                            ? 'border-primary/60 bg-primary/5'
                            : 'border-border bg-card/50 hover:border-muted-foreground/30'
                        } ${full ? 'opacity-40' : ''}`}
                      >
                        {c.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.previewUrl}
                            alt={c.name}
                            className="aspect-square w-full rounded-lg object-cover"
                          />
                        ) : (
                          <div className="grid aspect-square w-full place-items-center rounded-lg bg-muted/30">
                            <UserRound className="size-5 text-muted-foreground/40" aria-hidden />
                          </div>
                        )}
                        <p className="mt-1.5 truncate text-[12px] text-foreground/90">{c.name}</p>
                      </button>
                      {idx === 0 && (
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9.5px] font-medium text-primary-foreground">
                          Principal
                        </span>
                      )}
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => makePrincipal(c.id)}
                          className="absolute right-1.5 top-1.5 rounded-full border border-border bg-background/80 px-1.5 py-0.5 text-[9.5px] text-muted-foreground hover:text-foreground"
                        >
                          Hacer principal
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {selectedCharacterIds.length >= 3 && (
                <p className="mt-1.5 text-[11.5px] text-amber-400/80">
                  Con 3 personajes la atención del modelo se reparte y el parecido puede
                  degradarse; considera 1-2 por video.
                </p>
              )}
            </>
          )}
          <ReferenceBudget
            productPreviews={
              mode === 'upload'
                ? productImages.map((i) => i.previewUrl)
                : Array.from({ length: Math.min(selectedKit?.productImages ?? 0, 3) }, () => null)
            }
            productCount={mode === 'upload' ? productImages.length : selectedKit?.productImages ?? 0}
            packagingCount={
              mode === 'kit' && includePackaging ? selectedKit?.packagingImages ?? 0 : 0
            }
            characters={selectedCharacterIds.map((id) => {
              const c = characters.find((x) => x.id === id);
              return c
                ? { id: c.id, name: c.name, previewUrl: c.previewUrl, angleCount: c.angleCount }
                : { id, name: '', previewUrl: null, angleCount: 0 };
            })}
          />
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
          <span className="text-[12.5px] font-medium text-foreground/80">Formato de video</span>
          <div className="mt-1.5 flex gap-2">
            {(
              [
                { value: '9:16', label: '9:16 · Vertical' },
                { value: '16:9', label: '16:9 · Horizontal' },
                { value: '1:1', label: '1:1 · Cuadrado' },
              ] as const
            ).map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setAspectRatio(a.value)}
                className={`flex-1 rounded-lg border px-3 py-2 text-[13px] transition-colors ${
                  aspectRatio === a.value
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground/60">
            Aplica a todos los creativos del plan; puedes cambiarlo por video al editar.
          </p>
        </section>

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

      {aiOpen && (
        <CreationWizard
          kind="product"
          productFlow="create"
          onSave={async (result) => {
            if (result.kind !== 'product-create') return;
            // Guarda el producto generado como Brand Kit reutilizable y lo
            // selecciona para esta campaña (cubre ambos: usarlo aquí y reusarlo).
            const created = await createBrandKitAction({
              name: result.name,
              colors: result.colors,
              toneDescription: result.tone,
            });
            if (!created.ok) { toast.error(created.message || 'No se pudo crear el Brand Kit'); return; }
            const img = await setBrandKitImagesAction(created.data.id, {
              productImageIds: [result.productRefId],
              packagingImageIds: result.packagingRefId ? [result.packagingRefId] : [],
            });
            if (!img.ok) { toast.error(img.message || 'Kit creado, pero no se guardaron las imágenes'); return; }
            setBrandKits((ks) => [
              { id: created.data.id, name: result.name, productImages: 1, packagingImages: result.packagingRefId ? 1 : 0 },
              ...ks,
            ]);
            setBrandKitId(created.data.id);
            setMode('kit');
            toast.success('Brand Kit creado y seleccionado');
          }}
          onClose={() => setAiOpen(false)}
        />
      )}

      <Dialog open={askIdeasOpen} onOpenChange={setAskIdeasOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Cómo armamos el plan?</DialogTitle>
            <DialogDescription>
              No describiste lo que imaginas. Si lo cuentas, el plan tendrá exactamente
              los creativos que pidas; si prefieres, proponemos un plan inicial de 6
              creativos que puedes editar o refinar después.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAskIdeasOpen(false);
                void runCreate();
              }}
            >
              Proponer un plan por mí
            </Button>
            <Button
              onClick={() => {
                setAskIdeasOpen(false);
                ideasRef.current?.focus();
              }}
            >
              Describir mis ideas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
