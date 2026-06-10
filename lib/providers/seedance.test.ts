import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mockeamos el módulo entero del SDK fal.ai (mismo patrón que kling.test.ts).
// Regla del repo: los tests NUNCA llaman a la API real.
vi.mock('@fal-ai/client', () => {
  const queue = {
    submit: vi.fn(),
    status: vi.fn(),
    result: vi.fn(),
  };
  const config = vi.fn();
  return { fal: { config, queue }, queue };
});

describe('seedance provider (via fal.ai)', () => {
  beforeEach(() => {
    vi.stubEnv('FAL_KEY', 'fake-fal-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('submitTask t2v pasa prompt/resolution/duration/aspect_ratio/audio', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.submit as ReturnType<typeof vi.fn>).mockResolvedValue({ request_id: 'req-sd-1' });

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

    expect(res.taskId).toBe('req-sd-1');
    const [modelSlug, opts] = (fal.queue.submit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(modelSlug).toBe('bytedance/seedance-2.0/text-to-video');
    expect(opts.input).toMatchObject({
      prompt: 'a frosted glass bottle rotating on black marble',
      duration: '8',
      aspect_ratio: '9:16',
      resolution: '720p',
      generate_audio: true,
    });
  });

  it('submitTask sin duration manda "auto"', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.submit as ReturnType<typeof vi.fn>).mockResolvedValue({ request_id: 'req-sd-2' });
    const { submitTask } = await import('./seedance');
    await submitTask({
      operation: 'text2video',
      model: 'bytedance/seedance-2.0/fast/text-to-video',
      prompt: 'p',
    });
    const [, opts] = (fal.queue.submit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.input.duration).toBe('auto');
    expect(opts.input.aspect_ratio).toBe('auto');
  });

  it('submitTask reference2video pasa image_urls/video_urls/audio_urls', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.submit as ReturnType<typeof vi.fn>).mockResolvedValue({ request_id: 'req-sd-3' });
    const { submitTask } = await import('./seedance');
    await submitTask({
      operation: 'reference2video',
      model: 'bytedance/seedance-2.0/reference-to-video',
      prompt: '@Image1 as the product, exact packaging. Replicate the camera motion of @Video1.',
      imageUrls: ['https://x/p1.png', 'https://x/p2.png'],
      videoUrls: ['https://x/cam.mp4'],
      duration: 10,
    });
    const [, opts] = (fal.queue.submit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.input.image_urls).toEqual(['https://x/p1.png', 'https://x/p2.png']);
    expect(opts.input.video_urls).toEqual(['https://x/cam.mp4']);
    expect(opts.input.audio_urls).toBeUndefined();
  });

  it('submitTask rechaza más de 12 referencias en total', async () => {
    const { submitTask } = await import('./seedance');
    const tenImages = Array.from({ length: 9 }, (_, i) => `https://x/i${i}.png`);
    await expect(
      submitTask({
        operation: 'reference2video',
        model: 'bytedance/seedance-2.0/reference-to-video',
        prompt: 'p',
        imageUrls: tenImages,
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

  it('pollTask COMPLETED → completed con videoUrl y seed', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.status as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'COMPLETED' });
    (fal.queue.result as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { video: { url: 'https://v3.fal.media/sd.mp4', content_type: 'video/mp4' }, seed: 42 },
    });
    const { pollTask } = await import('./seedance');
    const res = await pollTask('bytedance/seedance-2.0/text-to-video', 'req-sd-1');
    expect(res.status).toBe('completed');
    expect(res.videoUrl).toBe('https://v3.fal.media/sd.mp4');
    expect(res.seed).toBe(42);
  });

  it('pollTask IN_QUEUE → processing', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.status as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'IN_QUEUE' });
    const { pollTask } = await import('./seedance');
    const res = await pollTask('bytedance/seedance-2.0/text-to-video', 'req-sd-1');
    expect(res.status).toBe('processing');
  });

  it('lanza ProviderError auth cuando FAL_KEY falta', async () => {
    vi.unstubAllEnvs();
    const { submitTask } = await import('./seedance');
    await expect(
      submitTask({
        operation: 'text2video',
        model: 'bytedance/seedance-2.0/text-to-video',
        prompt: 'p',
      }),
    ).rejects.toThrow(/FAL_KEY/);
  });
});
