'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, ChevronDown, Loader2, Sparkles, UserRound } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
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
import { VisualStyleSelector } from '@/components/shared/VisualStyleSelector';
import type { VisualStyle } from '@/lib/prompt-director/style-profiles';
import { CreationWizard } from '@/components/creation/CreationWizard';
import { createBrandKitAction, setBrandKitImagesAction } from '@/server-actions/brand-kits';
import {
  createCampaignStudioAction,
  generatePlanAction,
  ingestMasterPromptAction,
} from '@/server-actions/campaigns';
import { MASTER_PROMPT_MAX, type IngestBriefOverrides } from '@/lib/schemas/ingest';
import type { CreativeGuidelines } from '@/lib/campaigns/guidelines';
import { MATCHER_ERROR_HINTS } from '@/lib/campaigns/matcher-hints';
import { recommendedAudioSource } from '@/lib/campaigns/sequence-chain';
import { usePreflight } from '@/components/ui/preflight-checklist';
import { CAMPAIGN_CHECKLIST } from '@/lib/checklists';
import { uploadMediaReferenceFile } from '@/lib/media-references/upload-client';

// Lee la duración de un audio en el navegador (sin libs). Resuelve en segundos.
function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      // Audio malformado/streamed puede dar NaN o Infinity: tratarlo como
      // ilegible (el guard de 15s no debe dejarlo pasar por NaN > 15 === false).
      if (!Number.isFinite(el.duration)) {
        reject(new Error('duración no finita'));
        return;
      }
      resolve(el.duration);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer el audio'));
    };
    el.src = url;
  });
}

const MUSIC_MAX_SECONDS = 15;

type BrandKitOption = {
  id: string;
  name: string;
  productImages: number;
  packagingImages: number;
};

// Motivos legibles del fallback del plan dirigido (codes de ProviderError
// más 'sin_match' del saneo de la action).
// Etiquetas en lenguaje simple (el usuario no es del medio): los valores
// internos siguen siendo mixed/awareness/conversion (CaptionGoal). Solo deciden
// el llamado a la acción del caption sugerido, no qué se genera.
const GOALS = [
  { value: 'mixed', label: 'Ambos: dar a conocer y vender' },
  { value: 'awareness', label: 'Que conozcan el producto' },
  { value: 'conversion', label: 'Que la gente compre' },
] as const;

// Etiquetas legibles del estilo visual sugerido por la ingesta del prompt maestro.
const STYLE_LABELS: Record<string, string> = {
  ultra_realista: 'Ultra realista',
  casero: 'Casero (UGC/celular)',
  fantasia: 'Fantasía',
  animado: 'Animado',
};

// Wizard sin walls (specs/v2/06 §4.4): subir fotos del producto es el camino
// primario — el Brand Kit se crea implícito en el server. Elegir un kit
// existente es la alternativa, nunca un requisito previo.
// El plan sale de lo que el usuario describe (specs/v2/07): no hay selector
// de volumen — el matcher decide cuántos creativos por idea. Sin ideas, un
// paso intermedio ofrece el plan sugerido.
export function CampaignStudioWizard({
  brandKits: initialBrandKits,
  characters,
  outfits,
}: {
  brandKits: BrandKitOption[];
  characters: Array<{
    id: string;
    name: string;
    previewUrl: string | null;
    angleCount: number;
    hasVoice: boolean;
  }>;
  // Vestuario (specs/v2/16): opciones por personaje para el selector "Vestuario
  // de {name}" bajo la grid del Cast.
  outfits: Array<{ id: string; label: string; characterId: string }>;
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
  // Perfil de estilo visual de la campaña (051): define el look de todo el plan.
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('ultra_realista');
  const [visualStyleCustom, setVisualStyleCustom] = useState('');
  // Fuente de audio de los clips encadenados (055): pista musical (default) o
  // el audio del clip anterior. Excluyentes (límite Seedance: 15s combinados).
  const [chainAudioSource, setChainAudioSource] = useState<'music' | 'prev_clip'>('music');
  // El usuario tocó el toggle manualmente: si no, el valor sigue la recomendación
  // (según si el personaje seleccionado tiene voz). Evita pisar una elección explícita.
  const [audioSourceTouched, setAudioSourceTouched] = useState(false);
  const [productUrl, setProductUrl] = useState('');
  const [productImages, setProductImages] = useState<RefImage[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [mode, setMode] = useState<'upload' | 'kit'>('upload');
  const [brandKitId, setBrandKitId] = useState(initialBrandKits[0]?.id ?? '');
  const [ideas, setIdeas] = useState('');
  // Ingesta de prompt maestro (spec v2/15): el usuario pega un guion completo y
  // lo repartimos en overrides de ficha, guías y estilo sugerido, editables antes
  // de crear la campaña.
  const [masterPrompt, setMasterPrompt] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [briefOverrides, setBriefOverrides] = useState<IngestBriefOverrides | null>(null);
  const [guidelines, setGuidelines] = useState<CreativeGuidelines | null>(null);
  const [ingestNotes, setIngestNotes] = useState<string[]>([]);
  const [styleSuggestion, setStyleSuggestion] = useState<VisualStyle | null>(null);
  const [askIdeasOpen, setAskIdeasOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<'idle' | 'brief' | 'plan'>('idle');
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  // Vestuario por campaña (specs/v2/16): { characterId: outfitId }. Sin entry
  // para un personaje = usa su cuerpo completo base.
  const [outfitMap, setOutfitMap] = useState<Record<string, string>>({});
  // Empaque del Brand Kit: el usuario decide si entra a la campaña (032).
  const [includePackaging, setIncludePackaging] = useState(true);
  const [music, setMusic] = useState<{ id: string; filename: string } | null>(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  async function handleIngest() {
    if (!masterPrompt.trim()) return;
    setIngesting(true);
    try {
      const res = await ingestMasterPromptAction({ masterPrompt: masterPrompt.trim() });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo analizar el prompt');
        return;
      }
      const r = res.data;
      if (r.narrative) setIdeas(r.narrative);
      setBriefOverrides(
        Object.keys(r.productFacts).length || r.productVisualDetails
          ? {
              ...(Object.keys(r.productFacts).length ? { productFacts: r.productFacts } : {}),
              ...(r.productVisualDetails ? { productVisualDetails: r.productVisualDetails } : {}),
            }
          : null,
      );
      setGuidelines(
        r.guidelines.safeCrop || r.guidelines.showFullProduct || r.guidelines.hookProductHero
          ? r.guidelines
          : null,
      );
      setStyleSuggestion(r.visualStyle);
      setIngestNotes([
        ...r.warnings,
        ...r.castHints.filter((c) => !c.inCast).map((c) => `${c.name}: ${c.note}`),
        ...(r.locationHints.length
          ? [`Carga estas locaciones como base para consistencia: ${r.locationHints.join(', ')}.`]
          : []),
      ]);
      toast.success('Prompt analizado: revisa el reparto y ajusta lo que quieras.');
    } finally {
      setIngesting(false);
    }
  }

  async function handleMusicSelected(file: File | undefined) {
    if (!file) return;
    setMusicBusy(true);
    try {
      let seconds: number;
      try {
        seconds = await readAudioDuration(file);
      } catch {
        toast.error('No se pudo leer la duración del audio');
        return;
      }
      if (seconds > MUSIC_MAX_SECONDS) {
        toast.error(`La pista de referencia debe durar máximo ${MUSIC_MAX_SECONDS}s; usa un clip corto del beat`);
        return;
      }
      const res = await uploadMediaReferenceFile(file);
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo subir la pista');
        return;
      }
      setMusic({ id: res.ref.id, filename: res.ref.filename });
    } finally {
      setMusicBusy(false);
    }
  }

  const selectedKit = brandKits.find((k) => k.id === brandKitId);
  const productReady = mode === 'upload' ? productImages.length > 0 : Boolean(selectedKit);
  const canSubmit =
    name.trim().length > 0 &&
    productReady &&
    !submitting &&
    !musicBusy &&
    (visualStyle !== 'custom' || visualStyleCustom.trim().length >= 3);

  const preflight = usePreflight();

  // Recomendación de fuente de audio según si el personaje seleccionado tiene voz
  // (spec docs/superpowers/specs/2026-07-08-wizard-audio-voz-inteligente-design.md).
  const recommendedSource = recommendedAudioSource(selectedCharacterIds, characters);
  const effectiveAudioSource = audioSourceTouched ? chainAudioSource : recommendedSource;
  const anySelectedHasVoice = selectedCharacterIds.some(
    (id) => characters.find((c) => c.id === id)?.hasVoice,
  );
  const audioHint =
    selectedCharacterIds.length === 0
      ? 'Sin personaje que hable; la pista marca el ritmo.'
      : anySelectedHasVoice
        ? "Tu personaje tiene voz asignada. En una secuencia encadenada, 'Voz del clip anterior' mantiene ese timbre en los clips siguientes; con 'Pista musical' la voz podría cambiar."
        : "Ningún personaje seleccionado tiene voz asignada. 'Pista musical' marca el ritmo y el modelo genera la voz.";

  async function handleCreate() {
    if (!canSubmit) return;
    // Checklist informativo de restricciones/buenas prácticas (siempre en campañas).
    if (!(await preflight(CAMPAIGN_CHECKLIST))) return;
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
      ...(Object.keys(outfitMap).length ? { characterOutfitMap: outfitMap } : {}),
      includePackaging,
      aspectRatio,
      visualStyle,
      ...(visualStyle === 'custom' && visualStyleCustom.trim()
        ? { visualStyleCustom: visualStyleCustom.trim() }
        : {}),
      ...(music ? { musicRefId: music.id } : {}),
      chainAudioSource: effectiveAudioSource,
      ...(briefOverrides ? { briefOverrides } : {}),
      ...(guidelines ? { guidelines } : {}),
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
    // Ideas que no se pudieron convertir en tomas (vagas, o formato no creado):
    // se reportan en vez de descartarlas en silencio (PD-04).
    if (planned.data.blockers?.length) {
      toast.warning(`No pude convertir algunas ideas en tomas: ${planned.data.blockers.join(' · ')}`, {
        description: 'Reescríbelas diciendo qué pasa en pantalla (una acción concreta).',
        duration: 10000,
      });
    }
    // R6: el toast es efímero y se auto-cierra antes de que el usuario lea el plan.
    // Persistimos la degradación en la URL destino para que la vista de campaña pueda
    // renderizar un aviso fijo (banner) explicando por qué el plan salió genérico.
    const planParams = new URLSearchParams();
    if (ideas.trim() && planned.data.source === 'mix') {
      planParams.set('plan', 'generic');
      planParams.set('reason', planned.data.matcherError ?? 'unknown');
    }
    const planQuery = planParams.toString();
    router.push(`/app/campaigns/${created.data.id}${planQuery ? `?${planQuery}` : ''}`);
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link
        href="/app/campaigns"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Campañas
      </Link>

      <h1 className="text-[18px] font-semibold text-foreground">Nueva campaña</h1>
      <p className="mt-1 text-2sm text-muted-foreground">
        Sube tu producto y describe lo que imaginas: el plan se arma con esos creativos.
      </p>

      <div className="mt-6 space-y-6">
        <section>
          <Label className="text-xs font-medium text-foreground/80">Tu producto</Label>
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
                  className="mt-3 block text-2xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  ¿Ya tienes un Brand Kit? Úsalo en su lugar
                </button>
              )}
              <button
                type="button"
                onClick={() => setAiOpen(true)}
                className="mt-2 inline-flex items-center gap-1 text-2xs text-primary underline-offset-2 hover:underline"
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
                <p className="mt-2 text-2xs text-amber-400/80">
                  Este kit no tiene imágenes de producto; el análisis usará sus referencias
                  generales.
                </p>
              )}
              {selectedKit && selectedKit.packagingImages > 0 && (
                <div className="mt-3 flex items-start justify-between gap-3">
                  <span className="text-xs leading-snug text-muted-foreground">
                    Incluir las {selectedKit.packagingImages} imagen
                    {selectedKit.packagingImages !== 1 ? 'es' : ''} de empaque del kit
                    <span className="block text-2xs text-muted-foreground">
                      Solo viajan al video en formatos que las usan (ej. unboxing). Si lo
                      desactivas, el plan no propondrá esos formatos.
                    </span>
                  </span>
                  <Switch
                    checked={includePackaging}
                    onCheckedChange={setIncludePackaging}
                    aria-label="Incluir las imágenes de empaque del kit"
                    className="mt-0.5 shrink-0"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => setMode('upload')}
                className="mt-3 text-2xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                Mejor subir fotos nuevas
              </button>
            </div>
          )}
        </section>

        <section className="space-y-1.5">
          <Label htmlFor="campaign-name" className="text-xs font-medium text-foreground/80">
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
          <Label htmlFor="master-prompt" className="text-xs font-medium text-foreground/80">
            ¿Tienes un prompt maestro? <span className="font-normal text-muted-foreground/50">(opcional)</span>
          </Label>
          <p className="text-2xs text-muted-foreground">
            Pega un guion completo (estética, medidas, locaciones, clips) y lo repartimos en la
            ficha, el estilo y las guías; el guion por clip llena el campo de abajo. Revisa todo
            antes de generar.
          </p>
          <textarea
            id="master-prompt"
            value={masterPrompt}
            onChange={(e) => setMasterPrompt(e.target.value)}
            placeholder="Comercial UGC 30s... Estructura de 9 clips... Canvas 150x100cm..."
            maxLength={MASTER_PROMPT_MAX}
            rows={4}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!masterPrompt.trim() || ingesting}
            onClick={() => void handleIngest()}
          >
            {ingesting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            Analizar prompt
          </Button>
          {(briefOverrides || guidelines || styleSuggestion || ingestNotes.length > 0) && (
            <div className="mt-2 space-y-2 rounded-lg border border-border bg-card/50 p-3 text-2xs">
              {briefOverrides?.productFacts && (
                <p className="text-muted-foreground">
                  Ficha (de tu prompt):{' '}
                  {[
                    briefOverrides.productFacts.heightCm && `alto ${briefOverrides.productFacts.heightCm}cm`,
                    briefOverrides.productFacts.widthCm && `ancho ${briefOverrides.productFacts.widthCm}cm`,
                    briefOverrides.productFacts.weightKg && `${briefOverrides.productFacts.weightKg}kg`,
                    briefOverrides.productFacts.medium,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              {styleSuggestion && styleSuggestion !== visualStyle && (
                <button
                  type="button"
                  onClick={() => setVisualStyle(styleSuggestion)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-1 text-primary transition-colors hover:bg-primary/10"
                >
                  Sugerido: {STYLE_LABELS[styleSuggestion] ?? styleSuggestion} · aplicar
                </button>
              )}
              {guidelines?.safeCrop === '4:5' && (
                <p className="text-muted-foreground">Guía aplicada: encuadre seguro 4:5.</p>
              )}
              {guidelines?.showFullProduct && (
                <p className="text-muted-foreground">Guía aplicada: mostrar el producto completo.</p>
              )}
              {guidelines?.hookProductHero && (
                <p className="text-muted-foreground">Guía aplicada: producto como héroe en el primer plano.</p>
              )}
              {ingestNotes.map((note, i) => (
                <p key={i} className="text-amber-400/80">
                  {note}
                </p>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-1.5">
          <Label htmlFor="campaign-ideas" className="text-xs font-medium text-foreground/80">
            Describe lo que imaginas
          </Label>
          <textarea
            id="campaign-ideas"
            ref={ideasRef}
            value={ideas}
            onChange={(e) => setIdeas(e.target.value)}
            placeholder="Ej. quiero 3 unboxings, algo ASMR, y un video donde mi perro usa el producto"
            maxLength={MASTER_PROMPT_MAX}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <p className="text-2xs text-muted-foreground">
            El plan tendrá un creativo por cada idea (o los que pidas: &ldquo;3 versiones
            de&hellip;&rdquo;). Lo que no encaje en el catálogo crea un formato nuevo tuyo.
            Techo demo: 30 creativos; los borradores salen en 480p.
          </p>
        </section>

        <section>
          <Label className="text-xs font-medium text-foreground/80">
            Personajes <span className="font-normal text-muted-foreground/50">(hasta 3)</span>
          </Label>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Los personajes asignados pueden aparecer en los videos; nómbralos en tus ideas
            para dirigirlos (&ldquo;María hace un unboxing&rdquo;). Nombres que no asignes
            se inventan sin imagen de referencia.
          </p>
          {characters.length === 0 ? (
            <div className="mt-1.5 flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
              <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" aria-hidden />
              <div className="flex-1 text-xs leading-relaxed text-muted-foreground">
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
                          // next/image se omite a propósito: previewUrl es una URL firmada
                          // de Supabase (token efímero) y el optimizador la cachearía por un
                          // token ya expirado. aspect-square + width/height + lazy cubren CLS
                          // y carga diferida (regla de previews con URL firmada).
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.previewUrl}
                            alt={c.name}
                            width={120}
                            height={120}
                            loading="lazy"
                            className="aspect-square w-full rounded-lg object-cover"
                          />
                        ) : (
                          <div className="grid aspect-square w-full place-items-center rounded-lg bg-muted/30">
                            <UserRound className="size-5 text-muted-foreground/40" aria-hidden />
                          </div>
                        )}
                        <p className="mt-1.5 truncate text-xs text-foreground/90">{c.name}</p>
                      </button>
                      {idx === 0 && (
                        <span className="absolute right-1.5 top-1.5 inline-flex min-h-[24px] items-center rounded-full bg-primary px-2 py-1 text-2xs font-medium text-primary-foreground">
                          Principal
                        </span>
                      )}
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => makePrincipal(c.id)}
                          aria-label={`Hacer a ${c.name} el personaje principal`}
                          className="absolute right-1.5 top-1.5 inline-flex min-h-[24px] items-center rounded-full border border-border bg-background/80 px-2 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          Hacer principal
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {selectedCharacterIds.length >= 3 && (
                <p className="mt-1.5 text-2xs text-amber-400/80">
                  Con 3 personajes la atención del modelo se reparte y el parecido puede
                  degradarse; considera 1-2 por video.
                </p>
              )}
              {selectedCharacterIds.map((id) => {
                // Vestuario (specs/v2/16): un selector por personaje seleccionado
                // que tenga outfits cargados; sin outfits, se omite (usa el
                // cuerpo completo base sin necesidad de elegir nada).
                const c = characters.find((x) => x.id === id);
                const charOutfits = outfits.filter((o) => o.characterId === id);
                if (!c || charOutfits.length === 0) return null;
                return (
                  <div key={id} className="mt-2">
                    <Label
                      htmlFor={`outfit-${id}`}
                      className="text-2xs font-medium text-foreground/80"
                    >
                      Vestuario de {c.name}
                    </Label>
                    <Select
                      value={outfitMap[id] ?? 'base'}
                      onValueChange={(v) =>
                        setOutfitMap((prev) => {
                          if (v === 'base') {
                            const rest = { ...prev };
                            delete rest[id];
                            return rest;
                          }
                          return { ...prev, [id]: v };
                        })
                      }
                    >
                      <SelectTrigger id={`outfit-${id}`} className="mt-1 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="base">Base</SelectItem>
                        {charOutfits.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
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

        <section>
          <span className="text-xs font-medium text-foreground/80">Formato de video</span>
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
                className={`flex-1 rounded-lg border px-3 py-2 text-2sm transition-colors ${
                  aspectRatio === a.value
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Aplica a todos los creativos del plan; puedes cambiarlo por video al editar.
          </p>
        </section>

        <section>
          <span className="text-xs font-medium text-foreground/80">Estilo visual</span>
          <div className="mt-1.5">
            <VisualStyleSelector
              value={visualStyle}
              customText={visualStyleCustom}
              onValueChange={setVisualStyle}
              onCustomTextChange={setVisualStyleCustom}
            />
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Define el look de todos los creativos: escenas, paneles y video. Ultra realista
            incluye física creíble (objetos apoyados o colgados, nunca flotando).
          </p>
        </section>

        <div>
          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls="advanced-options"
            onClick={() => setAdvancedOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-card/50 px-4 py-3 text-xs font-medium text-foreground/80 transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Opciones avanzadas (opcional)
            <ChevronDown
              className={`size-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
          {advancedOpen && (
            <div id="advanced-options" className="mt-4 space-y-6">
              <section className="space-y-1.5">
                <Label htmlFor="campaign-url" className="text-xs font-medium text-foreground/80">
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
                <p className="text-2xs text-muted-foreground">
                  El texto de la página (nombre, descripción, tono) enriquece el análisis.
                </p>
              </section>

              <section className="space-y-1.5">
                <Label htmlFor="campaign-goal" className="text-xs font-medium text-foreground/80">
                  Objetivo del texto (caption)
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
                <p className="text-2xs leading-snug text-muted-foreground">
                  Solo ajusta el llamado a la acción del caption; lo puedes editar después.
                </p>
              </section>

              <section>
                <span className="text-xs font-medium text-foreground/80">Idioma hablado</span>
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
                      className={`flex-1 rounded-lg border px-3 py-2 text-2sm transition-colors ${
                        language === l.value
                          ? 'border-primary/60 bg-primary/10 text-foreground'
                          : 'border-border bg-card text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  Idioma de los diálogos y voz en off de los videos; el caption sale en español.
                </p>
              </section>

              <section className="space-y-2">
                <Label htmlFor="music-upload" className="text-xs font-medium text-foreground/80">
                  Pista musical <span className="font-normal text-muted-foreground/50">(opcional)</span>
                </Label>
                <p className="text-2xs text-muted-foreground">
                  Un clip de hasta 15s. Guía el ritmo y la energía del video; el modelo genera su
                  audio sincronizado al beat. No se usa como banda sonora final.
                </p>
                {music ? (
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <span className="truncate">{music.filename}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setMusic(null)}>
                      Quitar
                    </Button>
                  </div>
                ) : (
                  <Input
                    id="music-upload"
                    type="file"
                    accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav"
                    disabled={musicBusy}
                    onChange={(e) => void handleMusicSelected(e.target.files?.[0])}
                  />
                )}
                {musicBusy ? <p className="text-2xs text-muted-foreground">Subiendo pista…</p> : null}
              </section>

              <section className="space-y-2">
                <span className="text-xs font-medium text-foreground/80">
                  Audio de referencia en anuncios de varias escenas
                </span>
                <p className="text-2xs text-muted-foreground">
                  Solo puede viajar una referencia de audio por clip (15s máx), y esto solo aplica
                  a secuencias de varias escenas encadenadas. En modo Locación o en un solo clip,
                  la voz del personaje ya se usa en cada clip.
                </p>
                <div className="flex gap-2" role="radiogroup" aria-label="Audio de los clips encadenados">
                  {(
                    [
                      { value: 'music', label: 'Pista musical', hint: 'El ritmo de la pista guía cada clip' },
                      { value: 'prev_clip', label: 'Voz del clip anterior', hint: 'Cada clip hereda el audio del anterior: misma voz y ambiente' },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={effectiveAudioSource === o.value}
                      title={o.hint}
                      onClick={() => {
                        setAudioSourceTouched(true);
                        setChainAudioSource(o.value);
                      }}
                      className={`flex-1 rounded-lg border px-3 py-2 text-2sm transition-colors ${
                        effectiveAudioSource === o.value
                          ? 'border-primary/60 bg-primary/10 text-foreground'
                          : 'border-border bg-card text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {o.label}
                      {recommendedSource === o.value && (
                        <span className="ml-1.5 text-2xs text-primary">Recomendado</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-2xs text-muted-foreground">{audioHint}</p>
              </section>
            </div>
          )}
        </div>

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
