import { describe, it, expect } from 'vitest';
import { GeneratePlanSchema } from '@/lib/schemas/campaigns';
import { MASTER_PROMPT_MAX } from '@/lib/schemas/ingest';

describe('GeneratePlanSchema.userIdeas — tope subido', () => {
  it('acepta ideas de más de 24000 chars (hasta el cap del prompt maestro)', () => {
    const parsed = GeneratePlanSchema.safeParse({
      campaignId: '00000000-0000-0000-0000-000000000000',
      userIdeas: 'x'.repeat(MASTER_PROMPT_MAX - 1),
    });
    expect(parsed.success).toBe(true);
  });
});
