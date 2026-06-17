// Contenido de los checklists informativos de pre-vuelo (componente
// components/ui/preflight-checklist.tsx). Centralizado para una sola fuente de
// verdad. Las restricciones reflejan las reglas reales del producto (hints del
// wizard + parámetros de cada generador + reglas de contenido de CLAUDE.md /
// project-context). La creación manual tiene un checklist por tipo (imagen,
// video, audio) con su propio "no volver a mostrar" independiente.

import type { PreflightOptions } from '@/components/ui/preflight-checklist';

export const CAMPAIGN_CHECKLIST: PreflightOptions = {
  title: 'Antes de armar tu campaña',
  intro: 'Para obtener mejores resultados, ten en cuenta:',
  confirmLabel: 'Armar el plan',
  items: [
    {
      text: 'Fotos de producto nítidas y con fondo simple (1 a 6: frontal, perfil, detalle).',
      sub: 'La primera imagen define el análisis del producto.',
    },
    {
      text: 'Describe ideas concretas: el plan crea un creativo por idea.',
      sub: 'Ej. «3 unboxings, algo ASMR, mi perro usa el producto». Sin ideas, el plan sale genérico.',
    },
    {
      text: 'Asigna personajes del Cast y nómbralos en tus ideas para dirigirlos.',
      sub: 'Nombres sin asignar se inventan sin referencia y su cara cambia entre videos.',
    },
    {
      text: 'No se replican marcas, empaques ni claims reales; lo que no exista se crea desde cero.',
      sub: 'Personajes ficticios, sin marcadores de edad.',
    },
    {
      text: 'Los borradores salen en 480p (más baratos); la versión final se aprueba aparte en 720p o 1080p.',
      sub: 'Techo de la demo: 30 creativos por campaña.',
    },
  ],
};

export const IMAGE_CHECKLIST: PreflightOptions = {
  title: 'Antes de generar tu imagen',
  intro: 'Para un buen resultado, revisa:',
  confirmLabel: 'Generar imagen',
  dontShowAgainKey: 'preflight:manual:image',
  items: [
    {
      text: 'Prompt específico: sujeto, estilo, composición, iluminación y encuadre.',
      sub: 'Más detalle = más control sobre el resultado.',
    },
    {
      text: 'Sube referencias para fijar producto, personaje o estilo y mantener consistencia.',
    },
    {
      text: 'Si la imagen lleva texto, actívalo en las opciones para que no salga distorsionado.',
    },
    {
      text: 'Elige aspecto y resolución según el uso; el costo en créditos depende de eso.',
      sub: 'En modo chat, itera describiendo el cambio sobre la imagen anterior (no re-subas).',
    },
    {
      text: 'No reproduzcas marcas, logos ni claims reales; personajes ficticios sin marcadores de edad.',
    },
  ],
};

export const VIDEO_CHECKLIST: PreflightOptions = {
  title: 'Antes de generar tu video',
  intro: 'Para un buen resultado, revisa:',
  confirmLabel: 'Generar video',
  dontShowAgainKey: 'preflight:manual:video',
  items: [
    {
      text: 'Describe la acción y la cámara (movimiento, plano), no solo el sujeto.',
    },
    {
      text: 'Sube una imagen de inicio o referencias para anclar producto/personaje y evitar drift.',
    },
    {
      text: 'Duración y resolución determinan el costo (se cobra por segundo); empieza corto para probar.',
      sub: 'Fija el seed para iterar manteniendo la misma composición.',
    },
    {
      text: 'La generación tarda y se procesa en cola; el resultado y su costo aparecen al terminar.',
    },
    {
      text: 'No reproduzcas marcas, logos ni claims reales; personajes ficticios sin marcadores de edad.',
    },
  ],
};

export const AUDIO_CHECKLIST: PreflightOptions = {
  title: 'Antes de generar tu audio',
  intro: 'Para un buen resultado, revisa:',
  confirmLabel: 'Generar audio',
  dontShowAgainKey: 'preflight:manual:audio',
  items: [
    {
      text: 'Escribe el texto tal como debe sonar; la puntuación marca pausas y entonación.',
    },
    {
      text: 'Elige la voz y el idioma adecuados; prueba la voz con un texto corto antes.',
    },
    {
      text: 'Ajusta estabilidad y similaridad para equilibrar naturalidad y consistencia.',
    },
    {
      text: 'El costo en créditos depende de la longitud del texto.',
    },
    {
      text: 'No imites voces ni identidades reales; contenido sin claims de marca reales.',
    },
  ],
};
