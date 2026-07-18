import { describe, it, expect } from 'vitest';
import { buildContinuationPrompt } from './orchestrator';

describe('buildContinuationPrompt', () => {
  it('sin personajes ni cierre: producto(s) + fotograma previo', () => {
    const out = buildContinuationPrompt('A dog runs.', 1, 0);
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is the final frame of the previous shot');
    expect(out).not.toContain('@image3');
    expect(out).toContain('A dog runs.');
  });

  it('con personaje: lo cita entre el producto y el fotograma previo', () => {
    const out = buildContinuationPrompt('Scene.', 1, 1);
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is a main character');
    expect(out).toContain('@image3 is the final frame of the previous shot');
    expect(out).not.toContain('@image4');
  });

  it('1 producto + 2 personajes + cierre: índices correctos', () => {
    const out = buildContinuationPrompt('Scene.', 1, 2, { withClosingFrame: true });
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is a main character');
    expect(out).toContain('@image3 is a main character');
    expect(out).toContain('@image4 is the final frame of the previous shot');
    expect(out).toContain('@image5 is the target final frame');
  });

  it('sin producto, 1 personaje: el personaje es @image1', () => {
    const out = buildContinuationPrompt('Scene.', 0, 1);
    expect(out).toContain('@image1 is a main character');
    expect(out).toContain('@image2 is the final frame of the previous shot');
  });

  it('re-ancla idioma es-MX y lip-sync con diálogo + audio (#3)', () => {
    const out = buildContinuationPrompt('She looks to camera. Dialogue: "Pruébalo."', 1, 1, {
      language: 'es',
      generateAudio: true,
    });
    expect(out).toContain('Synchronized on-camera speech');
    expect(out).toContain('natural Mexican accent');
  });

  it('re-ancla el idioma inglés cuando la campaña es en inglés (#3)', () => {
    const out = buildContinuationPrompt('A presenter says one line to camera', 1, 0, {
      language: 'en',
      generateAudio: true,
    });
    expect(out).toContain('must be in English');
  });

  it('voz en off (Voice-over:): sin lip-sync, con idioma y con guard anti-rostros', () => {
    // Clip de puro producto con narración en off: el sujeto no da la cara.
    const out = buildContinuationPrompt(
      'The framed print hangs on the wall, shot from behind. Voice-over: "Por fin se siente como un hogar."',
      1,
      0,
      { language: 'es', generateAudio: true },
    );
    // Frase distintiva de VOICEOVER_DIRECTION (SPEECH_DIRECTION también contiene
    // el substring "voice-over narration" en su cola, por eso no sirve para asertar).
    expect(out).toContain('do NOT lip-sync any face'); // VOICEOVER_DIRECTION
    expect(out).not.toContain('Synchronized on-camera speech'); // NO lip-sync
    expect(out).toContain('natural Mexican accent'); // idioma re-anclado
    expect(out).toContain('No real, identifiable human faces'); // producto puro, sin cara
  });

  it('voz en off con personaje en cuadro: sin lip-sync pero sin guard (hay personaje)', () => {
    const out = buildContinuationPrompt(
      'Luz stands with her back to the camera looking at the wall. Voice-over: "Cada rincón cobra vida."',
      1,
      1,
      { language: 'es', generateAudio: true },
    );
    expect(out).toContain('do NOT lip-sync any face');
    expect(out).not.toContain('Synchronized on-camera speech');
    expect(out).not.toContain('No real, identifiable human faces'); // hay personaje anclado
  });

  it('habla EN cámara: mantiene lip-sync y no añade dirección de voz en off', () => {
    const out = buildContinuationPrompt('Luz looks to camera. Dialogue: "Pruébalo hoy mismo."', 1, 1, {
      language: 'es',
      generateAudio: true,
    });
    expect(out).toContain('Synchronized on-camera speech');
    expect(out).not.toContain('do NOT lip-sync any face');
    // Fase 2 audio: el hablante encadenado también recibe el dinamismo (paridad).
    expect(out).toContain('physically alive and dynamic');
  });

  it('sin audio no añade dirección de voz (#3)', () => {
    const out = buildContinuationPrompt('Dialogue: "Hola"', 1, 0, { generateAudio: false });
    expect(out).not.toContain('Synchronized on-camera speech');
    expect(out).not.toContain('must be in');
  });

  it('clip de puro producto (sin voz) no añade idioma (#3)', () => {
    const out = buildContinuationPrompt('The can rotates on marble', 1, 0, { generateAudio: true });
    expect(out).not.toContain('must be in');
    // Sin habla → sin dinamismo del hablante (es solo para clips hablados).
    expect(out).not.toContain('physically alive and dynamic');
  });

  it('ancla el producto contra animación de la foto impresa, conciso (#B)', () => {
    const out = buildContinuationPrompt('Scene.', 1, 0);
    expect(out).toMatch(/design, colors and proportions consistent/);
    expect(out).toMatch(/still print, not animated/);
  });
});

// Multi-producto por clip (2026-07-15): con 2+ productos distintos, cada ref se
// cita como "one of N" en vez de "the product" (singular), más una cláusula
// anti-conteo para que el modelo no invente/fusione productos.
describe('buildContinuationPrompt — multi-producto (distinctProducts)', () => {
  it('multi-producto: cita cada ref como uno de N productos distintos y añade el anti-conteo', () => {
    const out = buildContinuationPrompt('la familia contempla la pared', 3, 1, { distinctProducts: 3 });
    expect(out).toContain('@image1 is one of the 3 distinct products');
    expect(out).toContain('@image3 is one of the 3 distinct products');
    expect(out).toContain('exactly 3 distinct products; render each exactly once');
  });

  it('single (default): la cita clásica "is the product", sin anti-conteo (paridad)', () => {
    const out = buildContinuationPrompt('escena', 2, 0, {});
    expect(out).toContain('@image1 is the product —');
    expect(out).not.toContain('distinct products');
  });
});

describe('buildContinuationPrompt — audio del clip anterior (spike 2026-07-04)', () => {
  it('con prevClipAudio cita @audio1 y pide conservar timbre y ambiente', () => {
    const out = buildContinuationPrompt('Scene.', 1, 0, { prevClipAudio: true });
    expect(out).toContain('@audio1 is the audio of the previous shot');
    expect(out).toContain('same voice timbre');
  });

  it('sin prevClipAudio no menciona @audio (la música P16 nunca se citó aquí)', () => {
    expect(buildContinuationPrompt('Scene.', 1, 0)).not.toContain('@audio');
    expect(buildContinuationPrompt('Scene.', 1, 0, { prevClipAudio: false })).not.toContain('@audio');
  });
});

describe('buildContinuationPrompt — look del perfil re-anclado (feedback video 2026-07-04)', () => {
  it('re-ancla el look del video (balance neutro / cámara del estilo)', () => {
    const out = buildContinuationPrompt('Scene.', 1, 0, {
      videoLook: 'ultra realistic, filmic color grading with a neutral white balance and true-to-life colors',
    });
    expect(out).toContain('Video look: ultra realistic');
    expect(out).toContain('neutral white balance');
  });

  it('sin videoLook no añade la cláusula (compat con tests previos)', () => {
    expect(buildContinuationPrompt('Scene.', 1, 0)).not.toContain('Video look:');
  });
});

// Auditoría de directivas 2026-07-04 (#5): la cadena perdía actuación contenida,
// cláusula negativa y guard anti-rostros que el compiler sí inyecta en el clip 1.
describe('buildContinuationPrompt — directivas re-ancladas (#5)', () => {
  it('cláusula negativa (anti-overlay/anti-logo inventado) en todo clip', () => {
    const out = buildContinuationPrompt('Scene.', 1, 0);
    expect(out).toContain('No on-screen text overlays');
    expect(out).toContain('Do not invent or add any logo');
  });

  it('con personaje: actuación contenida; sin cara: guard anti-rostros', () => {
    const conCast = buildContinuationPrompt('The presenter reacts.', 1, 1);
    expect(conCast).toContain('restrained performance');
    expect(conCast).not.toContain('No real, identifiable human faces');

    const sinCara = buildContinuationPrompt('The can rotates on marble.', 1, 0);
    expect(sinCara).toContain('No real, identifiable human faces');
    expect(sinCara).not.toContain('restrained performance');
  });

  it('registro enérgico pide actuación enérgica en vez de contenida', () => {
    const out = buildContinuationPrompt('The presenter dances.', 1, 1, { register: 'bold kinetic dance' });
    expect(out).toContain('energetic physical performance');
    expect(out).not.toContain('restrained performance');
  });

  it('emoción alta declarada no recibe contención de actuación', () => {
    const out = buildContinuationPrompt('The character breaks down crying.', 1, 1);
    expect(out).not.toContain('restrained performance');
    expect(out).not.toContain('energetic physical performance');
  });

  it('sanea la keyword soup del scenePrompt (paridad con compile)', () => {
    const out = buildContinuationPrompt('A hero shot, 8k, highly detailed.', 1, 0);
    expect(out).not.toMatch(/8k|highly detailed/i);
  });
});
