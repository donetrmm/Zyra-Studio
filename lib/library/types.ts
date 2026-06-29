export type LibraryGeneration = {
  id: string;
  type: string;
  provider: string;
  model: string;
  prompt: string;
  status: string;
  thumbnailUrl: string | null;
  hasOutput: boolean;
  credits: number;
  createdAt: string;
  parentGenerationId: string | null;
  batchId: string | null;
  batchKind: string | null;
  campaignId: string | null;
  aspectRatio: string | null;
};

export type Tab = 'sessions' | 'grid' | 'collections';
export type SortKey = 'recent' | 'old';

export type Session = {
  id: string;
  items: LibraryGeneration[];
  head: LibraryGeneration;
  latest: LibraryGeneration;
};
