import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ImageIcon,
  Mic,
  Palette,
  Sparkles,
  Video,
  Zap,
  Shield,
  Globe,
  ArrowRight,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Sparkles className="size-5 text-primary" aria-hidden />
            Zyra Studio
          </Link>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Iniciar sesión</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Empezar gratis</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex flex-col items-center px-4 pb-20 pt-24 text-center sm:pt-32">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-0 -translate-x-1/2 size-[600px] rounded-full bg-primary/[0.06] blur-[120px]" />
        </div>
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[12px] font-medium text-primary">
            <Zap className="size-3" aria-hidden />
            Plataforma creativa con IA
          </div>
          <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            Crea contenido profesional con inteligencia artificial
          </h1>
          <p className="mt-6 max-w-xl text-balance text-[15px] leading-relaxed text-muted-foreground sm:text-[17px]">
            Genera imágenes, videos y audio de alta calidad en segundos.
            Organiza por campañas, mantén tu identidad de marca y publica presets para la comunidad.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="gap-2">
              <Link href="/signup">
                Empezar gratis
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">Ya tengo cuenta</Link>
            </Button>
          </div>
          <p className="mt-4 text-[12px] text-muted-foreground/60">500 créditos gratis al registrarte. Sin tarjeta de crédito.</p>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/50 bg-card/30 px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-[13px] font-semibold uppercase tracking-wider text-primary">Capacidades</h2>
          <p className="mt-3 text-center text-2xl font-semibold tracking-tight sm:text-3xl">Todo lo que necesitas para crear</p>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<ImageIcon className="size-5" />}
              title="Generación de imágenes"
              description="Nano Banana Pro, FLUX 2 Pro y más. Con referencias, sin fondo, edición conversacional y brand kit integrado."
            />
            <FeatureCard
              icon={<Video className="size-5" />}
              title="Generación de video"
              description="Kling 3.0 y Veo 3.1 con audio nativo. Duración flexible, imágenes de referencia y estilos cinematográficos."
            />
            <FeatureCard
              icon={<Mic className="size-5" />}
              title="Audio y clonación de voz"
              description="ElevenLabs TTS multilingual. Clona voces con samples de audio y úsalas en cualquier generación."
            />
            <FeatureCard
              icon={<Palette className="size-5" />}
              title="Brand Kits"
              description="Define tu paleta, fuentes y tono de marca. Se inyecta automáticamente en cada generación."
            />
            <FeatureCard
              icon={<Sparkles className="size-5" />}
              title="Prompt Assistant"
              description="IA que reescribe tu prompt optimizado para cada modelo. Video, imagen y audio con un click."
            />
            <FeatureCard
              icon={<Globe className="size-5" />}
              title="Presets comunitarios"
              description="Guarda y publica tus configuraciones. Explora presets de otros creadores y úsalos al instante."
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-[13px] font-semibold uppercase tracking-wider text-primary">Cómo funciona</h2>
          <p className="mt-3 text-center text-2xl font-semibold tracking-tight sm:text-3xl">Tres pasos para crear</p>

          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            <StepCard number="01" title="Describe" description="Escribe lo que quieres crear. El prompt assistant te ayuda a optimizarlo." />
            <StepCard number="02" title="Genera" description="Elige el modelo, aplica tu brand kit y genera en segundos con IA." />
            <StepCard number="03" title="Organiza" description="Guarda en campañas, compara resultados y comparte presets con tu equipo." />
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="border-t border-border/50 bg-card/30 px-4 py-16">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 text-center">
          <div className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
            <Shield className="size-4 text-primary" aria-hidden />
            Seguridad y privacidad
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Tus generaciones se almacenan en Supabase Storage con URLs firmadas.
            Nunca compartimos tu contenido. Control total de créditos con sistema atómico de reserva y reembolso.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Empieza a crear hoy
          </h2>
          <p className="mt-4 text-[15px] text-muted-foreground">
            500 créditos de bienvenida. Sin límites de tiempo. Sin tarjeta de crédito.
          </p>
          <Button asChild size="lg" className="mt-8 gap-2">
            <Link href="/signup">
              Crear cuenta gratis
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 px-4 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Sparkles className="size-4 text-primary" aria-hidden />
            Zyra Studio
          </div>
          <p className="text-[12px] text-muted-foreground/60">
            Plataforma creativa con IA. Hecho para creadores, agencias y equipos.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-5 transition-colors hover:border-muted-foreground/20">
      <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mt-4 text-[14px] font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full border border-primary/30 bg-primary/10 font-mono text-[14px] font-semibold text-primary">
        {number}
      </div>
      <h3 className="mt-4 text-[15px] font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
