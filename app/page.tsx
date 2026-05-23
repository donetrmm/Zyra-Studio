import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Zyra Studio
      </p>
      <h1 className="mt-6 max-w-3xl text-balance font-heading text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
        Create Beyond Limits
      </h1>
      <p className="mt-6 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
        Plataforma creativa impulsada por IA para generar video, imagen y voz
        de manera rápida, moderna y profesional.
      </p>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/signup">Empezar gratis</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/login">Iniciar sesión</Link>
        </Button>
      </div>
    </main>
  );
}
