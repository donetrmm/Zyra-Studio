// Smoke test manual de Seedance 2.0 via fal.ai — LO CORRE EL USUARIO (cuesta dinero real).
//
// Uso:
//   pnpm smoke:seedance                          ← t2v fast 480p, 4 s (el más barato)
//   pnpm smoke:seedance -- --i2v <url-imagen>    ← image-to-video (verifica nombres de params)
//
// Requiere FAL_KEY en .env.local. Replica el input que construye
// lib/providers/seedance.ts para validar el contrato contra la API real.

import { fal } from '@fal-ai/client';
import { writeFile } from 'node:fs/promises';

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.error('FAL_KEY no está en el entorno. Corre con: node --env-file=.env.local scripts/smoke-seedance.mjs');
  process.exit(1);
}
fal.config({ credentials: FAL_KEY });

const args = process.argv.slice(2);
const i2vIndex = args.indexOf('--i2v');
const isI2V = i2vIndex !== -1;
const imageUrl = isI2V ? args[i2vIndex + 1] : undefined;
if (isI2V && !imageUrl) {
  console.error('--i2v requiere una URL de imagen accesible públicamente');
  process.exit(1);
}

const model = isI2V
  ? 'bytedance/seedance-2.0/fast/image-to-video'
  : 'bytedance/seedance-2.0/fast/text-to-video';

// Mismo shape que submitTask del adapter (lib/providers/seedance.ts)
const input = {
  prompt: isI2V
    ? 'The camera slowly pushes in on the product. Soft studio light sweeps across the surface. No people, no text.'
    : 'A frosted glass bottle on black marble rotates slowly while a soft warm light sweeps across the glass. Macro close-up, smooth orbit, premium commercial style. No text, no people.',
  resolution: '480p',
  duration: '4',
  aspect_ratio: '9:16',
  generate_audio: true,
};
if (isI2V) input.image_url = imageUrl;

console.log(`Modelo:  ${model}`);
console.log(`Input:   ${JSON.stringify(input, null, 2)}`);
console.log('Encolando...');

const started = Date.now();
const { request_id } = await fal.queue.submit(model, { input });
console.log(`request_id: ${request_id}`);

let status;
do {
  await new Promise((r) => setTimeout(r, 10_000));
  status = await fal.queue.status(model, { requestId: request_id });
  console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${status.status}`);
} while (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS');

if (status.status !== 'COMPLETED') {
  console.error(`Falló con status: ${status.status}`);
  console.error(JSON.stringify(status, null, 2));
  process.exit(1);
}

const result = await fal.queue.result(model, { requestId: request_id });
const video = result.data?.video;
const seed = result.data?.seed;
console.log(`\nCompletado en ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`seed:  ${seed}`);
console.log(`video: ${video?.url}`);

if (video?.url) {
  const res = await fetch(video.url);
  const buffer = Buffer.from(await res.arrayBuffer());
  const out = 'scripts/smoke-seedance-output.mp4';
  await writeFile(out, buffer);
  console.log(`Descargado: ${out} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

console.log('\nVerifica y reporta:');
console.log('  1. El video abre y se ve coherente con el prompt (con audio).');
console.log('  2. En fal.ai/dashboard: el costo real del clip fast 480p (para ajustar 024_v2_seedance.sql).');
if (isI2V) console.log('  3. i2v aceptó image_url sin error 422 (confirma el nombre del param).');
