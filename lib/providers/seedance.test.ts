import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Seedance 2.0 vía ModelArk (REST). Mockeamos fetch global.
// Regla del repo: los tests NUNCA llaman a la API real.

function mockJson(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}

const fetchMock = vi.fn();

describe('seedance provider (vía ModelArk)', () => {
  beforeEach(() => {
    vi.stubEnv('ARK_API_KEY', 'fake-ark-key');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function lastBody(): Record<string, unknown> {
    const [, opts] = fetchMock.mock.calls[0];
    return JSON.parse(opts.body as string);
  }

  it('submitTask t2v manda model standard, content texto, ratio/resolution/duration/audio', async () => {
    fetchMock.mockResolvedValue(mockJson(200, { id: 'cgt-sd-1' }));

    const { submitTask } = await import('./seedance');
    const res = await submitTask({
      operation: 'text2video',
      model: 'bytedance/seedance-2.0/text-to-video',
      prompt: 'a frosted glass bottle rotating on black marble',
      duration: 8,
      aspectRatio: '9:16',
      resolution: '720p',
      generateAudio: true,
    });

    expect(res.taskId).toBe('cgt-sd-1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/contents/generations/tasks');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer fake-ark-key');
    const body = lastBody();
    expect(body.model).toBe('dreamina-seedance-2-0-260128');
    expect(body.resolution).toBe('720p');
    expect(body.ratio).toBe('9:16');
    expect(body.duration).toBe(8);
    expect(body.generate_audio).toBe(true);
    expect(body.watermark).toBe(false);
    expect(body.content).toEqual([{ type: 'text', text: 'a frosted glass bottle rotating on black marble' }]);
  });

  it('submitTask tier fast usa el model id fast', async () => {
    fetchMock.mockResolvedValue(mockJson(200, { id: 'cgt-sd-2' }));
    const { submitTask } = await import('./seedance');
    await submitTask({
      operation: 'text2video',
      model: 'bytedance/seedance-2.0/fast/text-to-video',
      prompt: 'p',
    });
    expect(lastBody().model).toBe('dreamina-seedance-2-0-fast-260128');
  });

  it('submitTask sin duration la omite y mapea aspect auto → adaptive', async () => {
    fetchMock.mockResolvedValue(mockJson(200, { id: 'cgt-sd-3' }));
    const { submitTask } = await import('./seedance');
    await submitTask({
      operation: 'text2video',
      model: 'bytedance/seedance-2.0/fast/text-to-video',
      prompt: 'p',
      aspectRatio: 'auto',
    });
    const body = lastBody();
    expect(body.duration).toBeUndefined();
    expect(body.ratio).toBe('adaptive');
  });

  it('submitTask image2video mapea first_frame y last_frame', async () => {
    fetchMock.mockResolvedValue(mockJson(200, { id: 'cgt-sd-4' }));
    const { submitTask } = await import('./seedance');
    await submitTask({
      operation: 'image2video',
      model: 'bytedance/seedance-2.0/image-to-video',
      prompt: 'p',
      imageUrl: 'https://x/start.png',
      endImageUrl: 'https://x/end.png',
    });
    expect(lastBody().content).toEqual([
      { type: 'text', text: 'p' },
      { type: 'image_url', image_url: { url: 'https://x/start.png' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'https://x/end.png' }, role: 'last_frame' },
    ]);
  });

  it('submitTask reference2video manda roles reference_* en orden', async () => {
    fetchMock.mockResolvedValue(mockJson(200, { id: 'cgt-sd-5' }));
    const { submitTask } = await import('./seedance');
    await submitTask({
      operation: 'reference2video',
      model: 'bytedance/seedance-2.0/reference-to-video',
      prompt: '@Image1 as the product. Replicate the camera motion of @Video1.',
      imageUrls: ['https://x/p1.png', 'https://x/p2.png'],
      videoUrls: ['https://x/cam.mp4'],
      duration: 10,
    });
    expect(lastBody().content).toEqual([
      { type: 'text', text: '@Image1 as the product. Replicate the camera motion of @Video1.' },
      { type: 'image_url', image_url: { url: 'https://x/p1.png' }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: 'https://x/p2.png' }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: 'https://x/cam.mp4' }, role: 'reference_video' },
    ]);
  });

  it('submitTask rechaza más de 12 referencias en total', async () => {
    const { submitTask } = await import('./seedance');
    const nineImages = Array.from({ length: 9 }, (_, i) => `https://x/i${i}.png`);
    await expect(
      submitTask({
        operation: 'reference2video',
        model: 'bytedance/seedance-2.0/reference-to-video',
        prompt: 'p',
        imageUrls: nineImages,
        videoUrls: ['https://x/v1.mp4', 'https://x/v2.mp4', 'https://x/v3.mp4'],
        audioUrls: ['https://x/a1.mp3'],
      }),
    ).rejects.toThrow(/12 archivos/);
  });

  it('submitTask rechaza 1080p en tier fast', async () => {
    const { submitTask } = await import('./seedance');
    await expect(
      submitTask({
        operation: 'text2video',
        model: 'bytedance/seedance-2.0/fast/text-to-video',
        prompt: 'p',
        resolution: '1080p',
      }),
    ).rejects.toThrow(/fast no soporta 1080p/);
  });

  it('submitTask rechaza duration fuera de 4-15', async () => {
    const { submitTask } = await import('./seedance');
    await expect(
      submitTask({
        operation: 'text2video',
        model: 'bytedance/seedance-2.0/text-to-video',
        prompt: 'p',
        duration: 20,
      }),
    ).rejects.toThrow(/entre 4 y 15/);
  });

  it('submitTask image2video exige imageUrl', async () => {
    const { submitTask } = await import('./seedance');
    await expect(
      submitTask({
        operation: 'image2video',
        model: 'bytedance/seedance-2.0/image-to-video',
        prompt: 'p',
      }),
    ).rejects.toThrow(/requiere imageUrl/);
  });

  it('submitTask con 401 lanza ProviderError auth', async () => {
    fetchMock.mockResolvedValue(mockJson(401, { error: { message: 'invalid key' } }));
    const { submitTask } = await import('./seedance');
    await expect(
      submitTask({
        operation: 'text2video',
        model: 'bytedance/seedance-2.0/text-to-video',
        prompt: 'p',
      }),
    ).rejects.toThrow(/invalid key/);
  });

  it('pollTask succeeded → completed con videoUrl y seed', async () => {
    fetchMock.mockResolvedValue(
      mockJson(200, {
        status: 'succeeded',
        content: { video_url: 'https://ark.example/sd.mp4' },
        seed: 42,
      }),
    );
    const { pollTask } = await import('./seedance');
    const res = await pollTask('cgt-sd-1');
    expect(res.status).toBe('completed');
    expect(res.videoUrl).toBe('https://ark.example/sd.mp4');
    expect(res.seed).toBe(42);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/contents/generations/tasks/cgt-sd-1');
    expect(opts.method).toBe('GET');
  });

  it('pollTask queued/running → processing', async () => {
    fetchMock.mockResolvedValue(mockJson(200, { status: 'running' }));
    const { pollTask } = await import('./seedance');
    expect((await pollTask('cgt-sd-1')).status).toBe('processing');
  });

  it('pollTask failed → failed con mensaje', async () => {
    fetchMock.mockResolvedValue(mockJson(200, { status: 'failed', error: { message: 'content rejected' } }));
    const { pollTask } = await import('./seedance');
    const res = await pollTask('cgt-sd-1');
    expect(res.status).toBe('failed');
    expect(res.error).toBe('content rejected');
  });

  it('pollTask 429 → processing (reintenta en el próximo tick)', async () => {
    fetchMock.mockResolvedValue(mockJson(429, {}));
    const { pollTask } = await import('./seedance');
    expect((await pollTask('cgt-sd-1')).status).toBe('processing');
  });

  it('lanza ProviderError auth cuando ARK_API_KEY falta', async () => {
    vi.unstubAllEnvs();
    const { submitTask } = await import('./seedance');
    await expect(
      submitTask({
        operation: 'text2video',
        model: 'bytedance/seedance-2.0/text-to-video',
        prompt: 'p',
      }),
    ).rejects.toThrow(/ARK_API_KEY/);
  });
});
