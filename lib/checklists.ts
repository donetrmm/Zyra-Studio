// Contenido de los checklists informativos de pre-vuelo (componente
// components/ui/preflight-checklist.tsx). Centralizado para una sola fuente de
// verdad entre el wizard de campañas y la creación manual. Las restricciones
// reflejan las reglas reales del producto (hints del wizard + reglas de
// contenido de CLAUDE.md / project-context).

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

export const MANUAL_CHECKLIST: PreflightOptions = {
  title: 'Antes de generar',
  intro: 'Para un buen resultado, revisa:',
  confirmLabel: 'Generar',
  dontShowAgainKey: 'preflight:manual',
  items: [
    {
      text: 'Prompt claro y específico: sujeto, acción, escena, estilo y encuadre.',
      sub: 'Más detalle = más control sobre el resultado.',
    },
    {
      text: 'Sube referencias para fijar producto, estilo o personaje y mantener consistencia.',
    },
    {
      text: 'Elige aspecto, modelo y resolución según el uso; el costo en créditos depende de eso.',
      sub: 'Los créditos se descuentan al generar; video y audio largos van en cola.',
    },
    {
      text: 'No reproduzcas marcas, logos ni claims reales; personajes ficticios sin marcadores de edad.',
    },
  ],
};
