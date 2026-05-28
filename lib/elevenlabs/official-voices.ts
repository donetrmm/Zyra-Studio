// Catálogo de voces oficiales de ElevenLabs que exponemos en la UI. Vive
// fuera de los componentes 'use client' para poder consumirlo también desde
// server actions sin arrastrar el bundle de cliente.

export const OFFICIAL_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', lang: 'en' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', lang: 'en' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', lang: 'en' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', lang: 'multi' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', lang: 'multi' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', lang: 'multi' },
] as const;

export const OFFICIAL_VOICE_IDS = new Set<string>(OFFICIAL_VOICES.map((v) => v.id));
