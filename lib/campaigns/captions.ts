// Captions de publicación por creativo (doc V2 §4.1 etapa 2: el caption es
// metadato de publicación, NUNCA texto generado en pantalla). Determinista y
// puro, como el planner: gancho por formato + CTA por objetivo + hashtags.
// El usuario lo edita desde el plan; el export CSV lo entrega al media buyer.

export type CaptionGoal = 'awareness' | 'conversion' | 'mixed';

type Hook = (product: string) => string;

const FORMAT_HOOKS: Record<string, Hook[]> = {
  'voz-cercana': [
    (p) => `Lo probe sin expectativas y ${p} me callo la boca.`,
    (p) => `Nadie me paga por decir esto: ${p} vale la pena.`,
    (p) => `Mi opinion honesta de ${p} en unos segundos.`,
  ],
  'a-pie-de-calle': [
    (p) => `Salimos a la calle a preguntar por ${p}. Las reacciones hablan solas.`,
    (p) => `Gente real, primera impresion real: asi reaccionan a ${p}.`,
  ],
  'manos-a-la-obra': [
    (p) => `Asi se usa ${p}, paso a paso y sin vueltas.`,
    (p) => `Tres pasos y listo: ${p} en accion.`,
  ],
  'el-descubrimiento': [
    (p) => `El unboxing de ${p} que nos pidieron.`,
    (p) => `Abrirlo es la mitad de la experiencia: ${p}.`,
  ],
  'antes-y-despues': [
    (p) => `El antes y despues con ${p}. Sin trucos.`,
    (p) => `Mismo encuadre, mismo dia: lo unico que cambio fue ${p}.`,
  ],
  susurro: [
    (p) => `Sube el volumen: ${p} tambien se escucha.`,
    (p) => `El sonido de ${p}, en primer plano. Gracias despues.`,
  ],
  'el-icono': [
    (p) => `${p}, sin distracciones.`,
    (p) => `El producto habla solo: ${p}.`,
  ],
  'gran-pantalla': [
    (p) => `Una historia corta sobre lo que ${p} significa.`,
    (p) => `${p}, como se merece verse.`,
  ],
  'mundo-imposible': [
    (p) => `Esto no se puede rodar. Por eso lo hicimos igual: ${p}.`,
    (p) => `${p} a una escala que no existe. Todavia.`,
  ],
};

const GENERIC_HOOKS: Hook[] = [
  (p) => `${p}, visto como nunca.`,
  (p) => `Te presentamos ${p}.`,
];

const CTA: Record<CaptionGoal, string[]> = {
  conversion: ['Disponible ahora, link en bio.', 'Pidelo hoy desde el link en bio.'],
  awareness: ['Ya lo conocias? Cuentanos en comentarios.', 'Siguenos para mas.'],
  mixed: ['Conocelo en el link en bio.', 'Mas en nuestro perfil.'],
};

const FORMAT_TAG: Record<string, string> = {
  'voz-cercana': '#resena',
  'a-pie-de-calle': '#voxpop',
  'manos-a-la-obra': '#tutorial',
  'el-descubrimiento': '#unboxing',
  'antes-y-despues': '#antesydespues',
  susurro: '#asmr',
  'el-icono': '#producto',
  'gran-pantalla': '#brandfilm',
  'mundo-imposible': '#fooh',
};

export function productHashtag(productName: string): string {
  const slug = productName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return slug ? `#${slug}` : '';
}

export function buildCaption(p: {
  productName: string;
  formatSlug: string;
  goal: CaptionGoal;
  index: number; // i-esimo item del formato: rota gancho y CTA
}): string {
  const hooks = FORMAT_HOOKS[p.formatSlug] ?? GENERIC_HOOKS;
  const hook = hooks[p.index % hooks.length](p.productName);
  const ctas = CTA[p.goal] ?? CTA.mixed;
  const cta = ctas[p.index % ctas.length];
  const tags = [productHashtag(p.productName), FORMAT_TAG[p.formatSlug] ?? '']
    .filter(Boolean)
    .join(' ');
  // 2200 = limite del schema (tope de plataformas sociales).
  return [hook, cta, tags].filter(Boolean).join(' ').slice(0, 2200);
}
