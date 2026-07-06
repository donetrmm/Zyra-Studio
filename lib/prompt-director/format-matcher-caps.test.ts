import { describe, it, expect } from 'vitest';
import { GeneratePlanSchema } from '@/lib/schemas/campaigns';

describe('GeneratePlanSchema.userIdeas — tope subido', () => {
  it('acepta ideas de más de 6000 chars (hasta 24000)', () => {
    const parsed = GeneratePlanSchema.safeParse({
      campaignId: '00000000-0000-0000-0000-000000000000',
      userIdeas: 'x'.repeat(9000),
    });
    expect(parsed.success).toBe(true);
  });
});
