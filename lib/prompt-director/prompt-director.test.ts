import { describe, it, expect } from 'vitest';
import { compile, onlyCharacterRefs } from './index';
import { stripSlop } from './antislop';
import { findClaims, stripAgeWords } from './inventory';
import { fromFormatRow, resolveRequiredRefs } from './format-director';
import type { CompileRequest, DirectorContext, FormatDirection } from './types';

// El storyboard generaba paneles FLUX y "perdía el hilo del personaje": compileFlux
// ignoraba ctx.characters (ni descripción ni imagen master). El compiler debe anclar
// el personaje como Seedance — master image (rol character) + descripción al prompt.
describe('compileFlux ancla al personaje', () => {
  it('mete la imagen master como referencia rol character y la descripción al prompt', () => {
    const result = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'a person holds the product in a kitchen' },
      {
        products: [{ name: 'Canvas', imagePaths: ['ws/prod.png'] }],
        characters: [
          { name: 'Pedro', description: 'man with a thick mustache wearing a linen shirt', masterImagePath: 'ws/pedro.png' },
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const imageRefs = result.compiled.references.filter((r) => r.kind === 'image');
    expect(imageRefs.some((r) => r.role === 'character' && r.storagePath === 'ws/pedro.png')).toBe(true);
    expect(imageRefs.some((r) => r.role === 'product' && r.storagePath === 'ws/prod.png')).toBe(true);
    expect(result.compiled.prompt).toContain('mustache');
  });
});

// Vestuario por personaje (specs/v2/16): el compiler de Seedance ya empuja el
// cuerpo completo tras la maestra con cita de vestuario (seedance-references.test.ts),
// pero compileFlux lo ignoraba por completo — los PANELES del storyboard (FLUX)
// nunca recibían el ancla de ropa, justo donde nace el drift. Mismo patrón que
// Seedance, adaptado al mecanismo de cita de FLUX (sin numeración @imageN).
describe('compileFlux ancla el vestuario (cuerpo completo, specs/v2/16)', () => {
  it('empuja el cuerpo completo tras la maestra con la cita de vestuario en el prompt', () => {
    const result = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'a person holds the product in a kitchen' },
      {
        characters: [
          {
            name: 'Pedro',
            description: 'man with a thick mustache wearing a linen shirt',
            masterImagePath: 'ws/pedro.png',
            fullBodyImagePath: 'ws/pedro-full.png',
          },
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const charRefs = result.compiled.references.filter((r) => r.role === 'character').map((r) => r.storagePath);
    expect(charRefs).toEqual(['ws/pedro.png', 'ws/pedro-full.png']);
    expect(result.compiled.prompt).toMatch(/Pedro's full-body wardrobe reference/i);
    expect(result.compiled.prompt).toMatch(/exact same clothing, silhouette and body proportions/i);
    expect(result.compiled.prompt).toMatch(/identity \(face and hair\) comes from the master reference/i);
  });

  it('el cuerpo completo entra como segunda referencia de personaje (FLUX no maneja ángulos)', () => {
    const result = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'a person holds the product' },
      {
        characters: [
          {
            name: 'Pedro',
            description: 'man with a mustache',
            masterImagePath: 'ws/pedro.png',
            fullBodyImagePath: 'ws/pedro-full.png',
            angleImagePaths: ['ws/pedro-side.png'],
          },
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const charRefs = result.compiled.references.filter((r) => r.role === 'character').map((r) => r.storagePath);
    // FLUX ignora angleImagePaths (nunca los cita); el cuerpo completo debe ser la
    // segunda Y ÚLTIMA referencia de personaje, justo tras la maestra.
    expect(charRefs).toEqual(['ws/pedro.png', 'ws/pedro-full.png']);
    expect(charRefs.indexOf('ws/pedro-full.png')).toBe(1);
  });

  it('sin fullBodyImagePath: cero cambio (regresión)', () => {
    const result = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'a person holds the product' },
      {
        characters: [
          { name: 'Pedro', description: 'man with a mustache', masterImagePath: 'ws/pedro.png' },
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const charRefs = result.compiled.references.filter((r) => r.role === 'character');
    expect(charRefs).toHaveLength(1);
    expect(result.compiled.prompt).not.toMatch(/wardrobe reference/i);
  });
});

// Pivote storyboard→Nano Banana: el panel se genera con Nano (reference-grounded)
// porque FLUX no mantenía fieles producto/personaje. El compiler Nano también debe
// anclar la hoja maestra del personaje (antes solo metía el producto).
describe('compileNanoBanana ancla al personaje', () => {
  it('mete la hoja maestra del personaje como referencia rol character', () => {
    const result = compile(
      { modelSlug: 'gemini-3-pro-image-preview', scenePrompt: 'make the lighting warmer' },
      {
        products: [{ name: 'Canvas', imagePaths: ['ws/prod.png'] }],
        characters: [{ name: 'Pedro', description: 'man with mustache', masterImagePath: 'ws/pedro.png' }],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const imageRefs = result.compiled.references.filter((r) => r.kind === 'image');
    expect(imageRefs.some((r) => r.role === 'character' && r.storagePath === 'ws/pedro.png')).toBe(true);
    expect(imageRefs.some((r) => r.role === 'product' && r.storagePath === 'ws/prod.png')).toBe(true);
  });
});

// Anclar la locación en el storyboard: ambos compilers deben emitir la imagen de la
// locación como referencia environment (consistencia de escena entre paneles).
describe('los compilers anclan la locación (environment)', () => {
  it('compileFlux mete la imagen de locación como referencia rol environment + descripción', () => {
    const result = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'a person stands in the place' },
      {
        products: [{ name: 'Canvas', imagePaths: ['ws/prod.png'] }],
        location: { name: 'Living', description: 'a bright modern living room', imagePaths: ['ws/living.png'] },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refs = result.compiled.references.filter((r) => r.kind === 'image');
    expect(refs.some((r) => r.role === 'environment' && r.storagePath === 'ws/living.png')).toBe(true);
    expect(result.compiled.prompt).toContain('living room');
  });
  it('compileNanoBanana mete la imagen de locación como referencia rol environment', () => {
    const result = compile(
      { modelSlug: 'gemini-3-pro-image-preview', scenePrompt: 'make the light warmer' },
      { location: { name: 'Living', description: 'a bright modern living room', imagePaths: ['ws/living.png'] } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refs = result.compiled.references.filter((r) => r.kind === 'image');
    expect(refs.some((r) => r.role === 'environment' && r.storagePath === 'ws/living.png')).toBe(true);
  });
});

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
    products: [
      {
        name: 'Lumen Sparkling Water',
        visualDetails: 'slim aluminum can, matte teal finish, white wordmark',
        palette: ['teal', 'white'],
        imagePaths: ['references/ws1/product-front.png', 'references/ws1/product-side.png'],
      },
    ],
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
    // Fidelidad y escena (línea de producto concisa, guide-backed sin relleno)
    expect(prompt).toContain('logo and proportions consistent');
    // Anti-animación de la foto impresa, sin micromanejo que congele el clip.
    expect(prompt).toMatch(/still print, not animated/i);
    expect(prompt).toContain('sunlit home kitchen');
    // Dirección del formato
    expect(prompt).toContain('selfie handheld');
    // Cláusula negativa fija (texto/logo siempre). Aquí HAY personaje del Cast
    // (Maya, cara anclada) → NO se prohíben rostros (sería contradicción).
    expect(prompt).toContain('No on-screen text');
    expect(prompt).not.toMatch(/No real, identifiable human faces/);
    // Params
    expect(params.operation).toBe('reference2video');
    expect(params.duration).toBe(8);
    expect(params.aspectRatio).toBe('9:16');
    expect(params.generateAudio).toBe(true);
  });

  it('no prohíbe rostros cuando hay personaje del Cast o habla en cámara (anti-contradicción lip-sync)', () => {
    // Clip de puro producto, sin personaje ni habla → SÍ se prohíben rostros
    // reales (evita una persona espuria).
    const productOnly = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The can spins on marble and stops label-forward' },
      { format: elIcono, products: [{ name: 'Lumen', imagePaths: ['p1.png'] }] },
    );
    expect(productOnly.ok).toBe(true);
    if (productOnly.ok) expect(productOnly.compiled.prompt).toMatch(/No real, identifiable human faces/);

    // Personaje del Cast con cara anclada (Maya) → NO se prohíben rostros.
    const withCast = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'She lifts the can and smiles' },
      fullContext(),
    );
    expect(withCast.ok).toBe(true);
    if (withCast.ok) expect(withCast.compiled.prompt).not.toMatch(/No real, identifiable human faces/);

    // Sin Cast pero con habla EN cámara (lip-sync) → tampoco se prohíben rostros.
    const speaking = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'A presenter looks to camera and says one honest line' },
      { format: vozCercana, products: [{ name: 'Lumen', imagePaths: ['p1.png'] }] },
    );
    expect(speaking.ok).toBe(true);
    if (speaking.ok) expect(speaking.compiled.prompt).not.toMatch(/No real, identifiable human faces/);
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
    // Fase 2 audio: dinamismo del hablante (contra el "parado/tieso").
    expect(prompt).toContain('physically alive and dynamic');
    expect(prompt).toContain('never mugging, theatrical or exaggerated');
    // Voz natural anti-robótica (Fase 1 audio: rebalanceada hacia expresividad).
    expect(prompt).toContain('natural Mexican accent');
    expect(prompt).toContain('never flat, monotone, robotic or announcer-like');
    // Articulación clara: rescata palabras menos comunes que el modelo mastica.
    expect(prompt).toContain('articulate every word completely and correctly');
  });

  it('con 2+ personajes en cámara y diálogo, fija un solo hablante (PD-15)', () => {
    const ctx = fullContext();
    ctx.characters = [
      { name: 'Maya', description: 'curly dark hair', masterImagePath: 'm1.png' },
      { name: 'Leo', description: 'short beard', masterImagePath: 'm2.png' },
    ];
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'They smile. Dialogue: "Lo logramos juntos."', durationS: 6 },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/Only ONE person speaks/i);
    expect(res.compiled.prompt).toMatch(/never animate two mouths/i);
  });

  it('con un solo personaje y diálogo NO mete la cláusula de un solo hablante (PD-15)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'She speaks. Dialogue: "Hola a todos."', durationS: 6 },
      fullContext(), // 1 personaje (Maya)
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).not.toMatch(/Only ONE person speaks/i);
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
    if (withCast.ok) {
      expect(withCast.compiled.prompt).not.toContain('Synchronized on-camera speech');
      // Sin habla → tampoco el dinamismo del hablante (es solo para clips hablados).
      expect(withCast.compiled.prompt).not.toContain('physically alive and dynamic');
    }

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

  it('parte un diálogo largo multi-frase en segmentos cortos con pausa (fluidez, solo prompt enviado)', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt:
          '0-6s: medium shot — she speaks to camera. Dialogue: "Esto cambió todas mis mañanas desde el primer día. Ahora no puedo empezar sin él." 6-12s: she smiles',
        durationS: 12,
      },
      fullContext(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt } = res.compiled;
    expect(prompt.match(/Dialogue:/g)?.length).toBe(2);
    // Fase 2 audio: el beat de re-sync es una respiración breve sin corte, ya no
    // ordena una pausa dramática ("pauses briefly").
    expect(prompt).not.toContain('pauses briefly');
    expect(prompt).toMatch(/natural breath and continues the same line smoothly/);
    expect(prompt).toContain('Dialogue: "Esto cambió todas mis mañanas desde el primer día."');
  });

  it('el timeline automático no corta un diálogo entrecomillado por la mitad', () => {
    // Sin timeline previo y ≥5s: toTimeline reparte la acción en tramos, pero las
    // fronteras de oración DENTRO de comillas no deben generar un tramo que
    // empiece a media línea (comillas rotas + habla partida por marcador).
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt:
          'She lifts the can and smiles at the camera. Dialogue: "Esto cambió todas mis mañanas desde el primer día. Ahora no puedo empezar sin él." She winks.',
        durationS: 12,
      },
      fullContext(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt } = res.compiled;
    // Ningún marcador de tiempo cae a media frase del diálogo.
    expect(prompt).not.toMatch(/\d{1,2}-\d{1,2}s: Ahora/);
    // El diálogo sobrevive completo (luego partido en segmentos por el split).
    expect(prompt).toContain('Dialogue: "Esto cambió todas mis mañanas desde el primer día."');
    expect(prompt).toContain('"Ahora no puedo empezar sin él."');
  });

  it('respela palabras de pronunciación difícil en el diálogo compilado', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'She holds the canvas. Dialogue: "Nunca le había regalado una foto que imprimiste."',
        durationS: 6,
      },
      fullContext(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('regaládo');
    expect(res.compiled.prompt).toContain('imprimíste');
  });

  it('normaliza números/símbolos hablados es-MX SOLO en el diálogo, sin tocar el andamiaje', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: '0-4s: she shows the can. Dialogue: "Solo por hoy, 2x1 y a $499." 4-9s: she smiles',
        durationS: 9,
      },
      fullContext(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt } = res.compiled;
    // El diálogo se expande a palabras (no se masca en la voz).
    expect(prompt).toContain('dos por uno');
    expect(prompt).toContain('cuatrocientos noventa y nueve pesos');
    expect(prompt).not.toContain('$499');
    expect(prompt).not.toContain('2x1');
    // El andamiaje (marcadores de timeline) sigue intacto: la normalización es
    // solo del diálogo, no de la acción visual.
    expect(prompt).toContain('0-4s:');
  });

  it('un voiceover lleva voz/acento pero NO lip-sync on-camera', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt:
          'Tight product close-up — the canvas rests on a table. Voiceover (Marcela): "Manda tu foto por WhatsApp."',
        durationS: 8,
      },
      fullContext(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt } = res.compiled;
    // NO dirección de lip-sync on-camera (es narración en off).
    expect(prompt).not.toContain('The on-camera speaker talks directly to the camera');
    // SÍ dirección de voiceover + idioma/acento (la voz se sigue dirigiendo).
    expect(prompt).toContain('do NOT lip-sync any face');
    expect(prompt).toContain('natural Mexican accent');
  });

  it('recorta solo la acción para el techo, preservando cláusulas finales Y el diálogo', () => {
    const huge = '0-3s: Brenda stares into the camera as the LED wall scrolls endless family photographs. '.repeat(160);
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
    // Las cláusulas finales obligatorias sobreviven al recorte de la acción.
    expect(prompt).toContain('No on-screen text');
    expect(prompt).toContain('natural Mexican accent');
    // EL GUION ES SAGRADO (bug 2026-07-02): el diálogo sobrevive SIEMPRE al
    // recorte — sin guion, el lip-sync inventa el audio.
    expect(prompt).toContain('No la pierdas');
    expect(warnings.some((w) => w.includes('recort') || w.includes('techo'))).toBe(true);
  });

  it('desborde mayor que la acción: el guion sobrevive aunque el prompt exceda el budget', () => {
    // Andamiaje gigante (visualDetails ~10500 chars, por encima del budget él
    // solo) + acción corta con diálogo: el recorte ingenuo dejaba la acción en
    // CERO y el modelo inventaba el audio.
    const ctx = fullContext();
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'Ana leans forward, pointing at the lens. Dialogue: "¡Mira esto!"',
        durationS: 4,
        aspectRatio: '9:16',
      },
      { ...ctx, products: [{ ...(ctx.products?.[0] ?? { name: 'Canvas', imagePaths: [] }), visualDetails: 'ornate detail, '.repeat(700) }] },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt, warnings } = res.compiled;
    expect(prompt).toContain('Mira esto');
    expect(prompt).toContain('Ana leans forward');
    expect(warnings.some((w) => w.includes('techo'))).toBe(true);
  });

  it('andamiaje real (~8-9k) + acción corta: la acción sobrevive INTACTA, sin recorte', () => {
    // Bug 2026-07-07 (Anuncio #12): el andamiaje fijo de una campaña completa
    // (locación+producto+personaje+vestuario+escala+voz) superaba el budget de
    // 6000 él solo, el salvamento gancho+diálogo se disparaba en TODOS los
    // clips y la acción (el volteo, el colgado) nunca llegaba al modelo.
    const ctx = fullContext();
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt:
          'Luz rotates the canvas 180 degrees on its vertical axis, the thin edge briefly visible, then readjusts her grip and looks up at the lens with a full smile. Dialogue: "Ahora con Prolienzo, pude hacerlo."',
        durationS: 5,
        aspectRatio: '9:16',
      },
      // ~5.5k de detalle de producto: andamiaje grande pero bajo el techo (ajustado
      // en Fase 2 al sumar SPEAKER_LIVELINESS al andamiaje de clips hablados).
      { ...ctx, products: [{ ...(ctx.products?.[0] ?? { name: 'Canvas', imagePaths: [] }), visualDetails: 'ornate detail, '.repeat(370) }] },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { prompt, warnings } = res.compiled;
    // La acción COMPLETA sobrevive (no solo el gancho) y no hay warning de techo.
    expect(prompt).toContain('rotates the canvas 180 degrees');
    expect(prompt).toContain('looks up at the lens');
    expect(warnings.some((w) => w.includes('techo') || w.includes('recort'))).toBe(false);
  });

  it('el diálogo hablado va en español por default y en inglés si la campaña lo pide', () => {
    const req = {
      modelSlug: 'bytedance/seedance-2.0/reference-to-video',
      scenePrompt: 'She shares a one-sentence take to camera',
      durationS: 6,
    };
    const es = compile(req, fullContext());
    expect(es.ok).toBe(true);
    if (es.ok) {
      expect(es.compiled.prompt).toContain('must be in Mexican Latin American Spanish');
      // Anti-castellano explícito (2026-07-02): el seseo nombrado es el ancla.
      expect(es.compiled.prompt).toContain('never a Castilian accent');
    }

    const en = compile(req, { ...fullContext(), language: 'en' as const });
    expect(en.ok).toBe(true);
    if (en.ok) {
      expect(en.compiled.prompt).toContain('must be in English');
      expect(en.compiled.prompt).not.toContain('must be in Mexican Latin American Spanish');
    }

    // Sin audio no hay diálogo que dirigir.
    const silent = compile({ ...req, generateAudio: false }, fullContext());
    expect(silent.ok).toBe(true);
    if (silent.ok) expect(silent.compiled.prompt).not.toContain('must be in Mexican Latin American Spanish');
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
    ctx.products![0].imagePaths = ['p1.png', 'p2.png', 'p3.png'];
    ctx.products![0].packagingImagePaths = ['pack1.png', 'pack2.png'];
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
    ctx.products![0].imagePaths = ['p1.png', 'p2.png', 'p3.png'];
    ctx.products![0].packagingImagePaths = ['k1.png', 'k2.png'];
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

  it('cita el mapa de escala como rol scale_map con directiva top-down (P15)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The mascot dances on the sidewalk' },
      {
        location: {
          name: 'Calle',
          description: 'a city sidewalk',
          imagePaths: ['ws/street.png'],
          scaleMap: { path: 'ws/map.png', notes: 'the inflatable mascot is twice the person, left of the door' },
        },
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const images = res.compiled.references.filter((r) => r.kind === 'image');
    const sm = images.find((r) => r.role === 'scale_map');
    expect(sm?.storagePath).toBe('ws/map.png');
    expect(res.compiled.prompt).toMatch(/TOP-DOWN SCALE SCHEMATIC/);
    expect(res.compiled.prompt).toContain('twice the person');
  });

  it('sin scaleMap no cita ninguna referencia scale_map (P15)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'A can on a table' },
      { location: { name: 'Calle', description: 'a city sidewalk', imagePaths: ['ws/street.png'] } },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.references.some((r) => r.role === 'scale_map')).toBe(false);
  });

  it('el scale_map tiene MAYOR prioridad que los extras ante el tope de 9 (P15)', () => {
    // 8 imágenes ocupadas (3 producto + 2 empaque + master+2 ángulos) + 1 slot:
    // compiten location, scale_map y extra → el orden de empuje es la prioridad
    // (producto > empaque > personaje > locación > scale_map > extra).
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'She opens the can' },
      {
        format: { ...vozCercana, requiredRefs: ['product', 'character', 'packaging'] },
        products: [{ name: 'Canvas', imagePaths: ['p1.png', 'p2.png', 'p3.png'], packagingImagePaths: ['k1.png', 'k2.png'] }],
        characters: [{ name: 'Maya', description: 'd', masterImagePath: 'm.png', angleImagePaths: ['ma1.png', 'ma2.png'] }],
        location: { name: 'Calle', description: 'd', imagePaths: [], scaleMap: { path: 'map.png' } },
        extraImagePaths: ['x1.png'],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const images = res.compiled.references.filter((r) => r.kind === 'image');
    expect(images).toHaveLength(9);
    // El 9º slot es el scale_map; el extra se recorta primero.
    expect(images[8].role).toBe('scale_map');
    expect(images.some((r) => r.role === 'environment' && r.storagePath === 'x1.png')).toBe(false);
    expect(res.compiled.warnings.some((w) => w.includes('tope de 9'))).toBe(true);
  });

  it('formato que pide personaje sin Cast ya NO bloquea (se inventa en el prompt)', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'The presenter is a person with auburn hair. She presents the can',
      },
      { format: vozCercana, products: fullContext().products },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.warnings.some((w) => w.includes('identidad'))).toBe(true);
  });

  it('producto sin imágenes: fidelidad por atributos, sin apuntar a imágenes inexistentes (#4)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/text-to-video', scenePrompt: 'The can rests on a marble counter' },
      { products: [{ name: 'Lumen', visualDetails: 'slim teal aluminum can', imagePaths: [] }] },
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
    // La línea @ ancla cara/pelo/complexión y excluye la ROPA de la referencia
    // (regla de alcance de la guía), resolviendo el conflicto de vestuario sin
    // micromanejo verboso.
    expect(prompt).toMatch(/use only the face, hair and build from this reference \(not its clothing or background\)/);
  });

  it('personaje inventado (sin hoja maestra): apariencia por descripción, sin imagen inexistente (#4 análogo)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The presenter holds the can to camera' },
      {
        products: fullContext().products,
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

  it('NO fragmenta en micro-tramos por segundo una acción larga rica en comas (#trabado)', () => {
    // Simula una acción larga (varias oraciones) como la de un clip unificado.
    const merged =
      'Medium close-up, eye-level — Grecia holds up a framed picture, looking at the camera. Close-up — Grecia holds her smartphone showing a chat. Medium shot — the framed picture hangs on a wall. Close-up — Grecia smiles warmly at the camera.';
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: merged, durationS: 15 },
      { products: [{ name: 'Lumen', imagePaths: ['p.png'] }] },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const markers = (res.compiled.prompt.match(/\d+-\d+s:/g) ?? []).length;
    // 4 oraciones > tope (~3 para 15s) → se deja como prosa, sin timeline-metralla.
    expect(markers).toBe(0);
    expect(res.compiled.prompt).toContain('holds up a framed picture');
  });

  it('la locación entra como environment tras personaje y antes de extras, y su descripción va al setting', () => {
    const result = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'the couple smiles at the camera' },
      {
        products: [{ name: 'Canvas', imagePaths: ['ws/prod.png'] }],
        characters: [{ name: 'Pedro', description: 'man with mustache', masterImagePath: 'ws/pedro.png' }],
        location: { name: 'Living', description: 'a bright modern living room with a gray wall', imagePaths: ['ws/living.png'] },
        extraImagePaths: ['ws/extra.png'],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const images = result.compiled.references.filter((r) => r.kind === 'image');
    const roles = images.map((r) => r.role);
    // orden: product, character, environment(locación), environment(extra)
    expect(roles).toEqual(['product', 'character', 'environment', 'environment']);
    expect(images[2].storagePath).toBe('ws/living.png'); // la locación va ANTES del extra
    expect(images[3].storagePath).toBe('ws/extra.png');
    expect(result.compiled.prompt).toContain('bright modern living room');
  });

  it('locación solo-texto (sin imagen): la descripción ancla el "dónde", sin referencia environment (fallback Q-04)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'the product rests on a shelf' },
      {
        products: [{ name: 'Canvas', imagePaths: ['ws/prod.png'] }],
        // Locación SIN imagen: fallback soportado (el schema permite master opcional).
        location: { name: 'Tienda', description: 'a warm boutique interior with wooden shelves', imagePaths: [] },
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // El "dónde" entra por TEXTO.
    expect(res.compiled.prompt).toContain('a warm boutique interior with wooden shelves');
    // No hay referencia de imagen de locación (no hay imagen que re-anclar).
    expect(res.compiled.references.some((r) => r.role === 'environment')).toBe(false);
  });

  it('reparte en pocos beats coarse cuando hay acciones separadas por oración', () => {
    const action = 'She walks to the table. She picks up the product. She smiles at the camera.';
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: action, durationS: 12 },
      { products: [{ name: 'Lumen', imagePaths: ['p.png'] }] },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const markers = (res.compiled.prompt.match(/\d+-\d+s:/g) ?? []).length;
    // 3 oraciones en 12s → 3 beats coarse (~4s c/u), nunca por segundo.
    expect(markers).toBe(3);
    expect(res.compiled.prompt).toContain('0-4s:');
  });

  it('reparte en timeline un clip de 6s con 2 oraciones (P12 umbral >=5s)', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'She lifts the can to camera. She takes a sip and nods.',
        durationS: 6,
      } as CompileRequest,
      {},
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.compiled.prompt).toMatch(/\b0-3s:|\b3-6s:/);
  });

  it('no reparte un clip de 6s con una sola oración', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'She lifts the can to camera in soft light.',
        durationS: 6,
      } as CompileRequest,
      {},
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.compiled.prompt).not.toMatch(/\b\d-\ds:/);
  });

  it('perfil animado cambia el look base del video', () => {
    const r = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'the mug spins on the table',
        durationS: 5,
      },
      { style: { slug: 'animado' } },
    );
    expect(r.ok && r.compiled.prompt).toContain('3D animation look');
    expect(r.ok && r.compiled.prompt).not.toContain('ultra realistic');
  });

  it('sin perfil, el look realista actual se conserva', () => {
    const r = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'the mug spins on the table',
        durationS: 5,
      },
      {},
    );
    expect(r.ok && r.compiled.prompt).toContain('ultra realistic, filmic color grading');
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
    const res = run({ format: fmtNoLight('casual, conversacional UGC'), products: [product] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/natural available light/);
  });

  it('hero/cinematic → key light controlada y DOF corto', () => {
    const res = run({ format: fmtNoLight('cinematográfico, épico'), products: [product] }, 'The can sits on a table');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/controlled key light/);
  });

  it('formato estilizado no recibe default de luz', () => {
    const res = run({ format: elIcono, products: [product] }, 'The can floats in a surreal void');
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
    const res = run({ format: fmtNoLight('casual UGC', ''), products: [product], extraImagePaths: ['style-ref.png'] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).not.toMatch(/Cinematography:/);
  });

  it('perfil declarado no-realista (animado) no recibe el default de cinematografía fotográfica', () => {
    const res = run({ format: fmtNoLight('registro normal'), products: [product], style: { slug: 'animado' } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).not.toMatch(/Cinematography:/);
  });

  it('sin perfil, registro normal → sí recibe el default de cinematografía (regresión)', () => {
    const res = run({ format: fmtNoLight('registro normal'), products: [product] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/Cinematography:/);
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
      { format: fmt('ASMR, susurro, macro'), products: [product] },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/Foley-forward/);
  });

  it('beat-driven → cama musical al ritmo (#2)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The can spins' },
      { format: elIcono, products: [product] },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/rhythmic music bed/);
  });

  it('registro neutro → diegético sin música (#2)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The can on a table' },
      { format: fmt('documental sobrio'), products: [product] },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toMatch(/natural diegetic sound/);
  });

  it('voz con registro bold → tono punchy además de la cadencia base (#3)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'A presenter says one line to camera' },
      { format: elIcono, products: [product] },
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
        products: [{ name: 'Lumen', imagePaths: ['p1.png'] }],
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
    ctx.products![0].packagingImagePaths = ['references/ws1/pack.png'];
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
      { products: [{ name: 'Lumen', imagePaths: ['p1.png'] }] },
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
      { products: [{ name: 'Lumen', imagePaths: ['p1.png'] }] },
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

// ============ onlyCharacterRefs (prompt para image2video con cast) ============

describe('onlyCharacterRefs (prompt para image2video con cast)', () => {
  it('conserva el personaje (@image) y quita producto/locación; no bloquea por requiredRefs', () => {
    const format = fromFormatRow({
      slug: 'voz-cercana',
      name: 'Voz cercana',
      register: null,
      camera_style: null,
      pacing: null,
      required_refs: ['product'],
      default_duration_s: 8,
      default_audio: true,
    });
    const ctx: DirectorContext = {
      format,
      products: [{ name: 'Canvas', imagePaths: ['ws/prod.png'] }],
      location: { name: 'Living', description: 'a bright living room', imagePaths: ['ws/living.png'] },
      characters: [
        {
          name: 'Marcela',
          description: 'young woman, long brown hair',
          masterImagePath: 'ws/marcela.png',
          angleImagePaths: ['ws/marcela-side.png'],
        },
      ],
    };
    const result = compile(
      { modelSlug: 'bytedance/seedance-2.0/image-to-video', scenePrompt: 'Marcela mira a cámara' },
      onlyCharacterRefs(ctx),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.compiled.references.filter((r) => r.kind === 'image').map((r) => r.storagePath);
    expect(paths).toContain('ws/marcela.png');
    // Solo la hoja maestra: los ángulos NO se mandan (convención master-only).
    expect(paths).not.toContain('ws/marcela-side.png');
    expect(paths).not.toContain('ws/prod.png');
    expect(paths).not.toContain('ws/living.png');
    expect(result.compiled.prompt).toContain('@image'); // cita al personaje
  });

  it('sin personaje → sin referencias de imagen ni @image', () => {
    const result = compile(
      { modelSlug: 'bytedance/seedance-2.0/image-to-video', scenePrompt: 'producto sobre la mesa' },
      onlyCharacterRefs({ products: [{ name: 'Canvas', imagePaths: ['ws/prod.png'] }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.references.filter((r) => r.kind === 'image')).toHaveLength(0);
    expect(result.compiled.prompt).not.toContain('@image');
  });
});

// ============ P20 — directiva de actuación (Seedance) ============

describe('P20 — directiva de actuación (Seedance)', () => {
  const product = { name: 'Canvas', imagePaths: ['ws/prod.png'] };

  it('inyecta restraint con personaje en cámara', () => {
    const r = compile(
      { modelSlug: 'seedance-2', scenePrompt: 'Pedro lifts the product and nods to camera' },
      {
        products: [product],
        characters: [{ name: 'Pedro', description: 'man with mustache', masterImagePath: 'ws/pedro.png' }],
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).toContain('grounded, restrained performance');
  });

  it('no inyecta actuación en clip de puro producto', () => {
    const r = compile(
      { modelSlug: 'seedance-2', scenePrompt: 'the can rotates slowly on a table' },
      { products: [product] },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).not.toContain('restrained performance');
    expect(r.compiled.prompt).not.toContain('energetic physical performance');
  });

  it('omite restraint si el guion declara emoción alta', () => {
    const r = compile(
      { modelSlug: 'seedance-2', scenePrompt: 'Pedro screams in rage at the camera' },
      {
        products: [product],
        characters: [{ name: 'Pedro', description: 'man', masterImagePath: 'ws/pedro.png' }],
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).not.toContain('restrained performance');
  });
});

describe('registro festivo en español (acting + audio)', () => {
  it('un clip Seedance con registro festivo y personaje recibe actuación enérgica y cama musical rítmica', () => {
    const r = compile(
      { modelSlug: 'seedance-2', scenePrompt: 'Pedro hangs the canvas, steps back and claps twice', durationS: 6 },
      {
        format: { slug: 'fiesta', name: 'Fiesta', register: 'alegre/festivo', cameraStyle: 'dinamico', pacing: 'medio', requiredRefs: [], defaultDurationS: 8, defaultAudio: true },
        products: [{ name: 'Canvas', imagePaths: ['ws/c.png'] }],
        characters: [{ name: 'Pedro', description: 'man with mustache', masterImagePath: 'ws/pedro.png' }],
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).toContain('energetic physical performance');
    expect(r.compiled.prompt).toContain('rhythmic music bed');
  });
});

// ============ Task 3 AM: imageUsages + hint multi-vista ============

describe('AM: imageUsages en el compiler de Seedance', () => {
  it('cita la imagen de producto con su uso cuando hay imageUsages (AM)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'the product on a table' } as CompileRequest,
      { products: [{ name: 'Serum', imagePaths: ['ws/a.png', 'ws/b.png'], imageUsages: { 'ws/b.png': 'three-quarter view' } }] } as DirectorContext,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.compiled.prompt).toMatch(/shown here as three-quarter view/);
      expect(res.compiled.prompt).toMatch(/SAME single product/i);
    }
  });

  it('una sola imagen de producto: sin hint multi-vista', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'the product on a table' } as CompileRequest,
      { products: [{ name: 'Serum', imagePaths: ['ws/a.png'] }] } as DirectorContext,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.compiled.prompt).not.toMatch(/SAME single product/i);
  });
});

describe('P20 — directiva de actuación (Veo/Kling vía video-prose)', () => {
  it('inyecta restraint con hablante en cámara (Kling)', () => {
    const r = compile(
      { modelSlug: 'kling-3', scenePrompt: 'a presenter to camera says "this really works"', generateAudio: true },
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).toContain('restrained performance');
  });

  it('no inyecta en clip de puro producto (Veo)', () => {
    const r = compile(
      { modelSlug: 'veo-3', scenePrompt: 'the bottle sits still on a shelf' },
      { products: [{ name: 'X', imagePaths: ['ws/x.png'] }] },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).not.toContain('restrained performance');
  });
});

describe('P05 — cita condicional del personaje por estado (Seedance)', () => {
  it('con stateLabel, la cita usa el vestuario del estado (P05)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'she runs in the heat' } as CompileRequest,
      { characters: [{ name: 'Marcela', description: 'x', masterImagePath: 'ws/sweaty.png', stateLabel: 'sudado' }] } as DirectorContext,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.compiled.prompt).toMatch(/sudado wardrobe and skin condition shown here/i);
      expect(res.compiled.prompt).not.toMatch(/not its clothing/);
    }
  });

  it('sin stateLabel, la cita conserva "not its clothing"', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'she smiles' } as CompileRequest,
      { characters: [{ name: 'Marcela', description: 'x', masterImagePath: 'ws/master.png' }] } as DirectorContext,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.compiled.prompt).toMatch(/not its clothing/);
  });
});

// ============ Guías creativas en el prompt compilado ============

describe('guías creativas en el prompt compilado', () => {
  it('showFullProduct + safeCrop on → cláusula reconciliada (completo atado al 4:5)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The presenter shows the product and speaks one line.', generateAudio: true },
      { ...fullContext(), guidelines: { showFullProduct: true, safeCrop: '4:5' } },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Reconciliada: una sola clausula, no las dos que competian.
    expect(res.compiled.prompt).toContain('all four of its edges inside that 4:5 area');
    expect(res.compiled.prompt).toContain('central 4:5 area');
    expect(res.compiled.prompt).not.toContain('frame it complete and unobstructed');
  });

  it('hookProductHero solo en el beat de apertura', () => {
    const off = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The presenter speaks.', generateAudio: true, isOpeningBeat: false },
      { ...fullContext(), guidelines: { hookProductHero: true } },
    );
    const on = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The presenter speaks.', generateAudio: true, isOpeningBeat: true },
      { ...fullContext(), guidelines: { hookProductHero: true } },
    );
    expect(off.ok && !off.compiled.prompt.includes('opening hook')).toBe(true);
    expect(on.ok && on.compiled.prompt.includes('opening hook')).toBe(true);
  });

  it('sin guías: ninguna cláusula', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The presenter speaks.', generateAudio: true },
      fullContext(),
    );
    expect(res.ok && !res.compiled.prompt.includes('Crop-safe framing')).toBe(true);
  });
});

// ============ Integración personaje-locación + peso (spec 2026-07-02) ============

describe('integración personaje-locación y peso (spec 2026-07-02)', () => {
  const ana = { name: 'Ana', description: 'curly hair, warm smile', masterImagePath: 'refs/ana.png' };

  it('panel: con personaje + locación entra la cláusula de integración', () => {
    const r = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'she smiles by the window', aspectRatio: '9:16' },
      { characters: [ana], location: { description: 'cozy dim bedroom with a warm lamp', imagePaths: [] } },
    );
    expect(r.ok && r.compiled.prompt).toContain('cast soft contact shadows');
    expect(r.ok && r.compiled.prompt).toContain('cut out or pasted');
  });

  it('panel: sin locación NO entra la integración', () => {
    const r = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'she smiles', aspectRatio: '9:16' },
      { characters: [ana] },
    );
    expect(r.ok && r.compiled.prompt).not.toContain('cast soft contact shadows');
  });

  it('video: peso del producto ancla la interacción', () => {
    const r = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'he moves the piece to the wall', durationS: 5 },
      { products: [{ name: 'Canvas', imagePaths: [], weightKg: 25 }] },
    );
    expect(r.ok && r.compiled.prompt).toContain('visible effort');
  });

  it('video: con personaje + locación entra la integración', () => {
    const r = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'she walks in', durationS: 5 },
      { characters: [ana], location: { description: 'sunlit garden patio', imagePaths: [] } },
    );
    expect(r.ok && r.compiled.prompt).toContain('cast soft contact shadows');
  });
});

describe('perfil de luz de la locación (052)', () => {
  const ana = { name: 'Ana', description: 'curly hair, warm smile', masterImagePath: 'refs/ana.png' };
  const loc = {
    description: 'dim modern room',
    imagePaths: [],
    lightProfile: 'Warm LED strips on the walls cast soft amber light from both sides; the polished dark floor reflects them faintly.',
  };

  it('panel: el perfil entra como Scene light and space y apaga la luz default', () => {
    const r = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'she smiles at the camera', aspectRatio: '9:16' },
      { characters: [ana], location: loc },
    );
    expect(r.ok && r.compiled.prompt).toContain('Scene light and space: Warm LED strips');
    expect(r.ok && r.compiled.prompt).not.toContain('Soft directional lighting that shows form');
  });

  it('panel: sin perfil, la luz default sigue aplicando (comportamiento actual)', () => {
    const r = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'she smiles at the camera', aspectRatio: '9:16' },
      { characters: [ana], location: { description: 'dim modern room', imagePaths: [] } },
    );
    expect(r.ok && r.compiled.prompt).not.toContain('Scene light and space');
    expect(r.ok && r.compiled.prompt).toContain('Soft directional lighting that shows form');
  });

  it('video: el perfil entra como Scene light and space', () => {
    const r = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'she walks in', durationS: 5 },
      { characters: [ana], location: loc },
    );
    expect(r.ok && r.compiled.prompt).toContain('Scene light and space: Warm LED strips');
  });
});

// ============ Task 6: compiler Seedance multi-producto (presupuesto,
// citas agrupadas, anti-conteo — spec multi-producto 2026-07-15) ============

describe('compileSeedance multi-producto', () => {
  const twoProducts = [
    { name: 'Canvas Familiar', imagePaths: ['ws/canvas-1.png', 'ws/canvas-2.png', 'ws/canvas-3.png'], visualDetails: 'family portrait' },
    { name: 'Retrato de Pareja', imagePaths: ['ws/retrato-1.png'], visualDetails: 'couple portrait' },
  ];

  it('citas por ordinal (nunca el nombre: el modelo lo escribe en pantalla) y cap de 2 imágenes con 2 productos', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'Both products sit on the table' },
      { products: twoProducts },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const refs = res.compiled.references.filter((r) => r.role === 'product').map((r) => r.storagePath);
    // 2+1, no 3+1: el cap por producto con 2 productos es 2 imágenes.
    expect(refs).toEqual(['ws/canvas-1.png', 'ws/canvas-2.png', 'ws/retrato-1.png']);
    expect(res.compiled.prompt).toContain('is product 1 of 2');
    expect(res.compiled.prompt).toContain('is product 2 of 2');
    // Anti-texto (bug Anuncio #15 clips 11-12): los nombres propios enumerados
    // salían RENDERIZADOS como letras en el video. El prompt no debe llevarlos.
    expect(res.compiled.prompt).not.toContain('Canvas Familiar');
    expect(res.compiled.prompt).not.toContain('Retrato de Pareja');
  });

  it('cláusula anti-conteo presente UNA sola vez con 2+ y ausente con 1', () => {
    const two = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'Both products sit on the table' },
      { products: twoProducts },
    );
    expect(two.ok).toBe(true);
    if (two.ok) {
      expect(two.compiled.prompt).toContain('exactly 2 distinct products');
      // Antes se emitía en refs Y en descripción: doble carnada de texto.
      expect(two.compiled.prompt.split('distinct products').length - 1).toBe(1);
    }

    const one = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The product sits on the table' },
      { products: [twoProducts[0]] },
    );
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.compiled.prompt).not.toContain('distinct products');
  });

  it('la línea SAME single product se emite POR producto con 2+ vistas, nunca global', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'Both products sit on the table' },
      { products: twoProducts },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('the SAME single product (product 1 of 2)');
    // El producto 2 solo tiene 1 vista referenciada (cap=2 pero solo trae 1
    // imagen): no debe emitir su propia línea SAME, y mucho menos una global.
    expect(res.compiled.prompt).not.toContain('the SAME single product (product 2 of 2)');
  });

  it('multi: descripciones compactas, sin ficha completa ni peso; empaque omitido', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'Both products sit on the table' },
      {
        products: twoProducts.map((x) => ({ ...x, weightKg: 20, packagingImagePaths: ['ws/pack.png'] })),
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('It must appear exactly as in its reference images');
    expect(res.compiled.prompt).not.toContain('visible effort'); // describeProductWeight no corre en multi
    expect(res.compiled.references.some((r) => r.role === 'packaging')).toBe(false);
  });

  it('3+ productos → 1 imagen por producto', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'Three products sit on the table' },
      {
        products: [
          { name: 'A', imagePaths: ['a1.png', 'a2.png'] },
          { name: 'B', imagePaths: ['b1.png', 'b2.png'] },
          { name: 'C', imagePaths: ['c1.png'] },
        ],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.references.filter((r) => r.role === 'product')).toHaveLength(3);
  });
});

// ============ Task 8: compilers secundarios multi-producto (video-prose,
// nano-banana, flux — mismo criterio que Seedance, spec multi-producto
// 2026-07-15) ============

describe('compilers secundarios multi-producto (video-prose, nano-banana, flux)', () => {
  const twoProducts = [
    { name: 'Canvas Familiar', imagePaths: ['ws/canvas-1.png', 'ws/canvas-2.png', 'ws/canvas-3.png'], visualDetails: 'family portrait' },
    { name: 'Retrato de Pareja', imagePaths: ['ws/retrato-1.png'], visualDetails: 'couple portrait' },
  ];

  it('video-prose (Kling) multi: fichas compactas + anti-conteo en el prompt', () => {
    const res = compile(
      { modelSlug: 'kling-3', scenePrompt: 'Both products sit on the table' },
      { products: twoProducts },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('exactly 2 distinct products');
    expect(res.compiled.prompt).toContain('Product 1 of 2');
    expect(res.compiled.prompt).toContain('Product 2 of 2');
    // Anti-texto: sin nombres propios en el prompt multi.
    expect(res.compiled.prompt).not.toContain('Canvas Familiar');
    expect(res.compiled.prompt).not.toContain('Retrato de Pareja');
  });

  it('video-prose (Kling) multi: la referencia sigue siendo solo 1 imagen del primer producto (sin cambio, Veo/Kling solo aceptan una)', () => {
    const res = compile(
      { modelSlug: 'kling-3', scenePrompt: 'Both products sit on the table' },
      { products: twoProducts },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.references).toEqual([{ storagePath: 'ws/canvas-1.png', kind: 'image', role: 'product' }]);
  });

  it('video-prose (Kling) single-producto: cero cambio (parity)', () => {
    const res = compile(
      { modelSlug: 'kling-3', scenePrompt: 'The product sits on the table' },
      { products: [twoProducts[0]] },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).not.toContain('distinct products');
    expect(res.compiled.prompt).toContain('Product: Canvas Familiar, family portrait');
  });

  it('flux multi: 1 imagen por producto + anti-conteo', () => {
    const res = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'Both products sit on the table' },
      { products: twoProducts },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const productRefs = res.compiled.references.filter((r) => r.role === 'product');
    expect(productRefs.map((r) => r.storagePath)).toEqual(['ws/canvas-1.png', 'ws/retrato-1.png']);
    expect(res.compiled.prompt).toContain('exactly 2 distinct products');
    expect(res.compiled.prompt).toContain('Product 1 of 2');
    expect(res.compiled.prompt).not.toContain('Canvas Familiar');
  });

  it('flux multi: productUsageClause recibe el merge de usages de todos los productos', () => {
    const res = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'Both products sit on the table' },
      {
        products: [
          { ...twoProducts[0], imageUsages: { 'ws/canvas-1.png': 'front view' } },
          { ...twoProducts[1], imageUsages: { 'ws/retrato-1.png': 'three-quarter view' } },
        ],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('front view');
    expect(res.compiled.prompt).toContain('three-quarter view');
  });

  it('flux single-producto: cero cambio (parity) — sigue usando hasta 4 imágenes de UN producto', () => {
    const res = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'a person holds the product' },
      { products: [twoProducts[0]] },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const productRefs = res.compiled.references.filter((r) => r.role === 'product');
    expect(productRefs.map((r) => r.storagePath)).toEqual(['ws/canvas-1.png', 'ws/canvas-2.png', 'ws/canvas-3.png']);
    expect(res.compiled.prompt).not.toContain('distinct products');
  });

  it('nano-banana multi: 1 imagen por producto y anti-conteo en el prompt', () => {
    const res = compile(
      { modelSlug: 'gemini-3-pro-image-preview', scenePrompt: 'both products appear together' },
      { products: twoProducts },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('exactly 2 distinct products');
    const productRefs = res.compiled.references.filter((r) => r.role === 'product');
    expect(productRefs).toHaveLength(2);
    expect(productRefs.map((r) => r.storagePath)).toEqual(['ws/canvas-1.png', 'ws/retrato-1.png']);
  });

  it('nano-banana single-producto: cero cambio (parity) — sigue usando hasta 3 imágenes de UN producto', () => {
    const res = compile(
      { modelSlug: 'gemini-3-pro-image-preview', scenePrompt: 'make the lighting warmer' },
      { products: [twoProducts[0]] },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const productRefs = res.compiled.references.filter((r) => r.role === 'product');
    expect(productRefs.map((r) => r.storagePath)).toEqual(['ws/canvas-1.png', 'ws/canvas-2.png', 'ws/canvas-3.png']);
    expect(res.compiled.prompt).not.toContain('distinct products');
  });
});
