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

const API_COSTS_USD: Record<string, number> = {
  "nano-banana|gemini-3-pro-image-preview|1k": 0.134,
  "nano-banana|gemini-3-pro-image-preview|2k": 0.134,
  "nano-banana|gemini-3-pro-image-preview|4k": 0.24,
  "nano-banana|gemini-3.1-flash-image-preview|1k": 0.045,
  "nano-banana|gemini-3.1-flash-image-preview|2k": 0.067,
  "flux|flux-2-pro-preview|default": 0.03,
  "kling|fal-ai/kling-video/v3/standard/text-to-video|per_second": 0.126,
  "kling|fal-ai/kling-video/v3/standard/image-to-video|per_second": 0.126,
  "kling|fal-ai/kling-video/v3/pro/text-to-video|per_second": 0.168,
  "veo|veo-3.1-lite-generate-preview|1080p": 0.08,
  "veo|veo-3.1-fast-generate-preview|1080p": 0.12,
  "veo|veo-3.1-generate-preview|1080p": 0.40,
  "elevenlabs|eleven_flash_v2_5|default": 0.05,
  "elevenlabs|eleven_multilingual_v2|default": 0.10,
  "elevenlabs|eleven_v3|default": 0.10,
  "internal|prompt-enhance|default": 0.001,
};

function getApiCost(r: PricingRow): number | null {
  const key = `${r.provider}|${r.model_id}|${r.variant}`;
  return API_COSTS_USD[key] ?? null;
}

function getMargin(r: PricingRow): string | null {
  const cost = getApiCost(r);
  if (!cost || cost === 0) return null;
  const creditValueUsd = 0.005;
  const revenue = r.credits_cost * creditValueUsd;
  return `${(revenue / cost).toFixed(1)}x`;
}

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
          Costos por modelo. Costo API en USD, créditos cobrados al usuario, y margen resultante.
        </p>
        <p className="text-[11px] text-muted-foreground/60">
          1 crédito ≈ $0.005 USD · Margen objetivo: 3x
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
            <div className="scroll-thin overflow-x-auto rounded-md border border-border">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Variante</TableHead>
                    <TableHead className="text-right">Costo API (USD)</TableHead>
                    <TableHead className="text-right">Créditos</TableHead>
                    <TableHead className="text-right">Ingreso (USD)</TableHead>
                    <TableHead className="text-right">Margen</TableHead>
                    <TableHead>Unidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => {
                    const apiCost = getApiCost(r);
                    const margin = getMargin(r);
                    const revenue = r.credits_cost * 0.005;
                    return (
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
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {apiCost !== null ? `$${apiCost.toFixed(3)}` : "--"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {new Intl.NumberFormat("es-MX").format(r.credits_cost)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          ${revenue.toFixed(3)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {margin ? (
                            <span className={parseFloat(margin) >= 2.5 ? "text-emerald-400" : "text-amber-400"}>
                              {margin}
                            </span>
                          ) : "--"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.unit_label ? `${r.unit_size ?? 1} ${r.unit_label}` : "por uso"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
