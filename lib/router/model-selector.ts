export type ImageProvider = 'nano-banana' | 'flux';
export type ImagePreset =
  | 'photo-product'
  | 'portrait-photoreal'
  | 'illustration'
  | 'design'
  | 'infographic'
  | null;

export type ImageRouterParams = {
  preset?: ImagePreset;
  hasTextInImage?: boolean;
  references?: { id: string }[];
  useGrounding?: boolean;
  priority?: 'speed' | 'quality' | 'premium';
  resolution?: '1k' | '2k' | '4k';
};

export type ImageModelSelection = {
  provider: ImageProvider;
  model: string;
  variant: string;
};

export function selectImageModel(params: ImageRouterParams): ImageModelSelection {
  const refs = params.references ?? [];

  if (params.preset === 'photo-product' || params.preset === 'portrait-photoreal') {
    return { provider: 'flux', model: 'flux-2-pro-preview', variant: 'default' };
  }

  if (params.hasTextInImage || refs.length > 8 || params.useGrounding) {
    return {
      provider: 'nano-banana',
      model: 'gemini-3-pro-image-preview',
      variant: params.resolution ?? '2k',
    };
  }

  if (params.priority === 'speed') {
    return {
      provider: 'nano-banana',
      model: 'gemini-3.1-flash-image-preview',
      variant: '1k',
    };
  }

  return {
    provider: 'nano-banana',
    model: 'gemini-3-pro-image-preview',
    variant: '2k',
  };
}
