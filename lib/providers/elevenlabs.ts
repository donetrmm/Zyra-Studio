import 'server-only';
import { ProviderError } from './types';

const BASE_URL = 'https://api.elevenlabs.io';

export type ElevenLabsModel = 'eleven_multilingual_v2' | 'eleven_flash_v2_5' | 'eleven_v3';

export type VoiceSettings = {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
};

// Split text en chunks para TTS largos. Estrategia:
// 1. Si text.length <= threshold → un solo chunk
// 2. Si no → dividir por frases (regex de puntuación seguida de espacio)
// 3. Acumular frases hasta que el chunk se acerque al cap, después romper
// 4. Si una "frase" sola excede el cap (texto sin puntuación), hard-split por chars
//
// `chunkCap` es el máximo absoluto por chunk; `threshold` decide cuándo activar
// el split. Default: threshold=4000, cap=3000 (cap < threshold porque después
// del primer split queremos chunks que claramente quepan).
export function chunkText(
  text: string,
  threshold: number,
  chunkCap: number,
): string[] {
  if (text.length <= threshold) return [text];

  // Dividir por frases preservando el delimitador.
  // El regex puede saltar caracteres iniciales de puntuación (e.g. text="...hola long...")
  // porque ambas alternativas requieren `[^.!?]+` al inicio. Si detectamos
  // que se perdieron chars, fallback a hard-split puro para no perder contenido.
  const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [text];
  if (sentences.join('').length < text.length) {
    const fallback: string[] = [];
    for (let i = 0; i < text.length; i += chunkCap) {
      fallback.push(text.slice(i, i + chunkCap));
    }
    return fallback;
  }

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    // Si la frase sola excede el cap, hard-split.
    // Prepende `current` al primer slice para no fragmentar de más cuando
    // venimos arrastrando frases cortas previas.
    if (sentence.length > chunkCap) {
      const combined = current + sentence;
      current = '';
      for (let i = 0; i < combined.length; i += chunkCap) {
        chunks.push(combined.slice(i, i + chunkCap));
      }
      continue;
    }
    // Si agregar la frase excede el cap, empezar nuevo chunk
    if (current.length + sentence.length > chunkCap) {
      chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// TTS — devuelve buffer MP3. Si text > 4000 chars hace chunking + concat raw.
export async function tts(params: {
  text: string;
  voiceId: string;
  modelId: ElevenLabsModel;
  voiceSettings?: VoiceSettings;
  languageCode?: string;
}): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new ProviderError('ELEVENLABS_API_KEY no configurada', 'auth', false);

  const chunks = chunkText(params.text, 4000, 3000);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const buf = await ttsChunk({ ...params, text: chunk }, apiKey);
    buffers.push(buf);
  }
  return Buffer.concat(buffers);
}

async function ttsChunk(
  params: {
    text: string;
    voiceId: string;
    modelId: ElevenLabsModel;
    voiceSettings?: VoiceSettings;
    languageCode?: string;
  },
  apiKey: string,
): Promise<Buffer> {
  const body: Record<string, unknown> = {
    text: params.text,
    model_id: params.modelId,
  };
  if (params.voiceSettings) body.voice_settings = params.voiceSettings;
  if (params.languageCode) body.language_code = params.languageCode;

  const res = await fetch(`${BASE_URL}/v1/text-to-speech/${params.voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con ElevenLabs', 'auth', false);
  }
  if (res.status === 402) {
    throw new ProviderError('Cuota de ElevenLabs agotada', 'auth', false);
  }
  if (res.status === 429) {
    throw new ProviderError('Rate limit ElevenLabs', 'rate_limit', true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(
      `ElevenLabs TTS ${res.status}: ${text.slice(0, 200)}`,
      res.status >= 500 ? 'server' : 'unknown',
      res.status >= 500,
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new ProviderError('ELEVENLABS_API_KEY no configurada', 'auth', false);
  return key;
}

export async function cloneVoice(params: {
  name: string;
  description?: string;
  files: { buffer: Buffer; filename: string }[];
}): Promise<{ voiceId: string }> {
  const apiKey = getApiKey();
  const form = new FormData();
  form.append('name', params.name);
  if (params.description) form.append('description', params.description);
  for (const f of params.files) {
    form.append('files', new Blob([new Uint8Array(f.buffer)]), f.filename);
  }

  const res = await fetch(`${BASE_URL}/v1/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`ElevenLabs clone ${res.status}: ${text.slice(0, 200)}`, 'unknown', false);
  }
  const data = (await res.json()) as { voice_id: string };
  return { voiceId: data.voice_id };
}

// Obtiene metadata de una voz (incluye preview_url). preview_url es un MP3
// corto servido desde la CDN pública de ElevenLabs, apto para reproducir
// directo desde el navegador.
export async function getVoicePreview(voiceId: string): Promise<{
  previewUrl: string | null;
  name: string | null;
}> {
  const apiKey = getApiKey();
  const res = await fetch(`${BASE_URL}/v1/voices/${voiceId}`, {
    headers: { 'xi-api-key': apiKey },
  });
  if (res.status === 404) return { previewUrl: null, name: null };
  if (!res.ok) {
    throw new ProviderError(`ElevenLabs get voice ${res.status}`, 'unknown', false);
  }
  const data = (await res.json()) as { name?: string; preview_url?: string };
  return { previewUrl: data.preview_url ?? null, name: data.name ?? null };
}

export async function deleteVoice(voiceId: string): Promise<void> {
  const apiKey = getApiKey();
  const res = await fetch(`${BASE_URL}/v1/voices/${voiceId}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': apiKey },
  });
  if (!res.ok && res.status !== 404) {
    throw new ProviderError(`ElevenLabs delete voice ${res.status}`, 'unknown', false);
  }
}
