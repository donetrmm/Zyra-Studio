import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mockeamos el módulo entero del SDK fal.ai
vi.mock('@fal-ai/client', () => {
  const queue = {
    submit: vi.fn(),
    status: vi.fn(),
    result: vi.fn(),
  };
  const config = vi.fn();
  return { fal: { config, queue }, queue };
});

describe('kling provider (via fal.ai)', () => {
  beforeEach(() => {
    vi.stubEnv('FAL_KEY', 'fake-fal-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('submitTask passes prompt/duration/aspect_ratio to fal.queue.submit', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.submit as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: 'req-123',
    });

    const { submitTask } = await import('./kling');
    const res = await submitTask({
      operation: 'text2video',
      model: 'fal-ai/kling-video/v3/standard/text-to-video',
      prompt: 'a cat',
      duration: 5,
      aspectRatio: '16:9',
    });

    expect(res.taskId).toBe('req-123');
    expect(fal.queue.submit).toHaveBeenCalledOnce();
    const [modelSlug, opts] = (fal.queue.submit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(modelSlug).toBe('fal-ai/kling-video/v3/standard/text-to-video');
    expect(opts.input).toMatchObject({
      prompt: 'a cat',
      duration: '5',
      aspect_ratio: '16:9',
    });
  });

  it('pollTask maps fal status COMPLETED → completed with videoUrl', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.status as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'COMPLETED' });
    (fal.queue.result as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { video: { url: 'https://v3.fal.media/a.mp4', content_type: 'video/mp4' } },
    });
    const { pollTask } = await import('./kling');
    const res = await pollTask(
      'fal-ai/kling-video/v3/standard/text-to-video',
      'req-123',
    );
    expect(res.status).toBe('completed');
    expect(res.videoUrl).toBe('https://v3.fal.media/a.mp4');
  });

  it('pollTask maps IN_PROGRESS → processing', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.status as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'IN_PROGRESS' });
    const { pollTask } = await import('./kling');
    const res = await pollTask(
      'fal-ai/kling-video/v3/standard/text-to-video',
      'req-123',
    );
    expect(res.status).toBe('processing');
    expect(res.videoUrl).toBeUndefined();
  });

  it('throws when FAL_KEY missing', async () => {
    vi.unstubAllEnvs();
    const { submitTask } = await import('./kling');
    await expect(
      submitTask({
        operation: 'text2video',
        model: 'fal-ai/kling-video/v3/standard/text-to-video',
        prompt: 'a cat',
        duration: 5,
        aspectRatio: '16:9',
      }),
    ).rejects.toThrow(/FAL_KEY/);
  });
});
