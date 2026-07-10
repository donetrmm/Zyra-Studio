import 'server-only';

export type JobAction = 'submit' | 'poll';

// Resultado que un handler devuelve al worker. Discriminated union.
export type JobResult =
  | {
      kind: 'continue';
      taskId?: string;
      delaySeconds: number;
      providerPayload?: Record<string, unknown>;
    }
  | {
      kind: 'finalize';
      outputBuffer: Buffer;
      mimeType: string;
      metadata?: Record<string, unknown>;
      // URL del último fotograma del clip (encadenado de secuencias, specs/v2/09).
      // Solo presente cuando se pidió returnLastFrame y el proveedor lo devolvió.
      lastFrameUrl?: string;
    }
  | {
      kind: 'fail';
      message: string;
      code: 'safety' | 'rate_limit' | 'timeout' | 'unknown';
    }
  // Claim atómico perdido (otra invocación de QStash ya tomó el job one-shot):
  // no-op, no confirma ni refundea ni re-encola.
  | { kind: 'skip' };

// Vista mínima de la fila generations que el handler necesita. Lo carga el
// worker con service_role antes de invocar al handler. Mantén esto sincronizado
// con el SELECT que hace el worker.
export type GenerationRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  type: 'video' | 'image' | 'audio';
  provider: 'veo' | 'kling' | 'elevenlabs' | 'nano-banana' | 'flux' | 'seedance' | 'gpt-image';
  model_id: string;
  prompt: string | null;
  params: Record<string, unknown>;
  reference_ids: string[];
  status: 'queued' | 'processing' | 'done' | 'failed' | 'canceled';
  provider_task_id: string | null;
  provider_payload: Record<string, unknown> | null;
  poll_attempts: number;
  timeout_at: string | null;
  cancel_requested: boolean;
  credits_estimated: number;
};

export interface JobHandler {
  handle(gen: GenerationRow, action: JobAction): Promise<JobResult>;
  // Opcional. Solo Kling lo expone (Veo no tiene cancel remoto).
  cancel?(gen: GenerationRow): Promise<void>;
}
