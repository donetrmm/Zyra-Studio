import {
  Clapperboard,
  Image as ImageIcon,
  Layers,
  Mic,
  Video as VideoIcon,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

// Guía de referencia para usuarios nuevos. Server Component estático: solo
// contenido. Refleja el flujo, los formatos, los modelos y los costos REALES
// del producto (no descripciones genéricas).

function Anchor({ id }: { id: string }) {
  return <span id={id} className="block scroll-mt-20" aria-hidden />;
}

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <>
      {id && <Anchor id={id} />}
      <h2 className="mt-10 font-heading text-[17px] font-semibold text-foreground">{children}</h2>
    </>
  );
}

function Bullets({ items, dot = 'bg-primary' }: { items: React.ReactNode[]; dot?: string }) {
  return (
    <ul className="mt-2.5 space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
          <span className={`mt-1.5 size-1 shrink-0 rounded-full ${dot}`} aria-hidden />
          {t}
        </li>
      ))}
    </ul>
  );
}

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Sube tu producto',
    body: (
      <>
        En <strong className="text-foreground/90">Campañas › Nueva campaña</strong>, sube de 1 a 6
        fotos (frontal, perfil, detalle; fondo simple). La primera define el análisis. ¿No tienes
        foto? Usa <em>«Créala con IA»</em>. También puedes reusar un Brand Kit existente.
      </>
    ),
  },
  {
    title: 'Describe lo que imaginas',
    body: (
      <>
        Un creativo por idea: <em>«3 unboxings, algo ASMR, mi perro usa el producto»</em>. La IA
        (el <strong className="text-foreground/90">matcher</strong>) elige formato y cantidad; lo que
        no encaje en el catálogo crea un formato tuyo. Opcional: URL del producto y personajes del Cast.
      </>
    ),
  },
  {
    title: 'Revisa el plan',
    body: (
      <>
        <strong className="text-foreground/90">«Armar el plan»</strong> genera la tabla de creativos
        por formato. Las secuencias salen marcadas <em>«sugerida por IA»</em>. Aquí editas, refinas o
        eliminas antes de gastar créditos.
      </>
    ),
  },
  {
    title: 'Tira una muestra',
    body: (
      <>
        En <strong className="text-foreground/90">Producción</strong>, <em>«Muestra (2)»</em> genera 2
        borradores baratos (480p) de un formato para validar el rumbo antes de lanzar todo. Si
        convence, <em>«Lote completo»</em> produce el resto.
      </>
    ),
  },
  {
    title: 'Itera el borrador',
    body: (
      <>
        Sobre cada borrador: <em>«Ver»</em>, <em>«Refinar»</em> (asistente conversacional que ajusta el
        prompt), <em>«Regenerar»</em>, o aprobar la <strong className="text-foreground/90">versión
        final</strong> eligiendo <em>720p</em> o <em>1080p</em>.
      </>
    ),
  },
  {
    title: 'Marca ganadores y entrega',
    body: (
      <>
        En los finales: <em>«Marcar ganador»</em> (prioriza ese formato a futuro),
        <em> «Convertir en plantilla»</em> (reusar su estructura) o <em>«Variante»</em>. Reprograma en
        el <strong className="text-foreground/90">Calendario</strong> y entrega con <em>CSV</em> y
        <em> Reporte</em>.
      </>
    ),
  },
];

const FORMATS: { name: string; desc: string; dur: string; needs: string }[] = [
  { name: 'Voz Cercana', desc: 'Testimonio UGC: una persona habla a cámara con el producto en mano.', dur: '9s', needs: 'Producto + personaje' },
  { name: 'A Pie de Calle', desc: 'Entrevista espontánea a desconocidos; el producto aparece en la charla.', dur: '12s', needs: 'Producto + personaje' },
  { name: 'Manos a la Obra', desc: 'Demostración o tutorial: las manos trabajan, el producto es el centro.', dur: '12s', needs: 'Producto' },
  { name: 'El Descubrimiento', desc: 'Unboxing y revelación: del empaque cerrado al producto revelado.', dur: '10s', needs: 'Producto + empaque' },
  { name: 'Antes y Después', desc: 'Transformación en dos estados; de los de mayor conversión en paid social.', dur: '8s', needs: 'Producto' },
  { name: 'Susurro', desc: 'ASMR sensorial: primeros planos guiados por sonido, sin diálogo.', dur: '10s', needs: 'Producto' },
  { name: 'El Ícono', desc: 'Héroe de producto kinético: el producto sin personas, en movimiento.', dur: '8s', needs: 'Producto' },
  { name: 'Gran Pantalla', desc: 'Narrativa de marca cinematográfica, registro de spot premium.', dur: '15s', needs: 'Producto' },
  { name: 'Mundo Imposible', desc: 'Concepto surreal / FOOH: escenas imposibles con el producto como ancla.', dur: '10s', needs: 'Producto' },
];

const MODELS: { icon: LucideIcon; type: string; items: React.ReactNode[] }[] = [
  {
    icon: ImageIcon,
    type: 'Imagen',
    items: [
      <><strong className="text-foreground/90">Nano Banana Pro</strong> — máxima calidad y detalle, hasta 4K. Para la pieza final.</>,
      <><strong className="text-foreground/90">Nano Flash</strong> — rápido y barato para explorar e iterar.</>,
      <><strong className="text-foreground/90">FLUX 2 Pro</strong> — fotorealismo; control por megapíxeles. Hasta ~14 referencias según el modelo.</>,
    ],
  },
  {
    icon: VideoIcon,
    type: 'Video',
    items: [
      <><strong className="text-foreground/90">Seedance 2.0</strong> — referencia→video; ancla producto y personaje (lo usan las campañas). Borrador en 480p, final en 720p/1080p.</>,
      <><strong className="text-foreground/90">Veo 3.1</strong> — look cinematográfico con audio.</>,
      <><strong className="text-foreground/90">Kling</strong> — buen movimiento, varias calidades.</>,
    ],
  },
  {
    icon: Mic,
    type: 'Voz / Audio',
    items: [
      <><strong className="text-foreground/90">ElevenLabs</strong> — texto a voz multilingüe. Usa voces oficiales o clona la tuya en Marca › Voces.</>,
    ],
  },
];

const PROMPTS: { icon: LucideIcon; title: string; bad: string; good: string }[] = [
  {
    icon: ImageIcon,
    title: 'Imagen',
    bad: 'una foto de mi producto',
    good: 'Botella de suero facial ámbar sobre mármol blanco, luz lateral suave de mañana, gotas de agua, fondo desenfocado, plano cenital a 45°, estilo editorial de belleza.',
  },
  {
    icon: VideoIcon,
    title: 'Video',
    bad: 'video del producto',
    good: 'La presentadora sostiene la lata frente a la cámara, da un sorbo y sonríe; cámara selfie handheld a la altura de los ojos, luz natural de ventana, una sola toma continua.',
  },
  {
    icon: Mic,
    title: 'Voz',
    bad: 'lee esto en voz alta',
    good: '«¿Listo para probarlo?», dijo ella —con una pausa breve—. «No te va a decepcionar». (La puntuación marca pausas y entonación.)',
  },
];

const GLOSSARY: { term: string; def: string }[] = [
  { term: 'Campaña', def: 'Proyecto con plan y producción: del producto a varios anuncios listos.' },
  { term: 'Creativo', def: 'Cada pieza dentro de una campaña (un video o imagen planificado).' },
  { term: 'Borrador', def: 'Versión de prueba barata (480p) para validar antes del final.' },
  { term: 'Muestra', def: 'Un par de borradores de un formato para revisar antes del lote completo.' },
  { term: 'Lote', def: 'La generación de todos los creativos pendientes de un formato.' },
  { term: 'Versión final', def: 'Render aprobado en alta (720p o 1080p), misma composición del borrador.' },
  { term: 'Ganador', def: 'El creativo que marcas como mejor; prioriza ese formato a futuro.' },
  { term: 'Secuencia', def: 'Varias escenas encadenadas que juntas forman un anuncio continuo.' },
  { term: 'Plantilla / Serie', def: 'Estructura de un video ganador, fija para generar varias piezas rotando escena y personaje.' },
  { term: 'Matcher', def: 'La IA que interpreta tus ideas y decide formato y cantidad de creativos.' },
  { term: 'Drift', def: 'Cuando la cara o identidad de un personaje cambia entre clips.' },
  { term: 'Hoja maestra', def: 'Imagen base de un personaje del Cast que fija su apariencia y evita el drift.' },
  { term: 'Brand Kit', def: 'El producto, su paleta y tono; base de las campañas.' },
  { term: 'Colección', def: 'Carpeta ligera para agrupar generaciones sueltas; las campañas también aparecen como colección.' },
  { term: 'Referencia', def: 'Imagen, video o audio que adjuntas para guiar la generación.' },
  { term: 'Preset', def: 'Una configuración de creación guardada para reusarla.' },
];

export function GuideView() {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <header className="space-y-1.5">
        <h1 className="font-heading text-[24px] font-semibold tracking-tight text-foreground">
          Guía de 1to1 Studio
        </h1>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          El camino principal es la <strong className="text-foreground/90">campaña</strong>: subes tu
          producto, la IA arma un plan de anuncios y los produces de borrador (480p, barato) a versión
          final (720p/1080p). La <strong className="text-foreground/90">Creación rápida</strong> es para
          piezas sueltas. Todo se guarda en tu <strong className="text-foreground/90">Biblioteca</strong>.
        </p>
      </header>

      {/* Flujo paso a paso */}
      <H2 id="primera-campana">Tu primera campaña, paso a paso</H2>
      <ol className="mt-4 space-y-3">
        {STEPS.map((s, i) => (
          <li key={i} className="flex gap-3 rounded-xl border border-border bg-card/50 p-4">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-[12px] font-medium text-primary">
              {i + 1}
            </span>
            <div>
              <p className="text-[13px] font-medium text-foreground">{s.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* Formatos */}
      <H2 id="formatos">Los 9 formatos del sistema</H2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Cada formato es un molde con su registro, cámara y ritmo. El matcher elige el que mejor encaja
        con cada idea; también puedes pedirlos por nombre.
      </p>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {FORMATS.map((f) => (
          <div key={f.name} className="rounded-xl border border-border bg-card/50 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[13.5px] font-medium text-foreground">{f.name}</h3>
              <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                {f.dur}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{f.desc}</p>
            <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clapperboard className="size-3 text-primary/70" aria-hidden />
              {f.needs}
            </p>
          </div>
        ))}
      </div>

      {/* Secuencias y consistencia */}
      <H2 id="secuencias">Secuencias y consistencia</H2>
      <div className="mt-4 rounded-xl border border-border bg-card/50 p-4">
        <div className="flex items-center gap-2.5">
          <Layers className="size-4 text-primary" aria-hidden />
          <h3 className="text-[14px] font-medium text-foreground">Anuncios de varias escenas</h3>
        </div>
        <Bullets
          items={[
            <>Una <strong className="text-foreground/90">secuencia</strong> divide una idea en varias escenas que se generan en orden y, juntas, forman un anuncio. Con <em>«Unir en 1 clip»</em> se concatenan en un solo video continuo (máx 15s) — ojo: es irreversible.</>,
            <>Al regenerar una escena de la cadena puedes elegir <em>«Regenerar solo este»</em> (conserva los vecinos) o <em>«Este y los siguientes»</em> (vuelve a encadenar hacia adelante).</>,
            <>Para evitar <strong className="text-foreground/90">drift</strong> (que la cara o el producto cambie entre clips), el sistema re-ancla la <strong className="text-foreground/90">hoja maestra</strong> del personaje y las fotos del producto en cada escena. Crea personajes en <em>Marca › Cast</em> y nómbralos en tus ideas.</>,
          ]}
        />
      </div>

      {/* Creación rápida y modelos */}
      <H2 id="modelos">Creación rápida y modelos</H2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Usa <strong className="text-foreground/90">Crear</strong> para una pieza suelta (explorar, un
        asset puntual). Elige el modelo según el objetivo:
      </p>
      <div className="mt-4 space-y-3">
        {MODELS.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.type} className="rounded-xl border border-border bg-card/50 p-4">
              <div className="flex items-center gap-2.5">
                <Icon className="size-4 text-primary" aria-hidden />
                <h3 className="text-[14px] font-medium text-foreground">{m.type}</h3>
              </div>
              <Bullets items={m.items} />
            </div>
          );
        })}
      </div>

      {/* Prompting */}
      <H2 id="prompting">Prompting que funciona</H2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Sé específico: sujeto, acción, escena, estilo y encuadre. Las referencias fijan lo que no
        quieres dejar al azar. ¿Sin inspiración? El botón <em>«Mejorar con IA»</em> reescribe tu prompt.
      </p>
      <div className="mt-4 space-y-3">
        {PROMPTS.map((p) => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="rounded-xl border border-border bg-card/50 p-4">
              <div className="flex items-center gap-2.5">
                <Icon className="size-4 text-primary" aria-hidden />
                <h3 className="text-[14px] font-medium text-foreground">{p.title}</h3>
              </div>
              <div className="mt-2.5 space-y-2">
                <div className="rounded-lg border border-destructive/25 bg-destructive/[0.05] px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-destructive/80">Evita</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{p.bad}</p>
                </div>
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400/80">Mejor</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground/90">{p.good}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Créditos y costos */}
      <H2 id="costos">Créditos y costos</H2>
      <div className="mt-4 rounded-xl border border-border bg-card/50 p-4">
        <div className="flex items-center gap-2.5">
          <Wallet className="size-4 text-primary" aria-hidden />
          <h3 className="text-[14px] font-medium text-foreground">Qué cuesta cada cosa</h3>
        </div>
        <Bullets
          items={[
            <><strong className="text-foreground/90">Imagen</strong> (por render): Nano Flash 30–50 cr · Nano Pro 60–120 cr (1K–4K) · FLUX 2 Pro 25 cr/megapíxel.</>,
            <><strong className="text-foreground/90">Video de campaña</strong> (por segundo): borrador 480p 45 cr/s · final 720p 100 cr/s · final 1080p 220 cr/s. Un clip de 8s ≈ 360 cr en borrador, 800 en 720p, 1.760 en 1080p.</>,
            <><strong className="text-foreground/90">Creación rápida de video</strong>: Seedance, Veo y Kling; va por segundo y modelo/resolución (desde ~40 cr/s).</>,
            <><strong className="text-foreground/90">Voz</strong>: según la longitud del texto y el modelo de voz.</>,
            <>Extras: <em>Mejorar prompt</em> ~5 cr · <em>Refinar</em> (asistente) ~8 cr por sesión.</>,
            <>La recarga de créditos es por solicitud que aprueba un admin (sin pasarela de pago en la demo).</>,
          ]}
        />
      </div>

      {/* Restricciones */}
      <H2 id="restricciones">Restricciones y límites</H2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
          <h3 className="text-[13px] font-medium text-amber-300/90">Reglas de contenido</h3>
          <Bullets
            dot="bg-amber-400/70"
            items={[
              'No se reproducen marcas, logos, empaques ni claims de productos reales: lo que no exista se crea desde cero.',
              'Los personajes son ficticios y sin marcadores de edad.',
              'No se imitan voces ni identidades de personas reales.',
            ]}
          />
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <h3 className="text-[13px] font-medium text-foreground">Límites</h3>
          <Bullets
            items={[
              'Campaña: de 1 a 6 fotos de producto y hasta 3 personajes; techo de la demo de 30 creativos.',
              'Borradores en 480p; versión final en 720p o 1080p.',
              'Imágenes: hasta ~14 referencias según el modelo; los prompts muy largos se recortan al límite del modelo.',
              'Video y audio largos se procesan en cola; el resultado aparece al terminar.',
            ]}
          />
        </div>
      </div>

      {/* Glosario */}
      <H2 id="glosario">Glosario</H2>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {GLOSSARY.map((g) => (
          <div key={g.term} className="border-b border-border/50 pb-2.5">
            <dt className="text-[12.5px] font-medium text-foreground">{g.term}</dt>
            <dd className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{g.def}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
