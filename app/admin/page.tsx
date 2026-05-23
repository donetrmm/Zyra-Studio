import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Dashboard",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function AdminDashboard() {
  // Usamos service_role para que las métricas globales bypassen RLS.
  const supabase = createAdminClient();
  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();

  const [
    profilesAgg,
    active7,
    active30,
    txAgg,
    topConsumers,
    failedAgg,
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("generations")
      .select("user_id", { count: "exact", head: true })
      .gte("created_at", since7),
    supabase
      .from("generations")
      .select("user_id", { count: "exact", head: true })
      .gte("created_at", since30),
    supabase
      .from("credit_transactions")
      .select("delta, reason"),
    supabase
      .from("credit_transactions")
      .select("user_id, delta")
      .lt("delta", 0)
      .gte("created_at", since30),
    supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", since7),
  ]);

  const totalUsers = profilesAgg.count ?? 0;
  const active7d = active7.count ?? 0;
  const active30d = active30.count ?? 0;
  const failed7d = failedAgg.count ?? 0;

  const txRows = (txAgg.data ?? []) as Array<{ delta: number; reason: string }>;
  const granted = txRows
    .filter((t) => t.delta > 0)
    .reduce((acc, t) => acc + t.delta, 0);
  const consumed = txRows
    .filter((t) => t.delta < 0)
    .reduce((acc, t) => acc + Math.abs(t.delta), 0);

  const consumerMap = new Map<string, number>();
  for (const row of (topConsumers.data ?? []) as Array<{
    user_id: string;
    delta: number;
  }>) {
    consumerMap.set(
      row.user_id,
      (consumerMap.get(row.user_id) ?? 0) + Math.abs(row.delta),
    );
  }
  const topIds = [...consumerMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  let topProfiles: Array<{ id: string; email: string }> = [];
  if (topIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, email")
      .in(
        "id",
        topIds.map(([id]) => id),
      );
    topProfiles = data ?? [];
  }
  const profileById = new Map(topProfiles.map((p) => [p.id, p.email]));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <header>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Métricas globales del studio.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Usuarios totales" value={fmt(totalUsers)} />
        <MetricCard label="Activos · 7d" value={fmt(active7d)} />
        <MetricCard label="Activos · 30d" value={fmt(active30d)} />
        <MetricCard
          label="Errores · 7d"
          value={fmt(failed7d)}
          tone={failed7d > 0 ? "warning" : "neutral"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">
              Créditos otorgados vs consumidos
            </CardTitle>
            <CardDescription>Total histórico</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Otorgados
              </p>
              <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">
                {fmt(granted)}
              </p>
            </div>
            <div className="rounded-md border border-border p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Consumidos
              </p>
              <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">
                {fmt(consumed)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">
              Top 10 por consumo · 30d
            </CardTitle>
            <CardDescription>Suma de cargos de generación</CardDescription>
          </CardHeader>
          <CardContent>
            {topIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin actividad de consumo aún.
              </p>
            ) : (
              <ol className="space-y-2">
                {topIds.map(([id, amount], idx) => (
                  <li
                    key={id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-3">
                      <span className="w-4 text-xs text-muted-foreground tabular-nums">
                        {idx + 1}
                      </span>
                      <span className="truncate">
                        {profileById.get(id) ?? id.slice(0, 8)}
                      </span>
                    </span>
                    <span className="tabular-nums">{fmt(amount)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          className={`mt-1 font-heading text-3xl font-semibold tabular-nums ${
            tone === "warning" ? "text-destructive" : ""
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}
