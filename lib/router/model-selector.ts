export type ImageProvider = 'nano-banana' | 'flux';

// Intención explícita del usuario; chip opcional bajo el picker de modelo en
// modo auto. null = "decide tú" (cae al default según resolución).
export type ImageIntent = 'photo' | 'illustration' | 'design' | 'draft';

export type ImageModelSelection = {
  provider: ImageProvider;
  model: string;
  variant: string;
  reason: ImageRouterReason;
};

export type ImageRouterReason =
  | 'conversational'
  | 'grounding'
  | 'text-toggle'
  | 'refs-overflow-pro'
  | 'refs-overflow-flux'
  | 'high-resolution'
  | 'photoreal-toggle'
  | 'photo-intent'
  | 'illustration-intent'
  | 'design-intent'
  | 'draft-intent'
  | 'low-resolution-quick'
  | 'default-quality';

export const ROUTER_REASON_LABEL: Record<ImageRouterReason, string> = {
  conversational: 'edición conversacional requiere Nano Pro',
  grounding: 'búsqueda en Google solo en Nano',
  'text-toggle': 'Nano renderiza mejor texto en imagen',
  'refs-overflow-pro': 'más de 11 refs solo en Nano Flash',
  'refs-overflow-flux': 'FLUX tope 8 refs, paso a Nano Pro',
  'high-resolution': '4K solo en Nano Pro',
  'photoreal-toggle': 'fotorrealismo activo',
  'photo-intent': 'estilo fotografía',
  'illustration-intent': 'estilo ilustración',
  'design-intent': 'estilo diseño / typo / UI',
  'draft-intent': 'borrador rápido',
  'low-resolution-quick': '1K para velocidad',
  'default-quality': 'calidad balanceada por defecto',
};

export type ImageRouterParams = {
  intent?: ImageIntent | null;
  hasTextInImage?: boolean;
  photoreal?: boolean;
  references?: { id: string }[];
  useGrounding?: boolean;
  conversational?: boolean;
  resolution?: '1k' | '2k' | '4k';
};

const NANO_PRO = 'gemini-3-pro-image-preview';
const NANO_FLASH = 'gemini-3.1-flash-image-preview';
const FLUX = 'flux-2-pro-preview';

// Cap del variant de Flash a 2K — el modelo no soporta 4K.
function flashVariant(res: '1k' | '2k' | '4k'): '1k' | '2k' {
  return res === '4k' ? '2k' : (res as '1k' | '2k');
}

export function selectImageModel(params: ImageRouterParams): ImageModelSelection {
  const refs = (params.references ?? []).length;
  const resolution = params.resolution ?? '2k';

  // ============ HARD CONSTRAINTS ============
  // Ningún otro signal puede overridear estos: o el otro modelo no lo soporta,
  // o el feature no funcionaría.

  if (params.conversational) {
    return {
      provider: 'nano-banana',
      model: NANO_PRO,
      variant: resolution,
      reason: 'conversational',
    };
  }

  if (params.useGrounding) {
    return {
      provider: 'nano-banana',
      model: NANO_PRO,
      variant: resolution,
      reason: 'grounding',
    };
  }

  if (params.hasTextInImage) {
    return {
      provider: 'nano-banana',
      model: NANO_PRO,
      variant: resolution,
      reason: 'text-toggle',
    };
  }

  if (refs > 11) {
    // Solo Flash llega a 14 refs.
    return {
      provider: 'nano-banana',
      model: NANO_FLASH,
      variant: flashVariant(resolution),
      reason: 'refs-overflow-pro',
    };
  }

  if (refs > 8) {
    // FLUX tope 8 refs; Pro llega a 11.
    return {
      provider: 'nano-banana',
      model: NANO_PRO,
      variant: resolution,
      reason: 'refs-overflow-flux',
    };
  }

  if (resolution === '4k') {
    // Flash y FLUX no soportan 4K nativo de Nano Pro.
    return {
      provider: 'nano-banana',
      model: NANO_PRO,
      variant: '4k',
      reason: 'high-resolution',
    };
  }

  // ============ STRONG SIGNALS ============

  if (params.photoreal) {
    return {
      provider: 'flux',
      model: FLUX,
      variant: 'default',
      reason: 'photoreal-toggle',
    };
  }

  // ============ INTENT EXPLÍCITA ============
  // Chip seleccionado por el usuario bajo "Estilo (opcional)". Más predecible
  // que adivinar por keywords; si está vacío, cae a default por resolución.

  if (params.intent === 'photo') {
    return {
      provider: 'flux',
      model: FLUX,
      variant: 'default',
      reason: 'photo-intent',
    };
  }

  if (params.intent === 'illustration') {
    return {
      provider: 'nano-banana',
      model: NANO_PRO,
      variant: resolution,
      reason: 'illustration-intent',
    };
  }

  if (params.intent === 'design') {
    return {
      provider: 'nano-banana',
      model: NANO_PRO,
      variant: resolution,
      reason: 'design-intent',
    };
  }

  if (params.intent === 'draft') {
    return {
      provider: 'nano-banana',
      model: NANO_FLASH,
      variant: '1k',
      reason: 'draft-intent',
    };
  }

  // Si el usuario eligió 1K explícitamente sin más señales, asumimos que
  // quiere velocidad → Flash.
  if (resolution === '1k') {
    return {
      provider: 'nano-banana',
      model: NANO_FLASH,
      variant: '1k',
      reason: 'low-resolution-quick',
    };
  }

  // Default: Nano Pro 2K — calidad balanceada, capacidad amplia.
  return {
    provider: 'nano-banana',
    model: NANO_PRO,
    variant: '2k',
    reason: 'default-quality',
  };
}
