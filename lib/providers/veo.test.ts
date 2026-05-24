import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('veo.submitOperation', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'fake-gemini-key');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('sends correct REST payload and returns operationName', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ name: 'operations/abc-123' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const { submitOperation } = await import('./veo');
    const res = await submitOperation({
      model: 'veo-3.1-fast-generate-preview',
      prompt: 'a lion',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSeconds: 8,
    });
    expect(res.operationName).toBe('operations/abc-123');
  });

  it('throws auth on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('no', { status: 401 }));
    const { submitOperation } = await import('./veo');
    await expect(
      submitOperation({
        model: 'veo-3.1-fast-generate-preview',
        prompt: 'x',
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: 8,
      }),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('injects personGeneration=allow_adult', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: 'operations/abc-123' }), { status: 200 }),
    );
    global.fetch = fetchSpy;
    const { submitOperation } = await import('./veo');
    await submitOperation({
      model: 'veo-3.1-fast-generate-preview',
      prompt: 'a lion',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSeconds: 8,
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.parameters?.personGeneration).toBe('allow_adult');
  });
});
