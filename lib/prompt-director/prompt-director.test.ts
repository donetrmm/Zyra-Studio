import { describe, it, expect } from 'vitest';
import { compile } from './index';
import { stripSlop } from './antislop';
import { findClaims, stripAgeWords } from './inventory';
import { fromFormatRow, resolveRequiredRefs } from './format-director';
import type { DirectorContext, FormatDirection } from './types';

// ============ Fixtures ============
// Formatos reflejando el seed de 023 (en producción vienen de la tabla).

const vozCercana: FormatDirection = fromFormatRow({
  slug: 'voz-cercana',
  name: 'Voz Cercana',
  register: 'casual, conversacional, primera persona; guion de una idea, máximo ~25 palabras',
  camera_style: 'selfie handheld a nivel de ojos, toma única continua, luz natural imperfecta',
  pacing: 'pausado y natural, sin cortes',
  required_refs: ['product', 'character'],
  default_duration_s: 9,
  default_audio: true,
});

const elIcono: FormatDirection = fromFormatRow({
  slug: 'el-icono',
  name: 'El Ícono',
  register: 'estilizado, bold, beat-driven',
  camera_style: 'órbitas, whip pans, speed ramps, match cuts; fondos abstractos o minimales',
  pacing: 'rápido, cortes al beat',
  required_refs: ['product'],
  default_duration_s: 8,
  default_audio: true,
});

function fullContext(): DirectorContext {
  return {
    format: vozCercana,
    product: {
      name: 'Lumen Sparkling Water',
      visualDetails: 'slim aluminum can, matte teal finish, white wordmark',
      palette: ['teal', 'white'],
      imagePaths: ['references/ws1/product-front.png', 'references/ws1/product-side.png'],
    },
    characters: [{
      name: 'Maya',
      description: 'creator with curly dark hair, relaxed linen shirt, warm easygoing delivery',
      masterImagePath: 'references/ws1/maya-master.png',
    }],
    scene: { name: 'Cocina luminosa', fragment: 'a sunlit home kitchen, warm morning light through a window' },
  };
}

// ============ compile() — Seedance ============

describe('compile seedance', () => {
  it('produce prompt CRAFT con referencias @ numeradas en orden', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'She lifts the can toward the camera, takes a sip and smiles with an easy nod',
        durationS: 8,
        aspectRatio: '9:16',
      },
      fullContext(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt, references, params } = res.compiled;

    // Orden: producto (2 imágenes) → personaje (1) ⇒ @image1..3 (minúscula: formato oficial Atlas)
    expect(references.map((r) => r.role)).toEqual(['product', 'product', 'character']);
    expect(prompt).toContain('@image1 is the product');
    expect(prompt).toContain('@image3 is Maya');
    // Fidelidad y escena
    expect(prompt).toContain('exact packaging');
    // Estabilidad temporal del producto (#B): no morphing a lo largo del clip.
    expect(prompt).toMatch(/identical in every frame/i);
    expect(prompt).toContain('sunlit home kitchen');
    // Dirección del formato
    expect(prompt).toContain('selfie handheld');
    // Cláusula negativa fija
    expect(prompt).toContain('No on-screen text');
    expect(prompt).toContain('No real identifiable faces');
    // Params
    expect(params.operation).toBe('reference2video');
    expect(params.duration).toBe(8);
    expect(params.aspectRatio).toBe('9:16');
    expect(params.generateAudio).toBe(true);
  });

  it('con diálogo explícito y audio: encabezado, lip sync y voz natural anti-robótica', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: '0-4s: she lifts the can to camera. Dialogue: "Esto cambió mis mañanas." 4-9s: she takes a sip and nods',
        durationS: 9,
        aspectRatio: '9:16',
      },
      fullContext(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt } = res.compiled;
    // Encabezado con duración y orientación, primero.
    expect(prompt.startsWith('A 9-second vertical (9:16) commercial video')).toBe(true);
    // Lip sync / habla en cámara (no narración).
    expect(prompt).toContain('Synchronized on-camera speech, not voice-over narration');
    // Voz natural anti-robótica.
    expect(prompt).toContain('natural Mexican accent');
    expect(prompt).toContain('Avoid robotic speech');
  });

  it('sin diálogo explícito no hay dirección de lip sync (aunque haya personajes)', () => {
    // generateAudio: false → ni lip sync ni directiva de idioma.
    const silent = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'Dialogue: "Hola" — she waves',
        generateAudio: false,
      },
      fullContext(),
    );
    expect(silent.ok).toBe(true);
    if (silent.ok) expect(silent.compiled.prompt).not.toContain('Synchronized on-camera speech');

    // Personaje en escena pero SIN diálogo pedido: no se fuerza el habla
    // (decisión 2026-06-12: diálogos solo si el usuario los pide o los da).
    const withCast = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'She lifts the can toward the camera and smiles with an easy nod',
      },
      fullContext(),
    );
    expect(withCast.ok).toBe(true);
    if (withCast.ok) expect(withCast.compiled.prompt).not.toContain('Synchronized on-camera speech');

    // Sin personajes ni diálogo (el-icono): audio sí, lip sync no.
    const ctx = fullContext();
    ctx.characters = undefined;
    ctx.format = elIcono;
    const noSpeaker = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The can spins on marble and stops label-forward' },
      ctx,
    );
    expect(noSpeaker.ok).toBe(true);
    if (noSpeaker.ok) expect(noSpeaker.compiled.prompt).not.toContain('Synchronized on-camera speech');
  });

  it('recorta solo la acción para garantizar ≤4000, preservando las cláusulas finales', () => {
    const huge = '0-3s: Brenda stares into the camera as the LED wall scrolls endless family photographs. '.repeat(80);
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: `${huge} Dialogue: "No la pierdas."`,
        durationS: 15,
        aspectRatio: '9:16',
      },
      fullContext(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt, warnings } = res.compiled;
    // Garantía dura: el prompt compilado nunca supera el cap de SubmitSeedanceSchema.
    expect(prompt.length).toBeLessThanOrEqual(4000);
    // Las cláusulas finales obligatorias sobreviven al recorte de la acción.
    expect(prompt).toContain('No on-screen text');
    expect(prompt).toContain('natural Mexican accent');
    expect(warnings.some((w) => w.includes('se recortó'))).toBe(true);
  });

  it('el diálogo hablado va en español por default y en inglés si la campaña lo pide', () => {
    const req = {
      modelSlug: 'bytedance/seedance-2.0/reference-to-video',
      scenePrompt: 'She shares a one-sentence take to camera',
      durationS: 6,
    };
    const es = compile(req, fullContext());
    expect(es.ok).toBe(true);
    if (es.ok) expect(es.compiled.prompt).toContain('must be in Spanish');

    const en = compile(req, { ...fullContext(), language: 'en' as const });
    expect(en.ok).toBe(true);
    if (en.ok) {
      expect(en.compiled.prompt).toContain('must be in English');
      expect(en.compiled.prompt).not.toContain('must be in Spanish');
    }

    // Sin audio no hay diálogo que dirigir.
    const silent = compile({ ...req, generateAudio: false }, fullContext());
    expect(silent.ok).toBe(true);
    if (silent.ok) expect(silent.compiled.prompt).not.toContain('must be in Spanish');
  });

  it('plantilla viva entra como @video1 con rol camera_motion', () => {
    const ctx = { ...fullContext(), templateVideoPath: 'references/ws1/winner.mp4' };
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The can rotates on marble', durationS: 6 },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const video = res.compiled.references.find((r) => r.kind === 'video');
    expect(video?.role).toBe('camera_motion');
    expect(res.compiled.prompt).toContain('@video1 is the structural reference');
  });

  it('sin referencias → operation text2video', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/fast/text-to-video', scenePrompt: 'A teal can on wet stone, slow orbit' },
      {},
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.params.operation).toBe('text2video');
    expect(res.compiled.params.resolution).toBe('480p'); // default draft en fast
  });

  it('el presupuesto nunca excede 9 imágenes ni 12 archivos totales', () => {
    // Peor caso real:
    //   producto     3 imágenes   (imagePaths)
    //   empaque      2 imágenes   (packagingImagePaths)
    //   personaje    1 master + 2 ángulos = 3 imágenes
    //   extras       2 imágenes   (extraImagePaths)
    //   templateVideo  1 archivo
    //   audioRef       1 archivo
    // Total sin recorte: 10 imágenes + 1 video + 1 audio = 12 archivos
    // El tope de 9 imágenes debe recortar las extras (quedan 9 img); total ≤ 12.
    const ctx = fullContext();
    ctx.product!.imagePaths = ['p1.png', 'p2.png', 'p3.png'];
    ctx.product!.packagingImagePaths = ['pack1.png', 'pack2.png'];
    ctx.characters = [{
      name: 'Maya',
      description: 'curly dark hair, relaxed linen shirt',
      masterImagePath: 'maya-master.png',
      angleImagePaths: ['maya-a1.png', 'maya-a2.png'],
    }];
    ctx.extraImagePaths = ['x1.png', 'x2.png'];
    ctx.templateVideoPath = 'v.mp4';
    ctx.audioRefPath = 'a.mp3';
    ctx.format = { ...vozCercana, requiredRefs: ['product', 'character', 'packaging'] };

    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'She opens the can' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const images = res.compiled.references.filter((r) => r.kind === 'image');
    expect(images.length).toBeLessThanOrEqual(9);
    expect(res.compiled.references.length).toBeLessThanOrEqual(12);

    // Orden: imágenes primero, luego video, luego audio
    const kinds = res.compiled.references.map((r) => r.kind);
    const firstVideo = kinds.indexOf('video');
    const firstAudio = kinds.indexOf('audio');
    const lastImage = kinds.lastIndexOf('image');
    if (firstVideo !== -1 && lastImage !== -1) expect(lastImage).toBeLessThan(firstVideo);
    if (firstAudio !== -1 && firstVideo !== -1) expect(firstVideo).toBeLessThan(firstAudio);
    if (firstAudio !== -1 && lastImage !== -1) expect(lastImage).toBeLessThan(firstAudio);
  });

  it('dos personajes: master + 1 ángulo cada uno, con nombre en la línea @', () => {
    const ctx = fullContext();
    ctx.characters = [
      { name: 'Maya', description: 'curly dark hair', masterImagePath: 'm1.png', angleImagePaths: ['m1a.png', 'm1b.png'] },
      { name: 'Leo', description: 'short beard, denim shirt', masterImagePath: 'm2.png', angleImagePaths: ['m2a.png'] },
    ];
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'They toast with the can' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const charRefs = res.compiled.references.filter((r) => r.role === 'character');
    expect(charRefs.map((r) => r.storagePath)).toEqual(['m1.png', 'm1a.png', 'm2.png', 'm2a.png']);
    expect(res.compiled.prompt).toContain('is Maya');
    expect(res.compiled.prompt).toContain('is Leo');
  });

  it('tres personajes: solo master cada uno', () => {
    const ctx = fullContext();
    ctx.characters = [
      { name: 'A', description: 'd', masterImagePath: 'a.png', angleImagePaths: ['a1.png'] },
      { name: 'B', description: 'd', masterImagePath: 'b.png', angleImagePaths: ['b1.png'] },
      { name: 'C', description: 'd', masterImagePath: 'c.png', angleImagePaths: ['c1.png'] },
    ];
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The three react to the product' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const charRefs = res.compiled.references.filter((r) => r.role === 'character');
    expect(charRefs.map((r) => r.storagePath)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it('extraImagePaths entran como environment al final y el tope de 9 imágenes recorta con warning', () => {
    const ctx = fullContext();
    ctx.product!.imagePaths = ['p1.png', 'p2.png', 'p3.png'];
    ctx.product!.packagingImagePaths = ['k1.png', 'k2.png'];
    ctx.format = { ...ctx.format!, requiredRefs: ['product', 'character', 'packaging'] };
    ctx.characters = [{ name: 'Maya', description: 'd', masterImagePath: 'm.png', angleImagePaths: ['ma1.png', 'ma2.png'] }];
    ctx.extraImagePaths = ['x1.png', 'x2.png'];
    // 3 producto + 2 empaque + 3 personaje = 8 → solo cabe 1 extra
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'She opens the can' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const images = res.compiled.references.filter((r) => r.kind === 'image');
    expect(images).toHaveLength(9);
    expect(images[8].role).toBe('environment');
    expect(images[8].storagePath).toBe('x1.png');
    expect(res.compiled.warnings.some((w) => w.includes('tope de 9'))).toBe(true);
  });

  it('formato que pide personaje sin Cast ya NO bloquea (se inventa en el prompt)', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'The presenter is a person with auburn hair. She presents the can',
      },
      { format: vozCercana, product: fullContext().product },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.warnings.some((w) => w.includes('identidad'))).toBe(true);
  });

  it('producto sin imágenes: fidelidad por atributos, sin apuntar a imágenes inexistentes (#4)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/text-to-video', scenePrompt: 'The can rests on a marble counter' },
      { product: { name: 'Lumen', visualDetails: 'slim teal aluminum can', imagePaths: [] } },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt } = res.compiled;
    expect(prompt).not.toContain('as shown in its reference images');
    expect(prompt).toContain('declared attributes');
  });

  it('personaje con hoja maestra: vestuario sigue a la descripción, sin contradecir la referencia (#5)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'She lifts the can and smiles' },
      fullContext(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt } = res.compiled;
    expect(prompt).toContain('@image3 is Maya');
    // Ya no se ordena "wardrobe follows the scene" a secas (contradecía la descripción).
    expect(prompt).not.toContain('wardrobe and expression follow the scene description');
    expect(prompt).toContain("Wardrobe and expression follow Maya's description");
  });

  it('personaje inventado (sin hoja maestra): apariencia por descripción, sin imagen inexistente (#4 análogo)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The presenter holds the can to camera' },
      {
        product: fullContext().product,
        characters: [{ name: 'Nora', description: 'auburn hair, denim jacket, calm delivery', masterImagePath: '' }],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt } = res.compiled;
    expect(prompt).toContain('Nora: auburn hair');
    expect(prompt).not.toContain('as in the character reference image');
    expect(prompt).toContain('Keep this exact appearance consistent');
  });

  it('personaje con hoja maestra pero SIN descripción: warning y sin línea vacía (#7)', () => {
    const ctx = fullContext();
    ctx.characters = [{ name: 'Mara', description: '   ', masterImagePath: 'm.png' }];
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'She lifts the can' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt, warnings } = res.compiled;
    // No se mete la línea descriptiva vacía 'Mara: .'
    expect(prompt).not.toMatch(/Mara:\s*\./);
    // Pero la @image del Cast SÍ ancla la cara.
    expect(prompt).toContain('is Mara');
    expect(warnings.join(' ')).toMatch(/identidad: Mara/);
  });
});

// ============ Cinematografía por defecto (#A) ============

describe('cinematografía por defecto', () => {
  const fmtNoLight = (register: string, camera = 'a nivel de ojos') =>
    fromFormatRow({
      slug: 'x', name: 'X', register, camera_style: camera, pacing: 'natural',
      required_refs: ['product'], default_duration_s: 8, default_audio: true,
    });
  const product = { name: 'Lumen', imagePaths: ['p1.png'] };
  const run = (ctx: DirectorContext, scenePrompt = 'She lifts the can and smiles') =>
    compile({ modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt }, ctx);

  it('UGC/handheld → luz natural y foco profundo', () => {
    const res = run({ format: fmtNoLight('casual, conversacional UGC'), product });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/natural available light/);
  });

  it('hero/cinematic → key light controlada y DOF corto', () => {
    const res = run({ format: fmtNoLight('cinematográfico, épico'), product }, 'The can sits on a table');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/controlled key light/);
  });

  it('formato estilizado no recibe default de luz', () => {
    const res = run({ format: elIcono, product }, 'The can floats in a surreal void');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).not.toMatch(/Cinematography:/);
  });

  it('no duplica si el formato ya dirige la luz (vozCercana trae "luz natural")', () => {
    const res = run(fullContext());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).not.toMatch(/Cinematography:/);
  });

  it('no aplica cuando hay referencia de look/entorno (el modelo extrae la luz de ahí)', () => {
    const res = run({ format: fmtNoLight('casual UGC', ''), product, extraImagePaths: ['style-ref.png'] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).not.toMatch(/Cinematography:/);
  });
});

// ============ Audio por registro (#2/#3) ============

describe('dirección de audio por registro', () => {
  const product = { name: 'Lumen', imagePaths: ['p1.png'] };
  const fmt = (register: string) =>
    fromFormatRow({
      slug: 'x', name: 'X', register, camera_style: '', pacing: '',
      required_refs: ['product'], default_duration_s: 8, default_audio: true,
    });

  it('ASMR/susurro → foley sin música (#2)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The can opens slowly' },
      { format: fmt('ASMR, susurro, macro'), product },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/Foley-forward/);
  });

  it('beat-driven → cama musical al ritmo (#2)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The can spins' },
      { format: elIcono, product },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/rhythmic music bed/);
  });

  it('registro neutro → diegético sin música (#2)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The can on a table' },
      { format: fmt('documental sobrio'), product },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/natural diegetic sound/);
  });

  it('voz con registro bold → tono punchy además de la cadencia base (#3)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'A presenter says one line to camera' },
      { format: elIcono, product },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('natural Mexican accent'); // cadencia base
    expect(res.compiled.prompt).toMatch(/punchy/); // tono por registro
  });
});

// ============ Validadores ============

describe('validators', () => {
  it('bloquea cuando faltan referencias obligatorias del formato (product bloquea; character ya no bloquea)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/text-to-video', scenePrompt: 'She sips and smiles' },
      { format: vozCercana }, // sin product ni character
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // product sigue siendo un bloqueo duro
    expect(res.errors.join(' ')).toMatch(/product/);
    // character ya no bloquea: el planner inyecta un personaje inventado en el scene_prompt
    expect(res.errors.join(' ')).not.toMatch(/character/);
  });

  it('bloquea scene_prompt vacío y duración fuera de rango', () => {
    const empty = compile({ modelSlug: 'bytedance/seedance-2.0/text-to-video', scenePrompt: '  ' }, {});
    expect(empty.ok).toBe(false);

    const tooLong = compile(
      { modelSlug: 'bytedance/seedance-2.0/text-to-video', scenePrompt: 'A can on stone', durationS: 20 },
      {},
    );
    expect(tooLong.ok).toBe(false);
  });

  it('avisa complejidad excesiva para la duración (1 idea ≈ 4s)', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/text-to-video',
        scenePrompt:
          'She opens the fridge. She grabs the can. She walks to the window. She opens it and pours a glass. She drinks and laughs.',
        durationS: 4,
      },
      {},
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.warnings.join(' ')).toMatch(/complejidad/);
  });

  it('avisa por más de 2 movimientos de cámara distintos', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/text-to-video',
        scenePrompt: 'The camera dolly in, then orbits the can, then a whip pan to the window with a zoom',
      },
      {},
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.warnings.join(' ')).toMatch(/cámara/);
  });

  it('avisa persona sin referencia del Cast', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/text-to-video', scenePrompt: 'A creator holds the can and talks to camera' },
      {},
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.warnings.join(' ')).toMatch(/identidad/);
  });

  it('avisa 3+ sujetos, texto en pantalla, claims y ritmo incoherente', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/text-to-video',
        scenePrompt:
          'Three friends in slow motion with frenetic fast cuts, a caption appears saying clinically proven',
      },
      {},
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const all = res.compiled.warnings.join(' | ');
    expect(all).toMatch(/sujetos/);
    expect(all).toMatch(/texto en pantalla/);
    expect(all).toMatch(/claims/);
    expect(all).toMatch(/ritmo/);
  });
});

// ============ Antislop e inventario ============

describe('antislop', () => {
  it('remueve slop y limpia restos', () => {
    const { text, removed } = stripSlop('A breathtaking, stunning shot of the can, 8k, masterpiece, on marble');
    expect(removed).toContain('breathtaking');
    expect(removed).toContain('8k');
    expect(removed).toContain('masterpiece');
    expect(text).not.toMatch(/breathtaking|8k|masterpiece/i);
    expect(text).toContain('the can');
  });

  it('compile aplica antislop al prompt final con warning', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/text-to-video', scenePrompt: 'A breathtaking orbit around the can' },
      {},
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).not.toMatch(/breathtaking/i);
    expect(res.compiled.warnings.join(' ')).toMatch(/antislop/);
  });
});

describe('inventory', () => {
  it('detecta claims en inglés y español', () => {
    expect(findClaims('clinically proven and 10x faster')).toHaveLength(2);
    expect(findClaims('resultado garantizado')).toHaveLength(1);
    expect(findClaims('a refreshing drink')).toHaveLength(0);
  });

  it('stripAgeWords limpia marcadores de edad', () => {
    const { text, removed } = stripAgeWords('a young creator with curly hair');
    expect(removed).toContain('young');
    expect(text).not.toMatch(/young/);
    expect(text).toContain('creator with curly hair');
  });
});

// ============ Formatos ============

describe('format-director', () => {
  it('resolveRequiredRefs reporta faltantes con mensaje accionable (solo product bloquea; character ya no)', () => {
    const { missing } = resolveRequiredRefs(vozCercana, {});
    // vozCercana requiere product y character; character ya no genera faltante
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/Brand Kit/);
  });

  it('formato sin personaje requerido compila solo con producto', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The can spins and stops label-forward' },
      {
        format: elIcono,
        product: { name: 'Lumen', imagePaths: ['p1.png'] },
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.references.every((r) => r.role === 'product')).toBe(true);
    expect(res.compiled.prompt).toContain('órbitas');
  });
});

// ============ Criterio de cierre: los 9 formatos compilan ============

describe('los 9 formatos Zyra compilan con Seedance', () => {
  // Espejo compacto del seed 023 (slug, required_refs, duración).
  const NINE: Array<{ slug: string; refs: string[]; d: number }> = [
    { slug: 'voz-cercana', refs: ['product', 'character'], d: 9 },
    { slug: 'a-pie-de-calle', refs: ['product', 'character'], d: 12 },
    { slug: 'manos-a-la-obra', refs: ['product'], d: 12 },
    { slug: 'el-descubrimiento', refs: ['product', 'packaging'], d: 10 },
    { slug: 'antes-y-despues', refs: ['product'], d: 8 },
    { slug: 'susurro', refs: ['product'], d: 10 },
    { slug: 'el-icono', refs: ['product'], d: 8 },
    { slug: 'gran-pantalla', refs: ['product'], d: 15 },
    { slug: 'mundo-imposible', refs: ['product'], d: 10 },
  ];

  it.each(NINE)('$slug compila ok con contexto completo', ({ slug, refs, d }) => {
    const format = fromFormatRow({
      slug,
      name: slug,
      register: 'registro del formato',
      camera_style: 'cámara del formato',
      pacing: 'ritmo del formato',
      required_refs: refs,
      default_duration_s: d,
      default_audio: true,
    });
    const ctx = fullContext();
    ctx.format = format;
    ctx.product!.packagingImagePaths = ['references/ws1/pack.png'];
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'She lifts the can and smiles', durationS: d },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt.length).toBeGreaterThan(100);
    expect(res.compiled.params.duration).toBe(d);
    expect(res.compiled.references.length).toBeGreaterThan(0);
  });
});

// ============ Compilers de imagen y video V1 ============

describe('compile flux', () => {
  it('mapea aspect ratio a width/height y agrega iluminación default', () => {
    const res = compile(
      { modelSlug: 'flux-2-pro', scenePrompt: 'The teal can on a marble counter with citrus slices', aspectRatio: '16:9' },
      { product: { name: 'Lumen', imagePaths: ['p1.png'] } },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.params.width).toBe(1344);
    expect(res.compiled.params.height).toBe(768);
    expect(res.compiled.prompt).toMatch(/lighting/i);
  });
});

describe('compile nano-banana (edición)', () => {
  it('agrega cláusula de preservación y fidelidad de producto', () => {
    const res = compile(
      { modelSlug: 'gemini-3-pro-image-preview', scenePrompt: 'Replace the background with a beach at sunset' },
      { product: { name: 'Lumen', imagePaths: ['p1.png'] } },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('Keep everything else exactly the same');
    expect(res.compiled.prompt).toContain('never restyle the product');
  });

  it('avisa cuando hay más de un cambio en la misma instrucción', () => {
    const res = compile(
      {
        modelSlug: 'gemini-3-pro-image-preview',
        scenePrompt: 'Replace the background with a beach. Add a lemon slice. Remove the shadow',
      },
      {},
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.warnings.join(' ')).toMatch(/un cambio por iteración/);
  });
});

describe('compile veo y kling', () => {
  it('veo clampa duración a 4/6/8 y ratio a 16:9|9:16 con warnings', () => {
    const res = compile(
      { modelSlug: 'veo-3.1-generate-preview', scenePrompt: 'The can pours into a glass', durationS: 7, aspectRatio: '1:1' },
      {},
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([4, 6, 8]).toContain(res.compiled.params.durationSeconds);
    expect(['16:9', '9:16']).toContain(res.compiled.params.aspectRatio);
    expect(res.compiled.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('kling clampa duración a 5-10', () => {
    const res = compile(
      { modelSlug: 'fal-ai/kling-video/v3/standard/text-to-video', scenePrompt: 'The can pours into a glass', durationS: 14 },
      {},
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.params.duration).toBe(10);
  });

  it('modelo desconocido → error claro', () => {
    const res = compile({ modelSlug: 'sora-2', scenePrompt: 'x' }, {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatch(/no soportado/);
  });
});
