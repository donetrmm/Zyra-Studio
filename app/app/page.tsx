import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveCreditValue } from "@/components/layout/LiveCreditValue";
import { WelcomeModal } from "@/components/onboarding/WelcomeModal";
import { PipelineBar } from "@/components/campaigns/PipelineBar";
import { requireWorkspace } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { publicThumbnailUrl } from "@/lib/supabase/storage";
import {
  deriveGate,
  fetchCampaignSummaries,
  gateUrgency,
  type CampaignSummary,
} from "@/lib/campaigns/summary";

export const metadata: Metadata = {
  title: "Inicio",
};

// Dashboard acción-primero (specs/v2/06 §4.2): el hero es la campaña con la
// compuerta más cercana — o el arranque de la primera campaña. Las métricas
// no encabezan nada; el saldo vive en el topbar y en una línea secundaria.
export default async function DashboardPage() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [balanceRes, campaigns, generationsRes] = await Promise.all([
    supabase
      .from("credit_balances")
      .select("balance, pending")
      .eq("user_id", user.id)
      .single(),
    fetchCampaignSummaries(supabase, workspace.id),
    supabase
      .from("generations")
      .select("id, type, model_id, status, thumbnail_url, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const balance = balanceRes.data?.balance ?? 0;
  const pending = balanceRes.data?.pending ?? 0;
  const generations = generationsRes.data ?? [];

  const sorted = [...campaigns].sort(
    (a, b) =>
      gateUrgency(b) - gateUrgency(a) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const hero = sorted[0] ?? null;
  const others = sorted.slice(1, 4);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <WelcomeModal />
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Bienvenido, {user.fullName ?? user.email.split("@")[0]}
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {workspace.name}
        </h1>
      </header>

      {hero ? <CampaignHero campaign={hero} /> : <FirstCampaignHero />}

      {others.length > 0 && (
        <section className="space-y-1.5">
          {others.map((c) => {
            const gate = deriveGate(c);
            return (
              <Link
                key={c.id}
                href={`/app/campaigns/${c.id}`}
                className="group flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5 text-2sm transition-colors hover:border-primary/40"
              >
                <span className="min-w-0 truncate text-foreground/90">{c.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground group-hover:text-foreground">
                  {gate.live && <Loader2 className="size-3 animate-spin" aria-hidden />}
                  {gate.cta}
                  <ArrowRight className="size-3" aria-hidden />
                </span>
              </Link>
            );
          })}
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-[15px] font-semibold">Actividad reciente</h2>
            <Link
              href="/app/library"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Ir a la Biblioteca
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          {generations.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
              Aquí aparecerá lo que generes — en campañas o en la Creación rápida.
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-8">
              {generations.map((g) => {
                const thumb = g.thumbnail_url ? publicThumbnailUrl(g.thumbnail_url) : null;
                return (
                  <li
                    key={g.id}
                    className="aspect-square overflow-hidden rounded-md border border-border bg-muted"
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt={g.model_id ?? ""} className="size-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center px-1 text-center text-2xs text-muted-foreground">
                        {g.status === "done" ? g.type : g.status}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4">
          <p className="text-2xs uppercase tracking-wider text-muted-foreground">Créditos</p>
          <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">
            <LiveCreditValue userId={user.id} initialBalance={balance} />
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {pending > 0 ? `${fmt(pending)} reservados en producción` : "Listos para usar"}
          </p>
          <Link
            href="/app/billing"
            className="mt-3 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
          >
            Comprar más
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}

// La campaña con la compuerta más urgente, con su CTA como acción primaria.
function CampaignHero({ campaign }: { campaign: CampaignSummary }) {
  const gate = deriveGate(campaign);
  return (
    <section className="rounded-2xl border border-border bg-card/50 p-5 sm:p-6">
      <p className="text-2xs font-medium uppercase tracking-wider text-primary">
        Tu siguiente paso
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate font-heading text-xl font-semibold tracking-tight">
            {campaign.name}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {campaign.productName}
            {campaign.total > 0 && ` · ${campaign.total} creativos`}
            {campaign.finals > 0 && ` · ${campaign.finals} finales`}
          </p>
        </div>
        <Button asChild disabled={gate.live}>
          <Link href={`/app/campaigns/${campaign.id}`}>
            {gate.live && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {gate.cta}
            {!gate.live && <ArrowRight className="size-4" aria-hidden />}
          </Link>
        </Button>
      </div>
      <div className="mt-5 max-w-md">
        <PipelineBar gate={gate} />
      </div>
    </section>
  );
}

// Usuario sin campañas: el hero es el arranque, no un tour. Los 3 pasos
// describen el wizard real (specs/v2/06 §4.2).
function FirstCampaignHero() {
  const steps = [
    { n: 1, title: "Sube tu producto", sub: "1 a 6 fotos bastan; el sistema detecta lo demás" },
    { n: 2, title: "Revisa el plan", sub: "Formatos, escenas y calendario propuestos" },
    { n: 3, title: "Aprueba la muestra", sub: "2-3 borradores antes de producir el lote" },
  ];
  return (
    <section className="rounded-2xl border border-border bg-card/50 p-5 sm:p-6">
      <p className="text-2xs font-medium uppercase tracking-wider text-primary">
        Tu primera campaña
      </p>
      <h2 className="mt-2 font-heading text-xl font-semibold tracking-tight">
        Del producto a los anuncios listos
      </h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-xs font-medium text-primary">
              {s.n}
            </span>
            <div>
              <p className="text-2sm font-medium text-foreground">{s.title}</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>
      <Button asChild className="mt-6">
        <Link href="/app/campaigns/new">
          <Sparkles className="size-4" aria-hidden />
          Empezar
        </Link>
      </Button>
    </section>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}
