// lib/shots/catalog.ts
// Diccionario de tomas (specs/v2/07): catálogo estático consultado por la
// etapa "Toma" del refinado. Las imágenes se generan UNA vez con
// scripts/generate-shot-images.ts (API real, la corre el usuario) y quedan
// versionadas en public/shots/.

export type Shot = {
  slug: string;
  name: string;
  description: string;   // qué es, una línea
  whenToUse: string;     // cuándo conviene, una línea
  motion: boolean;       // toma con movimiento de cámara
  formats: string[];     // slugs de formatos del sistema afines
  image: string;         // /shots/<slug>.jpg
};

const shot = (s: Omit<Shot, 'image'>): Shot => ({ ...s, image: `/shots/${s.slug}.jpg` });

export const SHOTS: Shot[] = [
  shot({ slug: 'close-up', name: 'Primer plano', motion: false,
    description: 'El rostro o el producto llenan el cuadro.',
    whenToUse: 'Emoción de la persona o detalle clave del producto.',
    formats: ['voz-cercana', 'susurro', 'antes-y-despues'] }),
  shot({ slug: 'macro', name: 'Macro', motion: false,
    description: 'Detalle extremo: textura, gota, sello, costura.',
    whenToUse: 'Sensorialidad y calidad de materiales.',
    formats: ['susurro', 'el-descubrimiento', 'el-icono'] }),
  shot({ slug: 'plano-medio', name: 'Plano medio', motion: false,
    description: 'Persona de la cintura hacia arriba, producto en mano.',
    whenToUse: 'Testimonios y demostraciones con contexto.',
    formats: ['voz-cercana', 'a-pie-de-calle', 'manos-a-la-obra'] }),
  shot({ slug: 'selfie-handheld', name: 'Selfie en mano', motion: true,
    description: 'Cámara sostenida por la propia persona, leve temblor natural.',
    whenToUse: 'UGC creíble: cercanía e imperfección intencional.',
    formats: ['voz-cercana'] }),
  shot({ slug: 'cenital', name: 'Cenital', motion: false,
    description: 'Cámara perpendicular desde arriba.',
    whenToUse: 'Tutoriales con manos, flat-lays, preparaciones.',
    formats: ['manos-a-la-obra', 'el-descubrimiento'] }),
  shot({ slug: 'over-the-shoulder', name: 'Sobre el hombro', motion: false,
    description: 'Se mira la acción por encima del hombro de la persona.',
    whenToUse: 'Demostraciones en primera persona y unboxings.',
    formats: ['manos-a-la-obra', 'el-descubrimiento'] }),
  shot({ slug: 'contrapicado', name: 'Contrapicado', motion: false,
    description: 'Cámara baja mirando hacia arriba: el sujeto se agranda.',
    whenToUse: 'Producto héroe con presencia monumental.',
    formats: ['el-icono', 'gran-pantalla', 'mundo-imposible'] }),
  shot({ slug: 'plano-general', name: 'Plano general', motion: false,
    description: 'El entorno completo establece dónde ocurre la escena.',
    whenToUse: 'Apertura de narrativas y mundos imposibles.',
    formats: ['gran-pantalla', 'mundo-imposible', 'a-pie-de-calle'] }),
  shot({ slug: 'detalle-tactil', name: 'Detalle táctil', motion: false,
    description: 'Manos interactuando con el producto en primer plano.',
    whenToUse: 'Destapar, verter, aplicar: el gesto vende.',
    formats: ['susurro', 'el-descubrimiento', 'manos-a-la-obra'] }),
  shot({ slug: 'dolly-in', name: 'Dolly in', motion: true,
    description: 'La cámara avanza suavemente hacia el sujeto.',
    whenToUse: 'Crear intención y foco creciente en el producto.',
    formats: ['el-icono', 'gran-pantalla'] }),
  shot({ slug: 'orbita', name: 'Órbita', motion: true,
    description: 'La cámara gira alrededor del producto.',
    whenToUse: 'Mostrar el producto en 360 sin manos.',
    formats: ['el-icono'] }),
  shot({ slug: 'tracking', name: 'Seguimiento', motion: true,
    description: 'La cámara acompaña al sujeto en movimiento.',
    whenToUse: 'Energía documental: caminar y hablar.',
    formats: ['a-pie-de-calle', 'gran-pantalla'] }),
  shot({ slug: 'pull-back', name: 'Retroceso revelación', motion: true,
    description: 'La cámara se aleja y revela el contexto completo.',
    whenToUse: 'Cierres con revelación o escala imposible.',
    formats: ['mundo-imposible', 'gran-pantalla'] }),
  shot({ slug: 'speed-ramp', name: 'Speed ramp', motion: true,
    description: 'Aceleración y frenado del tiempo dentro de la toma.',
    whenToUse: 'Producto kinético: splash, caída, montaje rítmico.',
    formats: ['el-icono'] }),
];

export function shotBySlug(slug: string): Shot | undefined {
  return SHOTS.find((s) => s.slug === slug);
}
