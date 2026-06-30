// Probe manual (lo corre el usuario) para confirmar que la cuenta BFL tiene
// habilitado el endpoint FLUX.1 Expand antes de construir la integracion.
// No imprime la key. Genera una imagen de prueba local con sharp, hace un POST
// minimo a /v1/flux-pro-1.0-expand con top/bottom chicos y reporta el resultado.
// Uso: node scripts/probe-flux-expand.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const BFL_BASE = 'https://api.bfl.ai';

function loadKey() {
  // Lee BFL_API_KEY de process.env o de .env.local (sin imprimirla).
  if (process.env.BFL_API_KEY) return process.env.BFL_API_KEY;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const line = env.split(/\r?\n/).find((l) => l.startsWith('BFL_API_KEY='));
    if (line) return line.slice('BFL_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  } catch {
    /* sin .env.local */
  }
  return '';
}

async function main() {
  const apiKey = loadKey();
  if (!apiKey) {
    console.error('FALTA BFL_API_KEY (env o .env.local). Abort.');
    process.exit(2);
  }
  console.log(`BFL_API_KEY presente (len=${apiKey.length}).`);

  // Imagen de prueba 360x450 (4:5) llena de un color, JPEG.
  const base = await sharp({
    create: { width: 360, height: 450, channels: 3, background: { r: 40, g: 80, b: 160 } },
  })
    .jpeg()
    .toBuffer();

  const body = {
    image: base.toString('base64'),
    top: 95,
    bottom: 95,
    left: 0,
    right: 0,
    prompt: 'extend the scene naturally above and below',
    output_format: 'jpeg',
    safety_tolerance: 2,
  };

  const submit = await fetch(`${BFL_BASE}/v1/flux-pro-1.0-expand`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-key': apiKey },
    body: JSON.stringify(body),
  });

  console.log(`POST /v1/flux-pro-1.0-expand -> HTTP ${submit.status}`);
  const text = await submit.text();

  if (submit.status === 404) {
    console.error('RESULTADO: 404 Not Found. El endpoint NO esta habilitado en la cuenta. PIVOTEAR.');
    process.exit(1);
  }
  if (submit.status === 403 || submit.status === 401) {
    console.error(`RESULTADO: ${submit.status} auth. Revisar key/permisos. Cuerpo: ${text.slice(0, 200)}`);
    process.exit(1);
  }
  if (!submit.ok) {
    console.error(`RESULTADO: HTTP ${submit.status}. Cuerpo: ${text.slice(0, 300)}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(`Respuesta no-JSON: ${text.slice(0, 200)}`);
    process.exit(1);
  }
  if (parsed.polling_url) {
    console.log('RESULTADO: OK. El endpoint existe y devolvio polling_url.');
    console.log(`id=${parsed.id ?? '(sin id)'}`);
    console.log('Endpoint DISPONIBLE. Continuar con Task 2.');
    process.exit(0);
  }
  console.error(`Respuesta inesperada (sin polling_url): ${JSON.stringify(parsed).slice(0, 300)}`);
  process.exit(1);
}

main().catch((e) => {
  console.error('Error inesperado:', e?.message ?? e);
  process.exit(1);
});
