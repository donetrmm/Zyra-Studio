// Planner de campaña (specs/v2/03 tarea 3). DETERMINISTA y puro: sin DB ni
// APIs — recibe formatos, escenas y cast, devuelve los items del plan.
// La server action persiste y el Prompt Director valida/compila al encolar.

import type { ProductCategory } from './brief';

export type PlannerFormat = {
  id: string;
  slug: string;
  name: string;
  requiredRefs: string[];
  defaultDurationS: number;
  defaultAudio: boolean;
};

export type PlannerScene = { name: string; fragment: string };
export type PlannerCharacter = { id: string; name: string };

export type PlannerInput = {
  totalItems: number;
  category: ProductCategory;
  productName: string;
  formats: PlannerFormat[];
  scenes: PlannerScene[];
  characters: PlannerCharacter[];
  // Qué referencias existen en el Brand Kit/Cast: el plan nunca propone un
  // formato cuyos required_refs no se pueden cumplir (evita items bloqueados).
  available: { product: boolean; packaging: boolean; character: boolean };
  dateStart: Date;
  dateEnd: Date;
  draftModelSlug: string;
};

export type PlanItemDraft = {
  formatId: string;
  formatSlug: string;
  modelSlug: string;
  durationS: number;
  aspectRatio: string;
  scene: string;            // fragment de la escena (va al contexto del compile)
  audio: boolean;
  characterId: string | null;
  scenePrompt: string;
  scheduledDate: string;    // YYYY-MM-DD
};

// Mix de formatos por categoría — mapa PROPIO (doc V2: no copiar relevance
// maps de terceros). El núcleo universal funciona para casi todo; cada
// categoría suma los formatos que su producto soporta de verdad.
const UNIVERSAL = ['voz-cercana', 'el-icono', 'gran-pantalla', 'mundo-imposible'];
const CATEGORY_MIX: Record<ProductCategory, string[]> = {
  beverage: [...UNIVERSAL, 'susurro', 'a-pie-de-calle'],
  food: [...UNIVERSAL, 'susurro', 'manos-a-la-obra', 'a-pie-de-calle'],
  beauty: [...UNIVERSAL, 'manos-a-la-obra', 'antes-y-despues', 'el-descubrimiento'],
  apparel: [...UNIVERSAL, 'antes-y-despues', 'el-descubrimiento', 'a-pie-de-calle'],
  accessories: [...UNIVERSAL, 'el-descubrimiento', 'a-pie-de-calle'],
  electronics: [...UNIVERSAL, 'manos-a-la-obra', 'el-descubrimiento'],
  // Sin producto físico: ni héroe kinético ni unboxing.
  software: ['voz-cercana', 'manos-a-la-obra', 'gran-pantalla', 'mundo-imposible'],
  home: [...UNIVERSAL, 'manos-a-la-obra', 'el-descubrimiento'],
  fitness: [...UNIVERSAL, 'antes-y-despues', 'a-pie-de-calle'],
  other: [...UNIVERSAL, 'a-pie-de-calle'],
};

// Semillas de concepto por formato — variar escenas dentro del mismo formato
// para que no haya dos videos iguales. Heurísticas propias; los formatos
// custom (slug desconocido) usan las genéricas.
type Seed = (p: { product: string; scene: string }) => string;
const GENERIC_SEEDS: Seed[] = [
  ({ product }) => `The ${product} is presented naturally within the scene, handled with ease, ending with the label facing the camera`,
  ({ product }) => `A quiet moment builds curiosity, then the ${product} takes the center of the frame as the clear focus`,
  ({ product }) => `The scene opens mid-action and resolves on the ${product} placed deliberately, catching the light`,
];
const CONCEPT_SEEDS: Record<string, Seed[]> = {
  'voz-cercana': [
    ({ product }) => `The presenter holds the ${product} at chest height, tilts it toward the camera while speaking one casual line, takes a try and reacts with an honest nod`,
    ({ product }) => `The presenter looks to camera, lifts the ${product} into frame, shares a one-sentence personal take and smiles at the end`,
    ({ product }) => `Mid-routine, the presenter pauses, grabs the ${product}, shows it to camera and delivers a quick genuine recommendation`,
  ],
  'a-pie-de-calle': [
    ({ product }) => `The interviewer asks a passerby one quick question, hands over the ${product}, and captures the spontaneous first reaction`,
    ({ product }) => `A stranger is asked to rate the ${product} out of ten on camera, tries it and gives a verdict with a laugh`,
  ],
  'manos-a-la-obra': [
    ({ product }) => `Hands demonstrate the ${product} in three clear steps, each step framed tightly, ending with the finished result`,
    ({ product }) => `Top-down view: hands prepare and use the ${product} with deliberate confident movements, no wasted motion`,
  ],
  'el-descubrimiento': [
    ({ product }) => `The sealed package rests closed; hands open it slowly, lift the ${product} out and hold it up as the reveal`,
    ({ product }) => `Close-up on the seal breaking, paper folding back, and the ${product} emerging into soft light`,
  ],
  'antes-y-despues': [
    ({ product }) => `The frame holds the before state, a clean transition sweeps across, and the after state with the ${product} present tells the difference`,
    ({ product }) => `Identical framing in two beats: the situation without, then visibly transformed with the ${product} in frame`,
  ],
  susurro: [
    ({ product }) => `Macro close-up: the ${product} is opened slowly, every sound audible — the grip, the release, the settle on the surface`,
    ({ product }) => `Condensation and texture in extreme close-up; the ${product} is lifted, tilted and set down with soft audible contact`,
  ],
  'el-icono': [
    ({ product }) => `The ${product} spins on its axis against a bold minimal backdrop and stops with the label perfectly forward`,
    ({ product }) => `The ${product} drops into frame in slow motion, impact ripples outward, camera orbits once around it`,
  ],
  'gran-pantalla': [
    ({ product }) => `An establishing shot sets the mood, the ${product} enters as the natural protagonist of the moment, and the final frame holds on it with intent`,
    ({ product }) => `A composed scene unfolds around a quiet emotional beat; the ${product} anchors the resolution in the closing frame`,
  ],
  'mundo-imposible': [
    ({ product }) => `The ${product} appears at impossible scale within the scene, integrated into the environment as if it always belonged there`,
    ({ product }) => `Physics bend around the ${product}: the environment reacts to it in a surreal but coherent way, product always the anchor`,
  ],
};

function formatFitsRefs(format: PlannerFormat, available: PlannerInput['available']): boolean {
  for (const ref of format.requiredRefs) {
    if (ref === 'product' && !available.product) return false;
    if (ref === 'packaging' && !available.packaging) return false;
    if (ref === 'character' && !available.character) return false;
  }
  return true;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildPlan(input: PlannerInput): PlanItemDraft[] {
  const relevantSlugs = CATEGORY_MIX[input.category] ?? CATEGORY_MIX.other;
  const candidates = input.formats
    .filter((f) => relevantSlugs.includes(f.slug) || !CONCEPT_SEEDS[f.slug]) // formatos custom siempre candidatos
    .filter((f) => relevantSlugs.includes(f.slug))
    .filter((f) => formatFitsRefs(f, input.available));

  if (candidates.length === 0 || input.totalItems < 1) return [];

  // Reparto parejo con resto a los primeros formatos.
  const per = Math.floor(input.totalItems / candidates.length);
  const remainder = input.totalItems % candidates.length;

  // Construcción por formato, variando escena y semilla para no repetir
  // escena+concepto dentro del mismo formato.
  const itemsByFormat: PlanItemDraft[][] = candidates.map((format, fIdx) => {
    const count = per + (fIdx < remainder ? 1 : 0);
    const seeds = CONCEPT_SEEDS[format.slug] ?? GENERIC_SEEDS;
    const needsCharacter = format.requiredRefs.includes('character');
    const items: PlanItemDraft[] = [];
    for (let i = 0; i < count; i++) {
      // Offset por formato para que dos formatos no usen la misma escena el mismo día.
      const scene = input.scenes[(fIdx + i) % Math.max(1, input.scenes.length)] ?? {
        name: 'Estudio',
        fragment: 'a clean minimal studio setting with controlled soft light',
      };
      const character = needsCharacter && input.characters.length
        ? input.characters[(fIdx + i) % input.characters.length]
        : null;
      const seed = seeds[i % seeds.length];
      items.push({
        formatId: format.id,
        formatSlug: format.slug,
        modelSlug: input.draftModelSlug,
        durationS: format.defaultDurationS,
        // Social-first: vertical, salvo el registro cinematográfico.
        aspectRatio: format.slug === 'gran-pantalla' ? '16:9' : '9:16',
        scene: scene.fragment,
        audio: format.defaultAudio,
        characterId: character?.id ?? null,
        scenePrompt: seed({ product: input.productName, scene: scene.fragment }),
        scheduledDate: '', // se asigna abajo, intercalado
      });
    }
    return items;
  });

  // Intercalar formatos (round-robin) para que el calendario no amontone
  // 5 items del mismo formato seguidos, y repartir fechas en el rango.
  const interleaved: PlanItemDraft[] = [];
  const maxLen = Math.max(...itemsByFormat.map((arr) => arr.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of itemsByFormat) {
      if (arr[i]) interleaved.push(arr[i]);
    }
  }

  const rangeMs = Math.max(0, input.dateEnd.getTime() - input.dateStart.getTime());
  const step = interleaved.length > 1 ? rangeMs / (interleaved.length - 1) : 0;
  interleaved.forEach((item, idx) => {
    item.scheduledDate = isoDate(new Date(input.dateStart.getTime() + step * idx));
  });

  return interleaved;
}
