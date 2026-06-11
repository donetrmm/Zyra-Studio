import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowUpRight,
  Coins,
  FolderKanban,
  Layers,
  Sparkles,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LiveCreditValue } from "@/components/layout/LiveCreditValue";
import { requireWorkspace } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { publicThumbnailUrl } from "@/lib/supabase/storage";

export const metadata: Metadata = {
  title: "Inicio",
};

export default async function DashboardPage() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [balanceRes, campaignsRes, generationsRes] = await Promise.all([
    supabase
      .from("credit_balances")
      .select("balance, pending")
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("campaigns")
      .select("id, name, color, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(4),
    supabase
      .from("generations")
      .select("id, type, model_id, status, thumbnail_url, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const balance = balanceRes.data?.balance ?? 0;
  const pending = balanceRes.data?.pending ?? 0;
  const campaigns = campaignsRes.data ?? [];
  const generations = generationsRes.data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Bienvenido, {user.fullName ?? user.email.split("@")[0]}
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {workspace.name}
        </h1>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={<Coins className="size-4 text-primary" aria-hidden />}
          label="Créditos disponibles"
          value={<LiveCreditValue userId={user.id} initialBalance={balance} />}
          hint={pending > 0 ? `${fmt(pending)} reservados` : "Listos para usar"}
        />
        <MetricCard
          icon={<FolderKanban className="size-4 text-primary" aria-hidden />}
          label="Campañas"
          value={fmt(campaigns.length)}
          hint="En este workspace"
        />
        <MetricCard
          icon={<Layers className="size-4 text-primary" aria-hidden />}
          label="Generaciones recientes"
          value={fmt(generations.length)}
          hint="En las últimas semanas"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="font-heading text-lg">
                Campañas recientes
              </CardTitle>
              <CardDescription>
                Organiza tus generaciones por proyecto.
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link href="/app/campaigns">
                Ver todas
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <EmptyState
                title="Aún no tienes campañas"
                description="Agrupa tus proyectos creativos en una campaña."
                cta={
                  <Button asChild>
                    <Link href="/app/campaigns">Crear campaña</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {campaigns.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/app/campaigns/${c.id}`}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm transition-colors hover:border-primary/60"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block size-2 rounded-full"
                          style={{ background: c.color ?? "#009fff" }}
                          aria-hidden
                        />
                        {c.name}
                      </span>
                      <ArrowUpRight
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="font-heading text-lg">
                Generaciones recientes
              </CardTitle>
              <CardDescription>
                Tu último trabajo en imagen, video y voz.
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link href="/app/library">
                Ir a library
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {generations.length === 0 ? (
              <EmptyState
                title="Empieza a crear"
                description="Genera tu primera imagen, video o pista de audio."
                cta={
                  <div className="flex flex-wrap gap-2">
                    <Button asChild>
                      <Link href="/app/create/image">
                        <Sparkles className="size-4" aria-hidden /> Imagen
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/app/create/video">Video</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/app/create/audio">Audio</Link>
                    </Button>
                  </div>
                }
              />
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {generations.map((g) => {
                  const thumb = g.thumbnail_url ? publicThumbnailUrl(g.thumbnail_url) : null;
                  return (
                    <li
                      key={g.id}
                      className="aspect-square overflow-hidden rounded-md border border-border bg-muted"
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt={g.model_id ?? ''} className="size-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-muted-foreground">
                          {g.status === "done" ? g.type : g.status}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          {icon}
          {label}
        </div>
        <p className="font-heading text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="pt-2">{cta}</div>
    </div>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}
