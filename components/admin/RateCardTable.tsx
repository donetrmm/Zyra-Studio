'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { updateRateCardRowAction } from '@/server-actions/rate-card';

export type RateCardRow = {
  id: string;
  asset_type: string;
  label: string;
  low_usd: number;
  mid_usd: number;
  high_usd: number;
  active: boolean;
};

export function RateCardTable({ rows: initial }: { rows: RateCardRow[] }) {
  const [rows, setRows] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);

  function patch(id: string, field: keyof RateCardRow, value: number | boolean) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function handleSave(row: RateCardRow) {
    setSaving(row.id);
    const res = await updateRateCardRowAction({
      id: row.id,
      lowUsd: Number(row.low_usd),
      midUsd: Number(row.mid_usd),
      highUsd: Number(row.high_usd),
      active: row.active,
    });
    setSaving(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo guardar (low ≤ mid ≤ high)');
      return;
    }
    toast.success(`${row.label} actualizado`);
  }

  return (
    <div className="scroll-thin overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[640px] text-left text-[12.5px]">
        <thead className="border-b border-border bg-muted/20 text-[11px] uppercase tracking-wide text-muted-foreground/60">
          <tr>
            <th className="px-3 py-2 font-medium">Tipo de activo</th>
            <th className="px-3 py-2 text-right font-medium">Low (USD)</th>
            <th className="px-3 py-2 text-right font-medium">Mid (USD)</th>
            <th className="px-3 py-2 text-right font-medium">High (USD)</th>
            <th className="px-3 py-2 font-medium">Activo</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={`border-b border-border/50 last:border-0 ${row.active ? '' : 'opacity-50'}`}>
              <td className="px-3 py-2">
                <p className="text-foreground/90">{row.label}</p>
                <p className="font-mono text-[10.5px] text-muted-foreground/50">{row.asset_type}</p>
              </td>
              {(['low_usd', 'mid_usd', 'high_usd'] as const).map((field) => (
                <td key={field} className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    value={row[field]}
                    onChange={(e) => patch(row.id, field, Number(e.target.value))}
                    className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-[12px] text-foreground outline-none focus:border-primary/40"
                  />
                </td>
              ))}
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={row.active}
                  onChange={(e) => patch(row.id, 'active', e.target.checked)}
                  className="accent-[#7c3aed]"
                />
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  disabled={saving !== null}
                  onClick={() => handleSave(row)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  {saving === row.id && <Loader2 className="size-3 animate-spin" aria-hidden />}
                  Guardar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
