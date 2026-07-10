import type { PricingRow } from '@/lib/credits/types';

// Un turno del chat = una fila generations de la sesión. La galería muestra los
// que tienen thumbnail; el chat los muestra todos. thumbPath es el path CRUDO en
// el bucket público 'thumbnails' (el cliente arma la URL con
// publicThumbnailUrlClient) — nunca una URL de proveedor.
export type StudioTurn = {
  id: string;
  prompt: string | null;
  status: 'queued' | 'processing' | 'done' | 'failed' | 'canceled';
  provider: string;
  modelId: string;
  thumbPath: string | null;
  createdAt: string;
  errorMessage: string | null;
};

// Una imagen ya adjunta al producto, ofrecible como referencia en el compositor.
export type StudioRefOption = {
  id: string; // media_reference id
  previewUrl: string | null;
  filename: string;
};

// Arrays de imágenes del producto por rol (para adjuntar sin pisar lo existente).
export type StudioProductImages = {
  productImageIds: string[];
  packagingImageIds: string[];
};

export type StudioSessionOption = {
  id: string;
  createdAt: string;
};

export type StudioClientProps = {
  workspaceId: string;
  userId: string;
  assetType: 'product';
  assetId: string;
  assetName: string;
  initialBalance: number;
  pricing: PricingRow[];
  sessions: StudioSessionOption[];
  activeSessionId: string | null;
  initialItems: StudioTurn[];
  availableReferences: StudioRefOption[];
  productImages: StudioProductImages;
};
