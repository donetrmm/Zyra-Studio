import { describe, it, expect } from 'vitest';
import { buildFrameArgs, buildAudioArgs } from './video-frame';

describe('buildFrameArgs', () => {
  it('miniatura: escala a 512 y comprime', () => {
    const args = buildFrameArgs('in.mp4', 'out.jpg', { atSeconds: 0, thumbnail: true });
    expect(args).toEqual([
      '-loglevel', 'error',
      '-i', 'in.mp4',
      '-ss', '0',
      '-frames:v', '1',
      '-vf', 'scale=512:-1',
      '-q:v', '4',
      'out.jpg',
    ]);
  });

  it('calidad completa: sin scale ni q:v bajo, q:v alto', () => {
    const args = buildFrameArgs('in.mp4', 'out.jpg', { atSeconds: 0, thumbnail: false });
    expect(args).toEqual([
      '-loglevel', 'error',
      '-i', 'in.mp4',
      '-ss', '0',
      '-frames:v', '1',
      '-q:v', '2',
      'out.jpg',
    ]);
  });
});

describe('buildAudioArgs', () => {
  it('extrae solo el audio como AAC 128k (sin flags de video)', () => {
    expect(buildAudioArgs('in.mp4', 'out.m4a')).toEqual([
      '-loglevel', 'error',
      '-i', 'in.mp4',
      '-vn',
      '-acodec', 'aac',
      '-b:a', '128k',
      'out.m4a',
    ]);
  });
});
