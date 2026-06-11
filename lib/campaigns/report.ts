// Reporte de valor (specs/v2/05 tarea 4) — la parte PURA, testeable sin DB.
// Materializa el argumento de la presentación: costo y tiempo reales de la
// campaña vs producción tradicional (rate card propia, editable en admin).

// Misma equivalencia que muestra /admin/pricing (1 crédito ≈ $0.005 USD).
export const CREDIT_USD_RATE = 0.005;

export type RateRow = {
  asset_type: string;
  label: string;
  low_usd: number;
  mid_usd: number;
  high_usd: number;
};

export type ReportLine = {
  assetType: string;
  label: string;
  count: number;
  low: number;
  mid: number;
  high: number;
};

export type ValueReport = {
  lines: ReportLine[];
  totalFinals: number;
  traditional: { low: number; mid: number; high: number };
  creditsCharged: number;
  spentUsd: number;
  savingsPctMid: number; // % vs el escenario mid, cap 99.99
  renderHours: number;
  traditionalWeeks: number;
};

// Heurística propia de tiempo tradicional: 1 semana de setup (brief, casting,
// locaciones) + media semana por activo con producción solapada.
export function traditionalWeeksFor(totalAssets: number): number {
  if (totalAssets === 0) return 0;
  return Math.ceil(1 + totalAssets * 0.5);
}

export function buildValueReport(input: {
  // conteo de finales por asset_type (slug del formato)
  finalsByType: Map<string, number>;
  rateCard: RateRow[];
  creditsCharged: number;
  renderMs: number;
}): ValueReport {
  const rates = new Map(input.rateCard.map((r) => [r.asset_type, r]));
  const lines: ReportLine[] = [];
  let low = 0;
  let mid = 0;
  let high = 0;
  let totalFinals = 0;

  for (const [assetType, count] of input.finalsByType) {
    if (count <= 0) continue;
    totalFinals += count;
    const rate = rates.get(assetType);
    if (!rate) continue; // formato custom sin tarifa: cuenta para tiempo, no para USD
    const line: ReportLine = {
      assetType,
      label: rate.label,
      count,
      low: count * Number(rate.low_usd),
      mid: count * Number(rate.mid_usd),
      high: count * Number(rate.high_usd),
    };
    lines.push(line);
    low += line.low;
    mid += line.mid;
    high += line.high;
  }

  const spentUsd = input.creditsCharged * CREDIT_USD_RATE;
  const savingsPctMid =
    mid > 0 ? Math.min(99.99, Math.max(0, (1 - spentUsd / mid) * 100)) : 0;

  return {
    lines,
    totalFinals,
    traditional: { low, mid, high },
    creditsCharged: input.creditsCharged,
    spentUsd,
    savingsPctMid,
    renderHours: input.renderMs / 3_600_000,
    traditionalWeeks: traditionalWeeksFor(totalFinals),
  };
}

// ============ Export CSV ============

export type CsvRow = {
  date: string;
  format: string;
  scene: string;
  durationS: number | null;
  aspectRatio: string;
  status: string;
  caption: string;
  fileUrl: string;
};

function csvCell(value: string | number | null): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const BOM = '﻿';

// CSV con BOM (Excel/Sheets en UTF-8) y CRLF. Las URLs firmadas expiran:
// el archivo es para publicar/descargar hoy, no para archivar.
export function buildCampaignCsv(rows: CsvRow[]): string {
  const header = ['Fecha', 'Formato', 'Escena', 'Duracion (s)', 'Ratio', 'Estado', 'Caption', 'Archivo'];
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        csvCell(r.date),
        csvCell(r.format),
        csvCell(r.scene),
        csvCell(r.durationS),
        csvCell(r.aspectRatio),
        csvCell(r.status),
        csvCell(r.caption),
        csvCell(r.fileUrl),
      ].join(','),
    ),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
