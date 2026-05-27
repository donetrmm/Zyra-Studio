import type { Metadata } from "next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Precios",
};

type PricingRow = {
  id: string;
  provider: string;
  model_id: string;
  variant: string;
  credits_cost: number;
  unit_size: number | null;
  unit_label: string | null;
  is_active: boolean;
};

export default async function AdminPricingPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("model_pricing")
    .select(
      "id, provider, model_id, variant, credits_cost, unit_size, unit_label, is_active",
    )
    .order("provider")
    .order("model_id")
    .order("variant");

  const rows = (data ?? []) as PricingRow[];

  // Group by provider
  const grouped = new Map<string, PricingRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.provider) ?? [];
    existing.push(row);
    grouped.set(row.provider, existing);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-[22px] font-semibold tracking-tight">
          Precios
        </h1>
        <p className="text-[13px] text-muted-foreground">
          Configuración de costos por modelo. Solo lectura.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Sin precios configurados.
        </p>
      ) : (
        Array.from(grouped.entries()).map(([provider, items]) => (
          <section key={provider} className="space-y-2">
            <h2 className="font-heading text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {provider}
            </h2>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model ID</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead>Unit Size</TableHead>
                    <TableHead>Unit Label</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow
                      key={r.id}
                      className={r.is_active ? "" : "opacity-50"}
                    >
                      <TableCell className="text-xs font-medium">
                        {r.model_id}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.variant}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {new Intl.NumberFormat("es-MX").format(r.credits_cost)}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs text-muted-foreground">
                        {r.unit_size ?? "--"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.unit_label ?? "--"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
