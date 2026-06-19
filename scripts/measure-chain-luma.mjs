// Diagnostico de deriva de brillo en el encadenado de secuencias (specs/v2/09).
// LO CORRE EL USUARIO (o el asistente con su .env.local). No genera nada ni llama
// APIs de pago: descarga los clips YA generados de una cadena desde Supabase
// Storage (bucket outputs) y mide su perfil de luminancia y color con ffmpeg,
// para CONFIRMAR el diagnostico antes de codear un fix (ver MEMORY
// project_seedance_fast_tier_jank: medir antes de asumir).
//
// Mide cada clip decodificandolo COMPLETO a 1x1 (media de area por fotograma),
// asi obtiene el perfil de brillo cuadro a cuadro: apertura, cuerpo, final y el
// ULTIMO fotograma real (el que hereda el clip siguiente). Responde:
//   1. Oscurecimiento clip a clip? (cumulativo a lo largo de la cadena)
//   2. Cada clip ABRE mas oscuro que su propio cuerpo? (= el arranque hereda el
//      fotograma anterior; es el sintoma "el siguiente se ve mas oscuro")
//   3. La apertura del clip N+1 sigue al ultimo fotograma del clip N? (mecanismo)
//   4. Es deriva de LUMA o de COLOR/temperatura? (este fix solo cubre luma)
//
// Uso:
//   pnpm measure:chain-luma                              <- escanea las ultimas N cadenas
//   pnpm measure:chain-luma -- --campaign-name "Aniversario pareja 2"
//   pnpm measure:chain-luma -- --campaign <campaignId>
//   pnpm measure:chain-luma -- --sequence <sequenceId>
//   pnpm measure:chain-luma -- --last 10                 <- cuantas cadenas en modo default
//   pnpm measure:chain-luma -- --verbose                 <- perfil de brillo por clip
//
// Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local.
// Corre con: node --env-file=.env.local scripts/measure-chain-luma.mjs

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const FFMPEG = ffmpegInstaller.path;
const OUTPUTS_BUCKET = 'outputs';

const OPEN_FRAC = 0.12; // que fraccion del clip cuenta como "apertura"/"final"
const DIP_ABS = 10; // el clip ABRE >=10 puntos de luma mas oscuro que su mediana...
const DIP_REL = 0.1; // ...y >=10% mas oscuro (relativo a su mediana)
const DARKENING_PCT = 8; // clipN >=8% mas oscuro que clip1 => oscurecimiento cumulativo
const INHERIT_TOL = 18; // |apertura(N+1) - ultimo(N)| < esto => la apertura hereda el ancla

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (flag) => {
    const i = a.indexOf(flag);
    return i !== -1 ? a[i + 1] : undefined;
  };
  return {
    sequenceId: get('--sequence'),
    campaignId: get('--campaign'),
    campaignName: get('--campaign-name'),
    last: Number(get('--last') ?? 6),
    verbose: a.includes('--verbose') || a.includes('-v'),
    dump: get('--dump'), // carpeta destino para volcar fotogramas (open/mid/end)
    refs: a.includes('--refs'), // inspecciona las referencias que alimentan cada clip
  };
}

// Ultimos 2 segmentos de un storage path, para legibilidad.
function shortPath(p) {
  if (!p) return p;
  const seg = p.split('/');
  return seg.slice(-2).join('/');
}

// Inspecciona QUE alimenta cada clip de la cadena: producto/personaje re-anclados
// vs el fotograma-puente heredado. Decide si el fix va al re-anclaje o al puente.
async function inspectChainRefs(admin, seq) {
  const campaignId = seq.clips[0]?.campaignId;
  console.log(`\n=== Referencias de la secuencia ${seq.sequenceId} ===`);

  const { data: items } = await admin
    .from('campaign_items')
    .select('id, scene_index, generation_id, character_id, character_ids, reference_ids, scene_prompt')
    .eq('sequence_id', seq.sequenceId)
    .order('scene_index', { ascending: true });
  if (!items?.length) {
    console.log('  (sin campaign_items)');
    return;
  }

  const genIds = items.map((i) => i.generation_id).filter(Boolean);
  const { data: gens } = await admin
    .from('generations')
    .select('id, model_id, prompt, params')
    .in('id', genIds);
  const genById = new Map((gens ?? []).map((g) => [g.id, g]));

  // Campana + brand kit (que es "el producto").
  const { data: camp } = await admin
    .from('campaigns')
    .select('id, name, brand_kit_id, product_brief')
    .eq('id', campaignId)
    .single();
  let kit;
  if (camp?.brand_kit_id) {
    const { data: k } = await admin
      .from('brand_kits')
      .select('id, name, product_image_ids, packaging_image_ids, reference_image_ids')
      .eq('id', camp.brand_kit_id)
      .single();
    kit = k;
  }

  // Personajes (la pareja podria ser un character con hoja maestra, o no existir).
  const charIds = [
    ...new Set(items.flatMap((i) => (i.character_ids?.length ? i.character_ids : i.character_id ? [i.character_id] : []))),
  ];
  let chars = [];
  if (charIds.length) {
    const { data: c } = await admin
      .from('characters')
      .select('id, name, master_image_id, reference_image_ids')
      .in('id', charIds);
    chars = c ?? [];
  }

  console.log(`  Campana: ${camp?.name ?? '?'}  brand_kit: ${kit?.name ?? (camp?.brand_kit_id ?? 'ninguno')}`);
  console.log(
    `  Brand kit imagenes -> producto: ${(kit?.product_image_ids ?? []).length}, ` +
      `packaging: ${(kit?.packaging_image_ids ?? []).length}, ref: ${(kit?.reference_image_ids ?? []).length}`,
  );
  if (chars.length) {
    for (const c of chars) {
      console.log(`  Personaje "${c.name}": master_image_id=${c.master_image_id ? 'SI' : 'NO'} (refs ${(c.reference_image_ids ?? []).length})`);
    }
  } else {
    console.log('  Personajes: NINGUNO registrado en los items (la pareja NO es un character con hoja maestra).');
  }

  console.log('\n  escena | operacion | refImgs | chain.product | chain.character | prevFrame | prompt');
  console.log('  -------+-----------+---------+---------------+-----------------+-----------+--------');
  for (const it of items) {
    const g = genById.get(it.generation_id);
    const p = g?.params ?? {};
    const chain = p.chain ?? {};
    const refs = p.referenceImagePaths ?? [];
    const op = p.operation ?? '(sin gen)';
    console.log(
      `  ${String(it.scene_index).padStart(6)} | ${String(op).padStart(9)} | ${String(refs.length).padStart(7)} | ` +
        `${String((chain.productImagePaths ?? []).length).padStart(13)} | ${String((chain.characterImagePaths ?? []).length).padStart(15)} | ` +
        `${(chain.prevFramePath ? 'si' : 'no').padStart(9)} | ${(g?.prompt ?? '').slice(0, 80).replace(/\s+/g, ' ')}`,
    );
    if (refs.length) {
      console.log(`           refs: ${refs.map(shortPath).join('  ')}`);
    }
  }
}

// Extrae apertura/medio/final de un clip a JPGs (por numero de cuadro, robusto
// sin duracion). Para inspeccion visual del look real cuando la percepcion y los
// numeros no coinciden.
async function extractFrames(buffer, frameCount, sceneIndex, dir) {
  return withTempVideo(buffer, async (file) => {
    const picks = [['open', 0.08], ['mid', 0.5], ['end', 0.94]];
    const out = [];
    for (const [tag, frac] of picks) {
      const idx = Math.max(0, Math.min(frameCount - 1, Math.round(frac * frameCount)));
      const outPath = join(dir, `esc${sceneIndex}_${tag}.jpg`);
      await runFfmpeg([
        '-loglevel', 'error', '-i', file,
        '-vf', `select=eq(n\\,${idx}),scale=480:-1`,
        '-frames:v', '1', '-y', outPath,
      ]);
      out.push(outPath);
    }
    return out;
  });
}

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Corre con: node --env-file=.env.local scripts/measure-chain-luma.mjs',
    );
    process.exit(1);
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Lanza ffmpeg y captura stdout (binario) + stderr (texto).
function runFfmpeg(args) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => (err += c.toString()));
    p.on('error', () => resolve({ code: -1, stdout: Buffer.alloc(0), stderr: 'spawn error' }));
    p.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
  });
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b; // Rec.709, escala 0-255
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

async function withTempVideo(buffer, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'chain-luma-'));
  const file = join(dir, 'clip.mp4');
  await writeFile(file, buffer);
  try {
    return await fn(file);
  } finally {
    await unlink(file).catch(() => {});
    await rmdir(dir).catch(() => {});
  }
}

// Mide el clip COMPLETO con signalstats (metadata=print -> stderr): da por
// fotograma luma (YAVG), saturacion (SATAVG), altas luces (YHIGH p90 / YMAX) y
// color medio (UAVG/VAVG). Mas informativo que promediar a 1 pixel (que borra la
// saturacion). Clips de pocos segundos: barato. Un solo proceso ffmpeg por clip.
async function measureClip(buffer) {
  return withTempVideo(buffer, async (file) => {
    const { stderr } = await runFfmpeg([
      '-loglevel', 'info',
      '-i', file,
      '-vf', 'signalstats,metadata=print',
      '-an', '-f', 'null', '-',
    ]);
    const grab = (key) => {
      const re = new RegExp(`lavfi\\.signalstats\\.${key}=([-\\d.]+)`, 'g');
      const vals = [];
      let m;
      while ((m = re.exec(stderr)) !== null) vals.push(Number(m[1]));
      return vals;
    };
    const Y = grab('YAVG'); // luma media por cuadro (0-255)
    const SAT = grab('SATAVG'); // saturacion media por cuadro
    const YHIGH = grab('YHIGH'); // luma p90 por cuadro (altas luces)
    const YMAX = grab('YMAX'); // luma maxima por cuadro (reventon)
    const U = grab('UAVG'); // croma azul-amarillo (128 = neutro)
    const V = grab('VAVG'); // croma rojo-verde (128 = neutro)
    if (Y.length < 2) {
      return { ok: false, frameCount: Y.length, err: stderr.split('\n').slice(-4).join(' | ').slice(-240) };
    }
    const n = Y.length;
    const k = Math.max(1, Math.round(n * OPEN_FRAC));
    const clipped = YMAX.length ? YMAX.filter((y) => y >= 250).length / YMAX.length : null; // % cuadros con reventon
    return {
      ok: true,
      frameCount: n,
      firstLuma: Y[0],
      lastLuma: Y[n - 1], // el fotograma que hereda el clip siguiente
      openLuma: mean(Y.slice(0, k)),
      endLuma: mean(Y.slice(-k)),
      medianLuma: median(Y),
      meanLuma: mean(Y),
      minLuma: Math.min(...Y),
      maxLuma: Math.max(...Y),
      satAvg: SAT.length ? mean(SAT) : null,
      satMax: SAT.length ? Math.max(...SAT) : null,
      yhighAvg: YHIGH.length ? mean(YHIGH) : null,
      clippedFrac: clipped,
      uAvg: U.length ? mean(U) : null,
      vAvg: V.length ? mean(V) : null,
      lum: Y,
    };
  });
}

// Distintos sequenceId de los videos chained mas recientes (orden por recencia).
async function resolveRecentSequenceIds(admin, n) {
  const { data, error } = await admin
    .from('generations')
    .select('params, created_at')
    .eq('type', 'video')
    .not('output_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(600);
  if (error) throw new Error(`query generations: ${error.message}`);
  const ids = [];
  for (const row of data ?? []) {
    const seq = row.params?.chain?.sequenceId;
    if (seq && !ids.includes(seq)) ids.push(seq);
    if (ids.length >= n) break;
  }
  return ids;
}

// Resuelve nombre de campana -> ids (ilike, puede haber varias homonimas).
async function resolveCampaignIdsByName(admin, name) {
  const { data, error } = await admin
    .from('campaigns')
    .select('id, name, created_at')
    .ilike('name', `%${name}%`)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`query campaigns: ${error.message}`);
  return data ?? [];
}

// Carga los clips de las secuencias pedidas: campaign_items (orden por
// scene_index) + su generacion (output_url, status).
async function loadSequences(admin, { sequenceIds, campaignIds }) {
  let q = admin
    .from('campaign_items')
    .select('id, sequence_id, scene_index, generation_id, campaign_id')
    .not('sequence_id', 'is', null)
    .not('generation_id', 'is', null);
  if (sequenceIds?.length) q = q.in('sequence_id', sequenceIds);
  if (campaignIds?.length) q = q.in('campaign_id', campaignIds);
  const { data: items, error } = await q;
  if (error) throw new Error(`query campaign_items: ${error.message}`);
  if (!items?.length) return [];

  const genIds = [...new Set(items.map((i) => i.generation_id))];
  const genById = new Map();
  for (let i = 0; i < genIds.length; i += 200) {
    const chunk = genIds.slice(i, i + 200);
    const { data: gens, error: gErr } = await admin
      .from('generations')
      .select('id, output_url, status, created_at')
      .in('id', chunk);
    if (gErr) throw new Error(`query generations: ${gErr.message}`);
    for (const g of gens ?? []) genById.set(g.id, g);
  }

  const bySeq = new Map();
  for (const it of items) {
    const g = genById.get(it.generation_id);
    const arr = bySeq.get(it.sequence_id) ?? [];
    arr.push({
      sceneIndex: it.scene_index ?? 0,
      campaignId: it.campaign_id,
      outputUrl: g?.output_url ?? null,
      status: g?.status ?? 'unknown',
      createdAt: g?.created_at ?? null,
    });
    bySeq.set(it.sequence_id, arr);
  }
  for (const arr of bySeq.values()) arr.sort((a, b) => a.sceneIndex - b.sceneIndex);
  return [...bySeq.entries()]
    .map(([id, clips]) => ({ sequenceId: id, clips }))
    .sort((a, b) => {
      const ta = Math.max(...a.clips.map((c) => Date.parse(c.createdAt ?? 0) || 0));
      const tb = Math.max(...b.clips.map((c) => Date.parse(c.createdAt ?? 0) || 0));
      return tb - ta;
    });
}

function fmt(x, d = 1) {
  return x === null || x === undefined ? ' -- ' : x.toFixed(d);
}

// Sparkline simple del perfil de brillo (12 puntos), para --verbose.
function sparkline(lum) {
  const bars = ' .:-=+*#%@';
  const pts = 12;
  const out = [];
  for (let i = 0; i < pts; i++) {
    const v = lum[Math.floor((i / pts) * lum.length)];
    out.push(bars[Math.max(0, Math.min(bars.length - 1, Math.floor((v / 255) * (bars.length - 1))))]);
  }
  return out.join('');
}

async function analyzeSequence(admin, seq, opts) {
  const cName = opts.campaignNames?.get(seq.clips[0]?.campaignId);
  console.log(`\n=== Secuencia ${seq.sequenceId}${cName ? ` (campana: ${cName})` : ''} ===`);
  const measured = [];
  for (const clip of seq.clips) {
    if (clip.status !== 'done' || !clip.outputUrl) {
      console.log(`  escena ${clip.sceneIndex}: SIN medir (status=${clip.status}, output=${clip.outputUrl ? 'si' : 'no'})`);
      continue;
    }
    const { data, error } = await admin.storage.from(OUTPUTS_BUCKET).download(clip.outputUrl);
    if (error || !data) {
      console.log(`  escena ${clip.sceneIndex}: descarga fallo (${error?.message ?? 'sin data'})`);
      continue;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    try {
      const m = await measureClip(buffer);
      if (!m.ok) {
        console.log(`  escena ${clip.sceneIndex}: sin fotogramas (${m.err ?? 'frameCount=' + m.frameCount})`);
        continue;
      }
      measured.push({ sceneIndex: clip.sceneIndex, ...m });
      if (opts.dumpDir) {
        const files = await extractFrames(buffer, m.frameCount, clip.sceneIndex, opts.dumpDir);
        console.log(`    [dump] escena ${clip.sceneIndex}: ${files.map((f) => f.split(/[\\/]/).pop()).join(', ')}`);
      }
      if (opts.verbose) {
        console.log(
          `    [v] escena ${clip.sceneIndex} (${m.frameCount}f)  [${sparkline(m.lum)}]  ` +
            `open=${fmt(m.openLuma)} med=${fmt(m.medianLuma)} end=${fmt(m.endLuma)} ult=${fmt(m.lastLuma)}  ` +
            `SAT=${fmt(m.satAvg)} YHIGH=${fmt(m.yhighAvg)} reventon=${m.clippedFrac === null ? '--' : fmt(m.clippedFrac * 100) + '%'}`,
        );
      }
    } catch (e) {
      console.log(`  escena ${clip.sceneIndex}: medicion fallo (${e.message})`);
    }
  }

  if (measured.length < 2) {
    console.log('  Menos de 2 clips medibles: no se puede evaluar deriva en esta secuencia.');
    return;
  }

  // Tabla: luma (apertura/cuerpo/final), saturacion, altas luces, reventon.
  console.log('\n  escena | apertura | mediana |  final | luz(SAT) | altas(YHIGH) | reventon | open-vs-cuerpo');
  console.log('  -------+----------+---------+--------+----------+--------------+----------+----------------');
  const dipClips = [];
  for (const m of measured) {
    const dip = m.openLuma - m.medianLuma; // negativo = abre mas oscuro que su cuerpo
    const isDip = Math.abs(dip) >= DIP_ABS && Math.abs(dip) >= DIP_REL * m.medianLuma;
    if (isDip) dipClips.push(m.sceneIndex);
    console.log(
      `  ${String(m.sceneIndex).padStart(6)} | ${fmt(m.openLuma).padStart(8)} | ${fmt(m.medianLuma).padStart(7)} | ` +
        `${fmt(m.endLuma).padStart(6)} | ${fmt(m.satAvg).padStart(8)} | ${fmt(m.yhighAvg).padStart(12)} | ` +
        `${(m.clippedFrac === null ? '--' : fmt(m.clippedFrac * 100) + '%').padStart(8)} | ${fmt(dip).padStart(13)}${isDip ? '*' : ' '}`,
    );
  }

  // Senal 1: oscurecimiento cumulativo (medianas clip a clip).
  const medians = measured.map((m) => m.medianLuma);
  let drops = 0;
  for (let i = 1; i < medians.length; i++) if (medians[i] < medians[i - 1]) drops++;
  const endVsStartPct = medians[0] ? ((medians[medians.length - 1] - medians[0]) / medians[0]) * 100 : 0;
  const cumulativeDarkening = endVsStartPct <= -DARKENING_PCT;

  // Senal 3: la apertura del clip N+1 sigue al ultimo fotograma del clip N.
  const inheritDeltas = [];
  for (let i = 0; i < measured.length - 1; i++) {
    inheritDeltas.push({
      from: measured[i].sceneIndex,
      to: measured[i + 1].sceneIndex,
      anchor: measured[i].lastLuma,
      nextOpen: measured[i + 1].openLuma,
      delta: measured[i + 1].openLuma - measured[i].lastLuma,
    });
  }
  const inheritsAnchor =
    inheritDeltas.length > 0 &&
    mean(inheritDeltas.map((d) => Math.abs(d.delta))) < INHERIT_TOL;

  // Senal 4: saturacion y altas luces por clip; foco en la ULTIMA escena.
  const sats = measured.map((m) => m.satAvg ?? 0);
  const highs = measured.map((m) => m.yhighAvg ?? 0);
  const last = measured[measured.length - 1];
  const restMaxSat = Math.max(...sats.slice(0, -1));
  const restMaxHigh = Math.max(...highs.slice(0, -1));
  const lastIsMostSat = (last.satAvg ?? 0) >= restMaxSat;
  const lastIsBrightest = (last.yhighAvg ?? 0) >= restMaxHigh;
  const satRisePct = sats[0] ? ((sats[sats.length - 1] - sats[0]) / sats[0]) * 100 : 0;

  // Senal 5: viraje de color (UAVG/VAVG; 128 = neutro).
  const du = (last.uAvg ?? 128) - (measured[0].uAvg ?? 128);
  const dv = (last.vAvg ?? 128) - (measured[0].vAvg ?? 128);
  const colorDrift = Math.abs(du) >= 4 || Math.abs(dv) >= 4;

  console.log('\n  --- Diagnostico de esta secuencia ---');
  console.log(
    `  1) Oscurecimiento cumulativo: clip1 mediana=${fmt(medians[0])} -> clipN mediana=${fmt(medians[medians.length - 1])} ` +
      `(${fmt(endVsStartPct)}%, ${drops}/${medians.length - 1} bajadas): ${cumulativeDarkening ? 'SI' : 'no'}.`,
  );
  console.log(
    `  2) Clips con apertura desviada de su cuerpo (arranque hereda el ancla): ` +
      `${dipClips.length ? `escenas [${dipClips.join(', ')}]` : 'no'} (umbral ${DIP_ABS} abs + ${DIP_REL * 100}% rel).`,
  );
  console.log('  3) Herencia ancla->apertura (ultimo fotograma del clip N -> apertura del N+1):');
  for (const d of inheritDeltas) {
    console.log(`        escena ${d.from} ult=${fmt(d.anchor)} -> escena ${d.to} abre=${fmt(d.nextOpen)} (delta ${fmt(d.delta)})`);
  }
  console.log(`     La apertura sigue al ancla heredada: ${inheritsAnchor ? 'SI (mecanismo confirmado)' : 'no claro'}.`);
  console.log(
    `  4) Saturacion: por clip [${sats.map((s) => fmt(s)).join(', ')}] (cambio clip1->clipN ${fmt(satRisePct)}%). ` +
      `La ULTIMA escena es la mas saturada: ${lastIsMostSat ? 'SI' : 'no'}.`,
  );
  console.log(
    `     Altas luces (YHIGH p90): [${highs.map((h) => fmt(h)).join(', ')}]. ` +
      `Reventon (cuadros con YMAX>=250): [${measured.map((m) => (m.clippedFrac === null ? '--' : fmt(m.clippedFrac * 100) + '%')).join(', ')}]. ` +
      `Ultima escena la mas brillante en altas: ${lastIsBrightest ? 'SI' : 'no'}.`,
  );
  console.log(`  5) Viraje de color (dU=${fmt(du)}, dV=${fmt(dv)}; 128=neutro): ${colorDrift ? 'SI' : 'no'}.`);

  console.log('\n  --- Lectura ---');
  if (lastIsMostSat || lastIsBrightest) {
    console.log(
      `  => La ULTIMA escena es la mas ${lastIsMostSat ? 'saturada' : ''}${lastIsMostSat && lastIsBrightest ? ' y ' : ''}${lastIsBrightest ? 'brillante (altas luces)' : ''} de la cadena: ` +
        'coincide con tu percepcion de "mucha exposicion/saturacion al final".',
    );
  }
  if (dipClips.length && inheritsAnchor) {
    console.log('  => Confirmado: la apertura de cada clip hereda el brillo del fotograma anterior y luego se reexpone');
    console.log('     (esc1 abre oscura; esc2 abre brillante). Inestabilidad de exposicion por el ancla, no oscurecimiento cumulativo.');
  } else if (cumulativeDarkening) {
    console.log('  => Oscurecimiento cumulativo real: cada clip mas oscuro que el anterior.');
  }
  if (colorDrift) console.log('     Hay viraje de color: un fix de solo-luma no lo cubre.');
}

async function main() {
  const args = parseArgs();
  const admin = getAdmin();

  let target;
  const campaignNames = new Map();
  if (args.sequenceId) {
    target = { sequenceIds: [args.sequenceId] };
  } else if (args.campaignId) {
    target = { campaignIds: [args.campaignId] };
  } else if (args.campaignName) {
    const camps = await resolveCampaignIdsByName(admin, args.campaignName);
    if (!camps.length) {
      console.error(`No hay campanas que coincidan con "${args.campaignName}".`);
      process.exit(1);
    }
    console.log(`Campanas coincidentes con "${args.campaignName}": ${camps.length}`);
    for (const c of camps) {
      campaignNames.set(c.id, c.name);
      console.log(`  - ${c.name}  (${c.id})`);
    }
    target = { campaignIds: camps.map((c) => c.id) };
  } else {
    const ids = await resolveRecentSequenceIds(admin, args.last);
    if (!ids.length) {
      console.error('No se encontraron secuencias chained recientes. Pasa --campaign-name, --campaign o --sequence.');
      process.exit(1);
    }
    console.log(`Sin args: escaneando las ${ids.length} cadenas mas recientes.`);
    target = { sequenceIds: ids };
  }

  const sequences = await loadSequences(admin, target);
  if (!sequences.length) {
    console.error('No se encontraron clips para esos criterios.');
    process.exit(1);
  }
  if (args.refs) {
    console.log(`Secuencias a inspeccionar: ${sequences.length}`);
    for (const seq of sequences) await inspectChainRefs(admin, seq);
    console.log('\nListo (inspeccion de referencias).');
    return;
  }

  let dumpDir;
  if (args.dump) {
    dumpDir = args.dump;
    await mkdir(dumpDir, { recursive: true });
    console.log(`Volcando fotogramas a: ${dumpDir}`);
  }
  console.log(`Secuencias a medir: ${sequences.length}${args.verbose ? ' (verbose)' : ''}`);
  for (const seq of sequences) await analyzeSequence(admin, seq, { verbose: args.verbose, campaignNames, dumpDir });
  console.log('\nListo. Comparte la tabla y el diagnostico para decidir el fix.');
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
