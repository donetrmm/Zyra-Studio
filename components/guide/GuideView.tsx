import {
  Clapperboard,
  FolderKanban,
  Home,
  Image as ImageIcon,
  Library,
  Mic,
  Palette,
  Sparkles,
  Video as VideoIcon,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

// Guía de referencia para usuarios nuevos: qué es cada sección, glosario de
// términos, cómo escribir buenos prompts y las restricciones del sistema.
// Server Component estático (sin estado): solo contenido. El contenido refleja
// el flujo real del producto y las reglas de contenido (CLAUDE.md / spec).

type Term = { term: string; def: string };

const SECTIONS: { icon: LucideIcon; title: string; what: string; use: string }[] = [
  {
    icon: Home,
    title: 'Inicio',
    what: 'Tu tablero de la siguiente acción.',
    use: 'Muestra la campaña más urgente con su botón de compuerta (revisa el plan, aprueba la muestra, marca ganadores…), tu actividad reciente y el saldo de créditos.',
  },
  {
    icon: FolderKanban,
    title: 'Campañas',
    what: 'El Campaign Studio: el camino principal.',
    use: 'Subes tu producto, la IA arma un plan de creativos, los produces (muestra → lote), apruebas la versión final, marcas ganadores y conviertes los que funcionan en plantillas para generar series. Exportas CSV y reporte.',
  },
  {
    icon: Sparkles,
    title: 'Crear (Creación rápida)',
    what: 'Generar un asset suelto: imagen, video o voz.',
    use: 'Para explorar o producir algo puntual fuera de una campaña. Puedes adjuntar el resultado a una colección o campaña. Todo cae en tu Biblioteca.',
  },
  {
    icon: Library,
    title: 'Biblioteca',
    what: 'Todo lo que generas, en un lugar.',
    use: 'Navega por Sesiones o Cuadrícula, marca favoritos, compara A/B, reúsa prompts, descarga y usa una imagen como referencia. En Colecciones agrupas generaciones sueltas; tus campañas aparecen automáticamente como colección con todo lo que producen.',
  },
  {
    icon: Palette,
    title: 'Marca',
    what: 'Tus activos reutilizables de marca.',
    use: 'Brand Kits (producto, paleta y tono), Cast (personajes con su hoja maestra para que la cara no cambie), Voces (clonadas y oficiales) y Referencias (imágenes, videos y audios que reúsas en tus generaciones).',
  },
  {
    icon: Clapperboard,
    title: 'Formatos',
    what: 'Los moldes de cada creativo.',
    use: 'Los formatos del sistema (unboxing, ASMR, a pie de calle…) más tus formatos propios. Cuando un video final funciona, lo conviertes en plantilla viva y generas series rotando escena y personaje.',
  },
  {
    icon: Wallet,
    title: 'Créditos',
    what: 'Tu saldo y consumo.',
    use: 'Ves el saldo, el historial de movimientos y solicitas más créditos (un admin los aprueba; no hay pasarela de pago en la demo).',
  },
];

const GLOSSARY: Term[] = [
  { term: 'Campaña', def: 'Un proyecto con plan y producción: del producto a varios anuncios listos.' },
  { term: 'Creativo', def: 'Cada pieza dentro de una campaña (un video o imagen planificado).' },
  { term: 'Borrador', def: 'Versión de prueba barata (480p) para validar antes de producir el final.' },
  { term: 'Muestra', def: 'Un par de borradores de un formato para revisar antes de lanzar el lote completo.' },
  { term: 'Lote', def: 'La generación de todos los creativos pendientes de un formato.' },
  { term: 'Versión final', def: 'El render aprobado en alta (720p o 1080p), con la misma composición del borrador.' },
  { term: 'Ganador', def: 'El creativo que marcas como mejor; prioriza ese formato en próximas campañas.' },
  { term: 'Secuencia', def: 'Varias escenas encadenadas que juntas forman un anuncio continuo.' },
  { term: 'Plantilla', def: 'La estructura, cámara y ritmo de un video ganador, fijos para reusar.' },
  { term: 'Serie', def: 'Varios creativos generados desde una plantilla, rotando escena y personaje.' },
  { term: 'Colección', def: 'Una carpeta ligera para agrupar generaciones sueltas por proyecto o cliente.' },
  { term: 'Brand Kit', def: 'El producto, su paleta y tono; base de las campañas.' },
  { term: 'Cast', def: 'Tus personajes; nómbralos en tus ideas para dirigirlos en los videos.' },
  { term: 'Formato', def: 'El molde de un creativo (qué tipo de video/imagen y cómo se arma).' },
  { term: 'Preset', def: 'Una configuración de creación guardada para reusarla.' },
  { term: 'Referencia', def: 'Una imagen, video o audio que adjuntas para guiar la generación.' },
];

const PROMPTING: { icon: LucideIcon; title: string; tips: string[] }[] = [
  {
    icon: ImageIcon,
    title: 'Imagen',
    tips: [
      'Describe sujeto, estilo, composición, iluminación y encuadre (plano, ángulo, lente).',
      'Sube referencias para fijar producto, personaje o estilo y mantener consistencia.',
      'Si la imagen lleva texto, activa la opción de texto para que no salga distorsionado.',
      'En modo chat, itera describiendo el cambio sobre la imagen anterior (no re-subas).',
    ],
  },
  {
    icon: VideoIcon,
    title: 'Video',
    tips: [
      'Describe la acción y la cámara (movimiento, plano), no solo el sujeto.',
      'Usa una imagen de inicio o referencias para anclar el producto/personaje y evitar drift.',
      'Empieza con clips cortos para probar; duración y resolución determinan el costo (por segundo).',
      'Fija el seed para iterar manteniendo la misma composición. La generación va en cola.',
    ],
  },
  {
    icon: Mic,
    title: 'Voz / Audio',
    tips: [
      'Escribe el texto tal como debe sonar; la puntuación marca pausas y entonación.',
      'Elige la voz y el idioma adecuados, y prueba la voz con un texto corto antes.',
      'Ajusta estabilidad y similaridad para equilibrar naturalidad y consistencia.',
      'El costo depende de la longitud del texto.',
    ],
  },
];

const CONTENT_RULES: string[] = [
  'No se reproducen marcas, logos, empaques ni claims de productos reales: lo que no exista se crea desde cero.',
  'Los personajes son ficticios y sin marcadores de edad.',
  'No se imitan voces ni identidades de personas reales.',
];

const LIMITS: string[] = [
  'Campaña: de 1 a 6 fotos de producto y hasta 3 personajes; techo de la demo de 30 creativos por campaña.',
  'Los borradores se generan en 480p (más baratos) y la versión final se aprueba aparte en 720p o 1080p.',
  'Las imágenes admiten varias referencias (hasta ~14 según el modelo); los prompts muy largos se recortan al límite del modelo.',
  'Los créditos se descuentan al generar: video por segundo (resolución y duración), imagen por resolución, audio por longitud del texto. La recarga es por solicitud que aprueba un admin.',
];

function Anchor({ id }: { id: string }) {
  return <span id={id} className="block scroll-mt-20" aria-hidden />;
}

export function GuideView() {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <header className="space-y-1.5">
        <h1 className="font-heading text-[24px] font-semibold tracking-tight text-foreground">
          Guía de 1to1 Studio
        </h1>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          Qué es cada cosa, para qué sirve y cómo sacarle el mejor resultado. El camino principal es
          la campaña: subes tu producto, la IA arma un plan de anuncios y los produces de borrador a
          versión final. La Creación rápida es para piezas sueltas. Todo se guarda en tu Biblioteca.
        </p>
      </header>

      {/* Secciones */}
      <Anchor id="secciones" />
      <h2 className="mt-9 font-heading text-[16px] font-semibold text-foreground">Las secciones</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.title} className="rounded-xl border border-border bg-card/50 p-4">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-lg bg-muted/40">
                  <Icon className="size-4 text-primary" aria-hidden />
                </div>
                <h3 className="text-[14px] font-medium text-foreground">{s.title}</h3>
              </div>
              <p className="mt-2 text-[12.5px] font-medium text-foreground/90">{s.what}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{s.use}</p>
            </div>
          );
        })}
      </div>

      {/* Glosario */}
      <Anchor id="glosario" />
      <h2 className="mt-10 font-heading text-[16px] font-semibold text-foreground">Glosario</h2>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {GLOSSARY.map((g) => (
          <div key={g.term} className="border-b border-border/50 pb-2.5">
            <dt className="text-[12.5px] font-medium text-foreground">{g.term}</dt>
            <dd className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{g.def}</dd>
          </div>
        ))}
      </dl>

      {/* Prompting */}
      <Anchor id="prompting" />
      <h2 className="mt-10 font-heading text-[16px] font-semibold text-foreground">
        Cómo escribir buenos prompts
      </h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Regla general: sé específico. Cuanto más describas (sujeto, acción, escena, estilo y encuadre),
        más control tienes sobre el resultado. Las referencias fijan lo que no quieres dejar al azar.
      </p>
      <div className="mt-4 space-y-3">
        {PROMPTING.map((p) => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="rounded-xl border border-border bg-card/50 p-4">
              <div className="flex items-center gap-2.5">
                <Icon className="size-4 text-primary" aria-hidden />
                <h3 className="text-[14px] font-medium text-foreground">{p.title}</h3>
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {p.tips.map((t, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Restricciones */}
      <Anchor id="restricciones" />
      <h2 className="mt-10 font-heading text-[16px] font-semibold text-foreground">
        Restricciones y límites
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
          <h3 className="text-[13px] font-medium text-amber-300/90">Reglas de contenido</h3>
          <ul className="mt-2.5 space-y-1.5">
            {CONTENT_RULES.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-400/70" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <h3 className="text-[13px] font-medium text-foreground">Límites y costos</h3>
          <ul className="mt-2.5 space-y-1.5">
            {LIMITS.map((l, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                {l}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
