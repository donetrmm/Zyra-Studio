import 'server-only';
import { Client } from '@upstash/qstash';

// Cliente QStash compartido para encolar jobs. Solo se usa server-side.
// El token nunca llega al cliente.
let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN no configurada');
  // QSTASH_URL es opcional. Si no se setea, el SDK usa el endpoint global
  // (https://qstash.upstash.io) que puede no coincidir con la región donde
  // vive tu cuenta. Si ves "user not found in this region", configura
  // QSTASH_URL al endpoint exacto que muestra tu dashboard de Upstash.
  const baseUrl = process.env.QSTASH_URL;
  _client = new Client(baseUrl ? { token, baseUrl } : { token });
  return _client;
}

export type EnqueueJobInput = {
  generationId: string;
  action: 'submit' | 'poll';
  delaySeconds?: number;
};

// Encola un mensaje POST al worker /api/jobs/process. El worker se re-encola
// a sí mismo con `delaySeconds` cuando necesita polling adicional.
//
// NEXT_PUBLIC_APP_URL DEBE estar configurada (la URL externa del deploy).
// QStash necesita un endpoint HTTPS accesible desde su backend — para dev
// local usa ngrok y override la var de entorno con la URL del túnel.
export async function enqueueJob(input: EnqueueJobInput): Promise<{ messageId: string }> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) throw new Error('NEXT_PUBLIC_APP_URL no configurada');
  const client = getClient();
  const res = await client.publishJSON({
    url: `${baseUrl}/api/jobs/process`,
    body: { generationId: input.generationId, action: input.action },
    delay: input.delaySeconds ?? 0,
    retries: 3,
  });
  return { messageId: res.messageId };
}
