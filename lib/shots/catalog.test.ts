import { describe, expect, it } from 'vitest';
import { SHOTS, shotBySlug } from './catalog';

const SYSTEM_FORMAT_SLUGS = [
  'voz-cercana', 'a-pie-de-calle', 'manos-a-la-obra', 'el-descubrimiento',
  'antes-y-despues', 'susurro', 'el-icono', 'gran-pantalla', 'mundo-imposible',
];

describe('catálogo de tomas', () => {
  it('tiene slugs únicos en kebab-case', () => {
    const slugs = SHOTS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('cada toma referencia solo formatos del sistema', () => {
    for (const shot of SHOTS) {
      for (const f of shot.formats) expect(SYSTEM_FORMAT_SLUGS).toContain(f);
    }
  });

  it('la imagen sigue la convención /shots/<slug>.jpg', () => {
    for (const shot of SHOTS) expect(shot.image).toBe(`/shots/${shot.slug}.jpg`);
  });

  it('shotBySlug resuelve y devuelve undefined para desconocidos', () => {
    expect(shotBySlug('close-up')?.name).toBeTruthy();
    expect(shotBySlug('no-existe')).toBeUndefined();
  });
});
