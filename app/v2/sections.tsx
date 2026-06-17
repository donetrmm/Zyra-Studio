"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  FileText,
  PenLine,
  Layers,
  Send,
  Trophy,
  MessageCircle,
  Users,
  Hand,
  Package,
  ArrowLeftRight,
  AudioLines,
  Box,
  Film,
  Wand2,
  Fingerprint,
  Repeat,
  Gauge,
  MessagesSquare,
  Video,
  Image as ImageIcon,
  Mic,
  ArrowRight,
  Check,
} from "lucide-react";
import { Reveal, staggerContainer, staggerItem, cn } from "./reveal";
import { AudioWave, DirectionChat, CreativesMarquee, PlanMock } from "./visuals";

/* ---------- encabezado de sección reutilizable ---------- */
function SectionHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub?: string;
}) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center mb-14">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-[#009fff]">
        {eyebrow}
      </span>
      <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-zinc-50">
        {title}
      </h2>
      {sub && <p className="mt-4 text-zinc-400 leading-relaxed">{sub}</p>}
    </Reveal>
  );
}

/* =================== CÓMO FUNCIONA — 5 etapas =================== */
const ETAPAS = [
  {
    icon: FileText,
    n: "01",
    name: "Brief",
    desc: "Sube tu producto y tu objetivo. El sistema detecta categoría, variantes y paleta, y propone un mix de formatos editable.",
  },
  {
    icon: PenLine,
    n: "02",
    name: "Dirección creativa",
    desc: "El Prompt Director escribe el plan: cada creativo con formato, concepto, escena y caption. Lo editas como documento, no como formulario.",
  },
  {
    icon: Layers,
    n: "03",
    name: "Producción en lote",
    desc: "Genera 2-3 de muestra antes del lote completo. Borrador barato para validar la dirección, versión final solo de lo aprobado.",
  },
  {
    icon: Send,
    n: "04",
    name: "Entrega",
    desc: "Biblioteca agrupada por campaña, calendario de publicación y export CSV/XLSX con fecha, formato, archivo y caption.",
  },
  {
    icon: Trophy,
    n: "05",
    name: "Aprendizaje",
    desc: "Marca tus ganadores: se destilan en plantillas vivas y alimentan el mix recomendado de tu próxima campaña.",
  },
];

function ComoFunciona() {
  return (
    <section id="como-funciona" className="relative py-24">
      <div className="mx-auto max-w-[1180px] px-7">
        <SectionHead
          eyebrow="El flujo"
          title={<>Cinco etapas, de la idea a la entrega</>}
          sub="Cada etapa termina en una compuerta de aprobación con defaults inteligentes. Tú decides; el sistema produce."
        />
        <div className="relative">
          {/* línea vertical conectora */}
          <div className="absolute left-[27px] top-4 bottom-4 w-px bg-gradient-to-b from-[#009fff]/40 via-white/10 to-transparent md:hidden" />
          <motion.ol
            className="grid gap-4 md:grid-cols-5"
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
          >
            {ETAPAS.map((e) => (
              <motion.li
                key={e.n}
                variants={staggerItem}
                className="group relative rounded-2xl border border-white/8 bg-zinc-900/40 p-5 transition-colors hover:border-[#009fff]/40"
              >
                <div className="flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-[#009fff]/25 bg-[#009fff]/10 text-[#009fff]">
                    <e.icon className="h-5 w-5" />
                  </span>
                  <span className="font-mono text-xs text-zinc-600">{e.n}</span>
                </div>
                <h3 className="mt-4 font-semibold text-zinc-100">{e.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {e.desc}
                </p>
              </motion.li>
            ))}
          </motion.ol>
        </div>
      </div>
    </section>
  );
}

/* =================== FORMATOS — 9 =================== */
const FORMATOS = [
  { icon: MessageCircle, name: "Voz Cercana", desc: "Testimonio de creador (talking-head UGC)" },
  { icon: Users, name: "A Pie de Calle", desc: "Entrevista espontánea a desconocidos" },
  { icon: Hand, name: "Manos a la Obra", desc: "Demostración o tutorial paso a paso" },
  { icon: Package, name: "El Descubrimiento", desc: "Unboxing y revelación del producto" },
  { icon: ArrowLeftRight, name: "Antes y Después", desc: "Transformación de alto impacto" },
  { icon: AudioLines, name: "Susurro", desc: "ASMR sensorial con audio nativo" },
  { icon: Box, name: "El Ícono", desc: "Héroe de producto kinético" },
  { icon: Film, name: "Gran Pantalla", desc: "Narrativa de marca cinematográfica" },
  { icon: Wand2, name: "Mundo Imposible", desc: "Concepto surreal y FOOH" },
];

function Formatos() {
  return (
    <section id="formatos" className="relative py-24">
      <div className="mx-auto max-w-[1180px] px-7">
        <SectionHead
          eyebrow="Formatos"
          title={<>Nueve formatos que encapsulan el oficio</>}
          sub="Cada formato define registro, cámara, ritmo y qué referencias exige — no un prompt fijo. Punto de partida editable, nunca una jaula."
        />
        <motion.div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
        >
          {FORMATOS.map((f) => (
            <motion.div
              key={f.name}
              variants={staggerItem}
              whileHover={{ y: -4 }}
              className="group rounded-2xl border border-white/8 bg-zinc-900/40 p-5 transition-colors hover:border-[#009fff]/40 hover:bg-zinc-900/70"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-zinc-950/60 text-[#7cd9ff] transition-colors group-hover:border-[#009fff]/40 group-hover:text-[#009fff]">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold text-zinc-100">{f.name}</h3>
              <p className="mt-1 text-sm text-zinc-400">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* =================== EL OFICIO — bento 4 =================== */
const OFICIO = [
  {
    icon: Wand2,
    name: "Prompt Director",
    desc: "Dirección creativa razonada: convierte tu brief en dirección de producción por modelo y por formato, con referencias y validación de producibilidad. No rellena plantillas muertas.",
    span: "lg:col-span-2",
    visual: "plan",
  },
  {
    icon: MessagesSquare,
    name: "Refinado conversacional",
    desc: "Ajusta cualquier creativo escribiendo lo que quieres cambiar — «más cinemática», «una variante para TikTok». Iteras sin volver a empezar.",
    span: "",
    visual: "chat",
  },
  {
    icon: Fingerprint,
    name: "Marca consistente",
    desc: "Brand Kit + Cast: logo, producto multi-ángulo y personajes inyectados como referencia en cada generación. Identidad sin fine-tuning.",
    span: "",
    visual: "",
  },
  {
    icon: Repeat,
    name: "Plantillas vivas",
    desc: "Un creativo ganador se vuelve plantilla: fijas estilo y ritmo, rotas producto y escena. Tu catálogo crece con cada campaña.",
    span: "",
    visual: "",
  },
  {
    icon: Gauge,
    name: "Economía visible",
    desc: "Estimador antes de generar, borrador barato → versión final, y reporte de valor al cierre: créditos reales vs costo tradicional.",
    span: "",
    visual: "",
  },
];

function Oficio() {
  return (
    <section id="oficio" className="relative py-24">
      <div className="mx-auto max-w-[1180px] px-7">
        <SectionHead
          eyebrow="El oficio encapsulado"
          title={<>El valor no está en los modelos. Está encima.</>}
          sub="La capa que convierte conceptos planos en producción de nivel senior — y la que empaqueta campañas completas, no clips sueltos."
        />
        <motion.div
          className="grid gap-3 lg:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
        >
          {OFICIO.map((o) => (
            <motion.div
              key={o.name}
              variants={staggerItem}
              className={cn(
                "relative overflow-hidden rounded-2xl border border-white/8 bg-zinc-900/40 p-6",
                o.span
              )}
            >
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#009fff]/10 blur-2xl" />
              <span className="relative grid h-11 w-11 place-items-center rounded-xl border border-[#009fff]/25 bg-[#009fff]/10 text-[#009fff]">
                <o.icon className="h-5 w-5" />
              </span>
              <h3 className="relative mt-4 text-lg font-semibold text-zinc-100">
                {o.name}
              </h3>
              <p className="relative mt-2 text-sm leading-relaxed text-zinc-400 max-w-md">
                {o.desc}
              </p>
              {o.visual === "plan" && (
                <div className="relative mt-5 rounded-xl border border-white/8 bg-zinc-950/50 p-4">
                  <PlanMock />
                </div>
              )}
              {o.visual === "chat" && (
                <div className="relative mt-5 rounded-xl border border-white/8 bg-zinc-950/50 p-3">
                  <DirectionChat />
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* =================== MODELOS — 3 =================== */
const MODELOS = [
  {
    icon: Video,
    tag: "Video",
    title: "Seedance 2.0",
    desc: "Motor principal de video: multi-referencia (hasta 12 archivos), audio estéreo nativo, multi-toma y edición. Veo y Kling siguen disponibles para personas reales.",
    points: ["Audio nativo integrado", "Multi-referencia y multi-toma", "Extensión y escena puente"],
    featured: true,
  },
  {
    icon: ImageIcon,
    tag: "Imagen",
    title: "FLUX + Nano Banana",
    desc: "FLUX genera desde cero con consistencia de color y materiales. Nano Banana edita, inserta logo y compone con referencia.",
    points: ["Generación fotorrealista", "Edición conversacional", "Brand kit como referencia"],
    featured: false,
  },
  {
    icon: Mic,
    tag: "Voz",
    title: "ElevenLabs",
    desc: "Narración y voz de marca en varios idiomas, con clonación de voz para mantener un tono consistente en toda la campaña.",
    points: ["Multilingüe", "Clonación de voz", "Tags expresivos"],
    featured: false,
  },
];

function Modelos() {
  return (
    <section id="modelos" className="relative py-24">
      <div className="mx-auto max-w-[1180px] px-7">
        <SectionHead
          eyebrow="Modelos"
          title={<>Los mejores motores, una sola cuenta</>}
          sub="La capa de modelos es intercambiable. El router elige el adecuado según la etapa y el formato; tú no piensas en parámetros técnicos."
        />
        <motion.div
          className="grid gap-3 lg:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
        >
          {MODELOS.map((m) => (
            <motion.div
              key={m.title}
              variants={staggerItem}
              className={cn(
                "rounded-2xl border p-6 transition-colors",
                m.featured
                  ? "border-[#009fff]/40 bg-gradient-to-b from-[#009fff]/10 to-zinc-900/40"
                  : "border-white/8 bg-zinc-900/40 hover:border-white/15"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-zinc-950/60 text-[#7cd9ff]">
                  <m.icon className="h-4.5 w-4.5" />
                </span>
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                  {m.tag}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-zinc-100">
                {m.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {m.desc}
              </p>
              {m.tag === "Voz" && (
                <div className="mt-4 rounded-lg border border-white/8 bg-zinc-950/40 px-2">
                  <AudioWave />
                </div>
              )}
              <ul className="mt-4 space-y-2">
                {m.points.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm text-zinc-300">
                    <Check className="h-4 w-4 shrink-0 text-[#009fff]" strokeWidth={2.5} />
                    {p}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* =================== VALOR — banda con métricas =================== */
const STATS = [
  { k: "10-30", v: "creativos por campaña" },
  { k: "2-3", v: "de muestra antes del lote" },
  { k: "12", v: "referencias por toma" },
  { k: "1 → serie", v: "un ganador, una plantilla viva" },
];

function Valor() {
  return (
    <section className="relative py-24">
      <div className="mx-auto max-w-[1180px] px-7">
        <Reveal className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/40 p-10 lg:p-14">
          <div className="absolute -left-20 top-0 h-64 w-64 rounded-full bg-[#009fff]/15 blur-3xl" />
          <div className="relative grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-[#009fff]">
                Por qué V2
              </span>
              <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-zinc-50">
                Más campañas, menos iteraciones, costo a la vista
              </h2>
              <p className="mt-4 text-zinc-400 leading-relaxed max-w-lg">
                Dirigir con referencias en vez de describir con palabras,
                validar la producibilidad antes de gastar créditos y producir en
                lote: una sola persona rinde como un equipo creativo completo.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {STATS.map((s) => (
                <div
                  key={s.v}
                  className="rounded-2xl border border-white/8 bg-zinc-950/50 p-5"
                >
                  <div className="text-2xl font-semibold text-[#7cd9ff]">
                    {s.k}
                  </div>
                  <div className="mt-1 text-sm text-zinc-400">{s.v}</div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* =================== CTA FINAL =================== */
function FinalCta() {
  return (
    <section className="relative py-24">
      <div className="mx-auto max-w-[1180px] px-7">
        <Reveal className="relative overflow-hidden rounded-3xl border border-[#009fff]/25 bg-gradient-to-b from-[#009fff]/12 to-zinc-950 p-12 text-center lg:p-20">
          <motion.div
            className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-64 w-[640px] rounded-full"
            style={{ background: "radial-gradient(closest-side, rgba(0,159,255,0.3), transparent)" }}
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />
          <h2 className="relative text-3xl sm:text-5xl font-semibold tracking-tight text-zinc-50">
            Tu primera campaña, hoy
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-zinc-300">
            500 créditos gratis al registrarte. Sin tarjeta. Sin suscripción.
          </p>
          <div className="relative mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/signup"
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-[#009fff] px-8 py-4 font-semibold text-white transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,159,255,0.45)] hover:-translate-y-0.5"
            >
              Empezar gratis
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.02] px-8 py-4 font-semibold text-zinc-100 transition-colors hover:border-[#009fff]/50 hover:bg-[#009fff]/5"
            >
              Iniciar sesión
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* =================== BANDA — lote de creativos =================== */
function CreativesBand() {
  return (
    <section className="relative pb-4">
      <Reveal className="mx-auto mb-6 max-w-2xl px-7 text-center">
        <p className="text-sm text-zinc-500">
          Un brief, un lote de creativos listos para publicar
        </p>
      </Reveal>
      <CreativesMarquee />
    </section>
  );
}

export function Sections() {
  return (
    <>
      <CreativesBand />
      <ComoFunciona />
      <Formatos />
      <Oficio />
      <Modelos />
      <Valor />
      <FinalCta />
    </>
  );
}
