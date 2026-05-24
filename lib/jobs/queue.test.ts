import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('enqueueJob env guards', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when QSTASH_TOKEN is missing', async () => {
    vi.stubEnv('QSTASH_TOKEN', '');
    vi.stubEnv('PUBLIC_URL', 'https://example.com');
    const { enqueueJob } = await import('./queue');
    await expect(
      enqueueJob({ generationId: 'gen-1', action: 'submit' }),
    ).rejects.toThrow(/QSTASH_TOKEN/);
  });

  it('throws when PUBLIC_URL is missing', async () => {
    vi.stubEnv('QSTASH_TOKEN', 'fake-token');
    vi.stubEnv('PUBLIC_URL', '');
    const { enqueueJob } = await import('./queue');
    await expect(
      enqueueJob({ generationId: 'gen-1', action: 'submit' }),
    ).rejects.toThrow(/PUBLIC_URL/);
  });
});
