import 'server-only';
import { Receiver } from '@upstash/qstash';

// Singleton del Receiver para verificar firmas de QStash. Las dos signing keys
// (current + next) son necesarias durante rotación de keys.
let _receiver: Receiver | null = null;

function getReceiver(): Receiver {
  if (_receiver) return _receiver;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new Error('QSTASH_CURRENT_SIGNING_KEY o QSTASH_NEXT_SIGNING_KEY no configuradas');
  }
  _receiver = new Receiver({ currentSigningKey, nextSigningKey });
  return _receiver;
}

// Verifica la firma del request entrante. Lanza si es inválida.
// Recibe el body raw como string (no parseado), tal cual viene del request.
export async function verifyQStashSignature(params: {
  signature: string;
  body: string;
  url: string;
}): Promise<void> {
  const receiver = getReceiver();
  const isValid = await receiver.verify({
    signature: params.signature,
    body: params.body,
    url: params.url,
  });
  if (!isValid) throw new Error('Firma QStash inválida');
}
