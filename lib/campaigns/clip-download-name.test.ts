import { describe, it, expect } from 'vitest';
import { clipDownloadName } from './clip-download-name';

describe('clipDownloadName', () => {
  it('clip de secuencia: número 1-based zero-padded + sufijo corto del id', () => {
    expect(
      clipDownloadName({ sequenceId: 'seq-1', sceneIndex: 0, generationId: 'abcdef12-3456' }),
    ).toBe('clip-01-abcdef');
  });

  it('padding a dos dígitos para que ordene bien en el explorador', () => {
    expect(
      clipDownloadName({ sequenceId: 'seq-1', sceneIndex: 10, generationId: 'abcdef12-3456' }),
    ).toBe('clip-11-abcdef');
  });

  it('creativo suelto (sin secuencia): conserva el nombre por id', () => {
    expect(
      clipDownloadName({ sequenceId: null, sceneIndex: null, generationId: 'abcdef12-3456' }),
    ).toBe('1to1-abcdef12');
  });

  it('sceneIndex sin secuencia no cuenta como número de clip', () => {
    expect(
      clipDownloadName({ sequenceId: null, sceneIndex: 2, generationId: 'abcdef12-3456' }),
    ).toBe('1to1-abcdef12');
  });
});
