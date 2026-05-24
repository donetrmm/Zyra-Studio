export type ModelKey = 'auto' | 'nano-pro' | 'nano-flash' | 'flux';

export type SessionItem = {
  id: string;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  prompt: string;
  model: string;
  variant: string;
  credits: number;
  createdAt: number;
};

import type { ImageRouterReason } from '@/lib/router/model-selector';

export type Selection = {
  provider: 'nano-banana' | 'flux';
  model: string;
  variant: string;
  // Solo presente cuando viene del router auto; manual selection no la usa.
  reason?: ImageRouterReason;
};
