import { describe, it, expect } from 'vitest';
import { hasSpatialBlocking } from './spatial';

describe('hasSpatialBlocking', () => {
  it('detecta posición + orientación', () => {
    expect(hasSpatialBlocking('Marco on the left facing camera-right, Ana on the right')).toBe(true);
  });
  it('detecta foreground/background y behind', () => {
    expect(hasSpatialBlocking('the product in the foreground, the model behind it')).toBe(true);
  });
  it('detecta "between" y "next to"', () => {
    expect(hasSpatialBlocking('she stands between the two doors, next to the window')).toBe(true);
  });
  it('false cuando no hay marcadores espaciales', () => {
    expect(hasSpatialBlocking('Marco and Ana talk excitedly in the kitchen')).toBe(false);
  });
  it('false con texto vacío', () => {
    expect(hasSpatialBlocking('')).toBe(false);
  });
});
