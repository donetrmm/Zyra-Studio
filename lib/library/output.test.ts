import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOutputUrl } from './output';

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchOutputUrl', () => {
  it('devuelve outputUrl cuando la API responde ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ outputUrl: 'https://x.supabase.co/o.png' }), { status: 200 })));
    expect(await fetchOutputUrl('gen-1')).toBe('https://x.supabase.co/o.png');
    expect(fetch).toHaveBeenCalledWith('/api/generations/gen-1', { cache: 'no-store' });
  });
  it('devuelve null si la respuesta no es ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    expect(await fetchOutputUrl('gen-2')).toBeNull();
  });
  it('devuelve null si no hay outputUrl', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    expect(await fetchOutputUrl('gen-3')).toBeNull();
  });
});
