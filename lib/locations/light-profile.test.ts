import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/lib/providers/types';

const gatewayTextMock = vi.fn();
vi.mock('@/lib/providers/gateway', () => ({ gatewayText: gatewayTextMock }));

const { deriveLightProfileFromImage } = await import('./light-profile');

describe('deriveLightProfileFromImage', () => {
  afterEach(() => gatewayTextMock.mockReset());

  it('manda la imagen como inline_data y devuelve el perfil de luz limpio', async () => {
    gatewayTextMock.mockResolvedValue({
      text: JSON.stringify({ profile: '  luz de ventana lateral, suelo de madera clara  ' }),
      finishReason: 'stop',
    });
    const result = await deriveLightProfileFromImage({
      imageBuffer: Buffer.from('img'), mimeType: 'image/png',
    });
    expect(result).toBe('luz de ventana lateral, suelo de madera clara');
    const { contents } = gatewayTextMock.mock.calls[0][0];
    expect(contents[0].parts[0]).toEqual({
      inline_data: { mime_type: 'image/png', data: Buffer.from('img').toString('base64') },
    });
  });

  it('propaga ProviderError del transporte', async () => {
    gatewayTextMock.mockRejectedValue(new ProviderError('Rate limit Gemini', 'rate_limit', true));
    await expect(
      deriveLightProfileFromImage({ imageBuffer: Buffer.from('x'), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'rate_limit' });
  });
});
