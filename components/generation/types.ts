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

export type Selection = {
  provider: 'nano-banana' | 'flux';
  model: string;
  variant: string;
};
