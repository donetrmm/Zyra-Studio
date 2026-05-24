import { z } from 'zod';

export const TTS_MODELS = ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_v3'] as const;
export const TTS_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'zh'] as const;

export const VoiceSettingsSchema = z.object({
  stability: z.number().min(0).max(1),
  similarity_boost: z.number().min(0).max(1),
  style: z.number().min(0).max(1).optional(),
  use_speaker_boost: z.boolean().optional(),
});

export const SubmitTtsSchema = z.object({
  kind: z.literal('tts'),
  voiceId: z.string().min(1),
  modelId: z.enum(TTS_MODELS),
  text: z.string().trim().min(1, 'texto vacío').max(20000, 'texto muy largo (max 20k chars)'),
  voiceSettings: VoiceSettingsSchema,
  languageCode: z.enum(TTS_LANGUAGES).optional(),
});

export type SubmitTtsInput = z.infer<typeof SubmitTtsSchema>;
