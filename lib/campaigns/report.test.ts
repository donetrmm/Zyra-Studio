import { describe, it, expect } from 'vitest';
import {
  buildCampaignCsv,
  buildValueReport,
  traditionalWeeksFor,
  CREDIT_USD_RATE,
  type RateRow,
} from './report';

const RATE_CARD: RateRow[] = [
  { asset_type: 'voz-cercana', label: 'Testimonio de creador (UGC)', low_usd: 300, mid_usd: 800, high_usd: 1600 },
  { asset_type: 'el-icono', label: 'Héroe de producto (CGI)', low_usd: 2500, mid_usd: 8000, high_usd: 14000 },
];

describe('buildValueReport', () => {
  it('calcula tradicional por línea y ahorro vs mid', () => {
    const report = buildValueReport({
      finalsByType: new Map([
        ['voz-cercana', 3],
        ['el-icono', 1],
      ]),
      rateCard: RATE_CARD,
      creditsCharged: 4000,
      renderMs: 2 * 3_600_000,
    });
    expect(report.totalFinals).toBe(4);
    expect(report.traditional.low).toBe(3 * 300 + 2500);
    expect(report.traditional.mid).toBe(3 * 800 + 8000);
    expect(report.traditional.high).toBe(3 * 1600 + 14000);
    expect(report.spentUsd).toBeCloseTo(4000 * CREDIT_USD_RATE);
    // ahorro = 1 - 20/10400
    expect(report.savingsPctMid).toBeGreaterThan(99);
    expect(report.savingsPctMid).toBeLessThanOrEqual(99.99);
    expect(report.renderHours).toBe(2);
    expect(report.traditionalWeeks).toBe(traditionalWeeksFor(4));
  });

  it('formato sin tarifa cuenta para el total pero no para USD', () => {
    const report = buildValueReport({
      finalsByType: new Map([['formato-custom', 2]]),
      rateCard: RATE_CARD,
      creditsCharged: 100,
      renderMs: 0,
    });
    expect(report.totalFinals).toBe(2);
    expect(report.lines).toHaveLength(0);
    expect(report.traditional.mid).toBe(0);
    expect(report.savingsPctMid).toBe(0); // sin base de comparación
  });

  it('sin finales devuelve reporte vacío sin dividir por cero', () => {
    const report = buildValueReport({
      finalsByType: new Map(),
      rateCard: RATE_CARD,
      creditsCharged: 0,
      renderMs: 0,
    });
    expect(report.totalFinals).toBe(0);
    expect(report.traditionalWeeks).toBe(0);
    expect(report.savingsPctMid).toBe(0);
  });
});

describe('buildCampaignCsv', () => {
  it('escapa comas, comillas y saltos de línea', () => {
    const csv = buildCampaignCsv([
      {
        date: '2026-07-01',
        format: 'Voz Cercana',
        scene: 'a sunlit kitchen, warm light',
        durationS: 9,
        aspectRatio: '9:16',
        status: 'final_ready',
        caption: 'Dice "wow"\ny sonríe',
        fileUrl: 'https://x/video.mp4',
      },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Fecha,Formato');
    expect(lines[1]).toContain('"a sunlit kitchen, warm light"');
    expect(lines[1]).toContain('"Dice ""wow""\ny sonríe"'.split('\n')[0]); // comillas dobladas
    expect(csv.startsWith('﻿')).toBe(true); // BOM para Excel
  });

  it('celdas vacías quedan vacías, no "null"', () => {
    const csv = buildCampaignCsv([
      {
        date: '',
        format: 'El Ícono',
        scene: '',
        durationS: null,
        aspectRatio: '9:16',
        status: 'planned',
        caption: '',
        fileUrl: '',
      },
    ]);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
  });
});
