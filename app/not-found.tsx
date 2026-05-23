import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="font-heading text-7xl font-semibold tracking-tight text-muted-foreground">
        404
      </p>
      <h1 className="mt-6 font-heading text-3xl font-semibold tracking-tight">
        Esta página no existe
      </h1>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        Es posible que el enlace esté roto o que no tengas acceso al recurso.
      </p>
      <Button asChild className="mt-8">
        <Link href="/app">Volver al inicio</Link>
      </Button>
    </main>
  );
}
