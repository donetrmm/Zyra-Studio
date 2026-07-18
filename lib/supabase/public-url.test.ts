import { describe, it, expect, beforeAll } from 'vitest';
import { publicThumbnailUrlClient } from './public-url';

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
});

describe('publicThumbnailUrlClient', () => {
  it('construye la URL pública del bucket thumbnails', () => {
    expect(publicThumbnailUrlClient('ws/gen/thumb.jpg')).toBe(
      'https://proj.supabase.co/storage/v1/object/public/thumbnails/ws/gen/thumb.jpg',
    );
  });
});
