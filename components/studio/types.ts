import type { PricingRow } from '@/lib/credits/types';
import type { StudioPreset } from '@/lib/studio/presets';

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
  // Reserva el espacio del skeleton de carga con el aspecto pedido (evita el
  // salto cuando llega la imagen). '1:1' | '4:5' | '9:16' | '16:9'.
  aspectRatio: string | null;
};

// Una imagen ya adjunta al producto, ofrecible como referencia en el compositor.
export type StudioRefOption = {
  id: string; // media_reference id
  previewUrl: string | null;
  filename: string;
};

// Imágenes del activo por rol. Para producto es solo arrays de imágenes; para
// locación/personaje se carga la ENTIDAD COMPLETA porque updateLocation/Character
// hacen upsert de todo el registro (adjuntar = fusionar la nueva imagen en el rol
// y reescribir el resto sin pisarlo).
export type StudioAssetImages =
  | { assetType: 'product'; productImageIds: string[]; packagingImageIds: string[] }
  | {
      assetType: 'location';
      name: string;
      description: string | null;
      masterImageId: string | null;
      referenceImageIds: string[];
      scaleMapImageId: string | null;
      scaleMapNotes: string | null;
    }
  | {
      assetType: 'character';
      name: string;
      description: string | null;
      masterImageId: string | null;
      angleImageIds: string[];
      fullBodyImageId: string | null;
      voiceCloneId: string | null;
    }
  | {
      assetType: 'panel';
      // Etiqueta del beat (p. ej. "Panel 3") para el header del estudio.
      name: string;
      // media_reference del panel vigente (null = beat sin panel todavía).
      panelImageId: string | null;
      // Refs limpias del beat (producto/personaje/locación) + el panel actual,
      // ofrecibles como referencia en el compositor. Dedup, sin null.
      cleanReferenceIds: string[];
      // Guion del beat, precargado como pista editable en el compositor.
      scenePrompt: string;
      // Aspecto del beat (default del compositor para consistencia con el video).
      aspectRatio: string | null;
    };

export type StudioAssetType = 'product' | 'location' | 'character' | 'panel';

export type StudioSessionOption = {
  id: string;
  title: string | null;
  createdAt: string;
};

export type StudioClientProps = {
  workspaceId: string;
  userId: string;
  assetType: StudioAssetType;
  assetId: string;
  assetName: string;
  initialBalance: number;
  pricing: PricingRow[];
  sessions: StudioSessionOption[];
  activeSessionId: string | null;
  initialItems: StudioTurn[];
  availableReferences: StudioRefOption[];
  // Presets de imagen guardados del usuario (tabla presets, type='image'). Los
  // integrados (BUILTIN_PRESETS) los resuelve el Composer por assetType.
  userPresets: StudioPreset[];
  // Sólo relevante en personaje: si ya tiene maestra. Compuerta de Outfit/Estado
  // en el AttachDialog (se actualiza en vivo al adjuntar una maestra en sesión).
  characterHasMaster: boolean;
  // Base de edición inicial cuando la sesión aún no tiene turnos (modo panel: la
  // generación del panel vigente). Si hay turnos done, gana el último.
  initialWorkingId?: string | null;
  // Prompt precargado en el compositor (modo panel: el scene_prompt del beat).
  initialPrompt?: string;
  // Link "volver" del header (modo panel: al storyboard de la campaña).
  backHref?: string;
  // Aspecto por defecto del compositor (modo panel: el aspect_ratio del beat).
  defaultAspect?: string | null;
};
