// scripts/generate-shot-images.mjs
// Genera las imágenes del diccionario de tomas UNA vez con FLUX.
// Uso: node --env-file=.env.local scripts/generate-shot-images.mjs [slug]
// Sin argumento genera las faltantes; con slug regenera esa toma.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const { generate } = await import('../lib/providers/flux.ts');
const { SHOTS } = await import('../lib/shots/catalog.ts');

const OUT = join(process.cwd(), 'public', 'shots');
await mkdir(OUT, { recursive: true });

// Mismo sujeto neutro en todas para que la VARIABLE sea la toma.
const SUBJECT = 'a matte ceramic skincare jar on a warm neutral studio set';
const PROMPTS = {
  'close-up': `tight close-up of ${SUBJECT}, shallow depth of field`,
  'macro': `extreme macro of the jar lid texture, ${SUBJECT}`,
  'plano-medio': `medium shot, person holding ${SUBJECT} at chest height, face visible`,
  'selfie-handheld': `handheld selfie angle, person showing ${SUBJECT} to camera, slight motion blur`,
  'cenital': `top-down overhead shot, hands arranging ${SUBJECT} on a table`,
  'over-the-shoulder': `over-the-shoulder shot, hands opening ${SUBJECT}`,
  'contrapicado': `dramatic low-angle shot of ${SUBJECT}, monumental presence`,
  'plano-general': `wide establishing shot, ${SUBJECT} on a table in a sunlit room`,
  'detalle-tactil': `close-up of fingertips touching the open jar, ${SUBJECT}`,
  'dolly-in': `cinematic frame mid dolly-in towards ${SUBJECT}, motion trail hint`,
  'orbita': `frame from an orbiting camera path around ${SUBJECT}`,
  'tracking': `tracking shot frame, person walking with ${SUBJECT}, urban background`,
  'pull-back': `frame mid pull-back revealing the full room around ${SUBJECT}`,
  'speed-ramp': `high-energy frame, ${SUBJECT} splashing into water, frozen droplets`,
};

const only = process.argv[2];
for (const shot of SHOTS) {
  if (only && shot.slug !== only) continue;
  const file = join(OUT, `${shot.slug}.jpg`);
  if (!only) {
    try { await access(file); console.log(`ya existe: ${shot.slug}`); continue; } catch {}
  }
  const prompt = PROMPTS[shot.slug];
  if (!prompt) { console.error(`sin prompt para ${shot.slug}`); continue; }
  console.log(`generando ${shot.slug}…`);
  const result = await generate({ prompt, width: 768, height: 512, photoreal: true });
  await writeFile(file, result.buffer);
  console.log(`ok → public/shots/${shot.slug}.jpg`);
}
