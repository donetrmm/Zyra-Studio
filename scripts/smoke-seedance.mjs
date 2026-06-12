// Smoke test manual de Seedance 2.0 vía BytePlus ModelArk — LO CORRE EL USUARIO
// (cuesta dinero real).
//
// Uso:
//   pnpm smoke:seedance                          ← t2v fast 480p, 4 s (el más barato)
//   pnpm smoke:seedance -- --i2v <url-imagen>    ← image-to-video (first_frame)
//
// Requiere ARK_API_KEY en .env.local (opcional ARK_API_BASE_URL para Volcengine).
// Replica el body que construye lib/providers/seedance.ts contra la API real.

const ARK_API_KEY = process.env.ARK_API_KEY;
if (!ARK_API_KEY) {
  console.error('ARK_API_KEY no está en el entorno. Corre con: node --env-file=.env.local scripts/smoke-seedance.mjs');
  process.exit(1);
}
const BASE_URL = process.env.ARK_API_BASE_URL ?? 'https://ark.ap-southeast.bytepluses.com/api/v3';

import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const i2vIndex = args.indexOf('--i2v');
const isI2V = i2vIndex !== -1;
const imageUrl = isI2V ? args[i2vIndex + 1] : undefined;
if (isI2V && !imageUrl) {
  console.error('--i2v requiere una URL de imagen accesible públicamente');
  process.exit(1);
}

// Tier fast (más barato) para el smoke. Operación vía roles del content.
const model = 'dreamina-seedance-2-0-fast-260128';
const prompt = isI2V
  ? 'The camera slowly pushes in on the product. Soft studio light sweeps across the surface. No people, no text.'
  : 'A frosted glass bottle on black marble rotates slowly while a soft warm light sweeps across the glass. Macro close-up, smooth orbit, premium commercial style. No text, no people.';

const content = [{ type: 'text', text: prompt }];
if (isI2V) content.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'first_frame' });

const body = {
  model,
  content,
  resolution: '480p',
  ratio: '9:16',
  duration: 4,
  generate_audio: true,
  watermark: false,
};

console.log(`Endpoint: ${BASE_URL}/contents/generations/tasks`);
console.log(`Body:     ${JSON.stringify(body, null, 2)}`);
console.log('Encolando...');

const started = Date.now();
const createRes = await fetch(`${BASE_URL}/contents/generations/tasks`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${ARK_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!createRes.ok) {
  console.error(`submit falló (${createRes.status}): ${await createRes.text()}`);
  process.exit(1);
}
const { id } = await createRes.json();
console.log(`task id: ${id}`);

let task;
do {
  await new Promise((r) => setTimeout(r, 10_000));
  const pollRes = await fetch(`${BASE_URL}/contents/generations/tasks/${id}`, {
    headers: { Authorization: `Bearer ${ARK_API_KEY}` },
  });
  if (!pollRes.ok) {
    console.error(`poll falló (${pollRes.status}): ${await pollRes.text()}`);
    process.exit(1);
  }
  task = await pollRes.json();
  console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${task.status}`);
} while (task.status === 'queued' || task.status === 'running');

if (task.status !== 'succeeded') {
  console.error(`Falló con status: ${task.status}`);
  console.error(JSON.stringify(task, null, 2));
  process.exit(1);
}

const videoUrl = task.content?.video_url;
const seed = task.seed;
const totalTokens = task.usage?.total_tokens;
console.log(`\nCompletado en ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`seed:         ${seed}`);
console.log(`total_tokens: ${totalTokens}`);
console.log(`video:        ${videoUrl}`);

if (videoUrl) {
  const res = await fetch(videoUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  const out = 'scripts/smoke-seedance-output.mp4';
  await writeFile(out, buffer);
  console.log(`Descargado: ${out} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

console.log('\nVerifica y reporta:');
console.log('  1. El video abre y se ve coherente con el prompt (con audio).');
console.log('  2. usage.total_tokens del clip fast 480p → para re-validar el margen de cr/s (model_pricing).');
console.log('  3. El sistema @ resolvió las referencias en orden (si probaste r2v manualmente).');
if (isI2V) console.log('  4. i2v aceptó el content image_url con role first_frame sin error.');
