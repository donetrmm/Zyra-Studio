import 'server-only';
import { tts, type ElevenLabsModel, type VoiceSettings } from '@/lib/providers/elevenlabs';
import { ProviderError } from '@/lib/providers/types';
import type { GenerationRow, JobAction, JobHandler, JobResult } from './types';

// Params que el server action serializa dentro de generations.params para TTS.
type TtsParams = {
  voiceId: string;
  voiceSettings?: VoiceSettings;
  languageCode?: string;
};

function isTtsModel(modelId: string): modelId is ElevenLabsModel {
  return (
    modelId === 'eleven_multilingual_v2' ||
    modelId === 'eleven_flash_v2_5' ||
    modelId === 'eleven_v3'
  );
}

export const elevenLabsHandler: JobHandler = {
  async handle(gen: GenerationRow, _action: JobAction): Promise<JobResult> {
    if (gen.type !== 'audio') {
      return {
        kind: 'fail',
        message: `ElevenLabs handler recibió type=${gen.type}, esperaba audio`,
        code: 'unknown',
      };
    }
    if (!isTtsModel(gen.model_id)) {
      // Sound effect lo agregaremos en Día 5. Voice clone va por server action
      // directo, no por la cola.
      return {
        kind: 'fail',
        message: `model_id ${gen.model_id} no soportado en handler ElevenLabs todavía`,
        code: 'unknown',
      };
    }
    if (!gen.prompt) {
      return { kind: 'fail', message: 'prompt vacío', code: 'unknown' };
    }
    const params = gen.params as TtsParams;
    if (!params.voiceId) {
      return { kind: 'fail', message: 'voiceId faltante en params', code: 'unknown' };
    }
    try {
      const buffer = await tts({
        text: gen.prompt,
        voiceId: params.voiceId,
        modelId: gen.model_id,
        voiceSettings: params.voiceSettings,
        languageCode: params.languageCode,
      });
      return { kind: 'finalize', outputBuffer: buffer, mimeType: 'audio/mpeg' };
    } catch (err) {
      if (err instanceof ProviderError) {
        return {
          kind: 'fail',
          message: err.message,
          code:
            err.code === 'safety'
              ? 'safety'
              : err.code === 'rate_limit'
                ? 'rate_limit'
                : err.code === 'timeout'
                  ? 'timeout'
                  : 'unknown',
        };
      }
      return { kind: 'fail', message: (err as Error).message, code: 'unknown' };
    }
  },
};
