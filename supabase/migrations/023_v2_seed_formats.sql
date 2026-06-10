-- 023_v2_seed_formats.sql
-- Seed de los 9 formatos creativos Zyra (doc V2 §4.2) y la biblioteca de
-- escenas/ganchos inicial. Nombres y catálogo propios (no copiar terceros).

insert into formats (slug, name, description, register, camera_style, pacing, required_refs, default_duration_s, default_audio, is_system) values
  ('voz-cercana', 'Voz Cercana',
   'Testimonio de creador estilo UGC: una persona habla a cámara con el producto en mano.',
   'casual, conversacional, primera persona; guion de una idea, máximo ~25 palabras',
   'selfie handheld a nivel de ojos, toma única continua, luz natural imperfecta',
   'pausado y natural, sin cortes',
   array['product', 'character'], 9, true, true),

  ('a-pie-de-calle', 'A Pie de Calle',
   'Entrevista espontánea a desconocidos donde el producto aparece en la conversación.',
   'documental, espontáneo, alta confianza; micrófono en mano',
   'plano medio handheld en exteriores urbanos, eye-level, encuadre de entrevista',
   'dinámico con cortes de pregunta-respuesta',
   array['product', 'character'], 12, true, true),

  ('manos-a-la-obra', 'Manos a la Obra',
   'Demostración o tutorial: las manos hacen el trabajo, el producto es el centro de cada paso.',
   'instructivo, segunda persona, voz imperativa breve o solo acción',
   'cenital o over-the-shoulder estable, cortes permitidos entre pasos',
   'por pasos, claro y deliberado',
   array['product'], 12, true, true),

  ('el-descubrimiento', 'El Descubrimiento',
   'Unboxing y revelación: arranca con el empaque cerrado, termina con el producto revelado.',
   'anticipatorio, sensorial, táctil; el sonido protagoniza si no hay diálogo',
   'cenital o 3/4 sobre superficie limpia, close-ups en los momentos táctiles',
   'lento al inicio, clímax en la revelación',
   array['product', 'packaging'], 10, true, true),

  ('antes-y-despues', 'Antes y Después',
   'Transformación en dos estados; uno de los formatos de mayor conversión en paid social.',
   'directo, orientado a evidencia; el contraste cuenta la historia',
   'encuadre fijo idéntico en ambos estados; transición de corte seco o barrido',
   'dos beats: estado A sostenido, transición, estado B sostenido',
   array['product'], 8, true, true),

  ('susurro', 'Susurro',
   'ASMR sensorial: primeros planos guiados por sonido, sin diálogo.',
   'íntimo, silencioso, caption-only; nada de música',
   'macro y extreme close-up, movimientos mínimos, settings íntimos y de bajo ruido',
   'muy pausado, cada sonido respira',
   array['product'], 10, true, true),

  ('el-icono', 'El Ícono',
   'Héroe de producto kinético: el producto sin personas, en movimiento constante.',
   'estilizado, bold, beat-driven; el producto es protagonista en cada frame',
   'órbitas, whip pans, speed ramps, match cuts; fondos abstractos o minimales',
   'rápido, cortes al beat',
   array['product'], 8, true, true),

  ('gran-pantalla', 'Gran Pantalla',
   'Narrativa de marca cinematográfica con registro de spot premium.',
   'aspiracional, pulido, brand-first; cada frame deliberado',
   'establecimiento → producto → beat emocional → cierre de marca; dolly, grúa, composición',
   'arco estructurado, deliberado',
   array['product'], 15, true, true),

  ('mundo-imposible', 'Mundo Imposible',
   'Concepto surreal / FOOH: escenas imposibles de rodar con el producto como ancla.',
   'artístico, inesperado; describir lo que se ve, no lo que simboliza',
   'cámara inusual (macro, bullet-time, escala imposible), espacios oníricos',
   'libre, al servicio del concepto',
   array['product'], 10, true, true)
on conflict (slug) do nothing;

-- ============ BIBLIOTECA DE ESCENAS ============
-- prompt_fragment en inglés: es lo que consume el compilador del Prompt Director.
insert into scene_library (type, name, prompt_fragment, is_system) values
  ('escena', 'Cocina luminosa', 'a sunlit home kitchen, warm morning light through a window, lived-in countertop details', true),
  ('escena', 'Baño con espejo', 'a clean bathroom vanity, soft diffused light, mirror framing, tidy shelf with everyday items', true),
  ('escena', 'Dormitorio acogedor', 'a cozy bedroom, soft lamp light, unmade textured bedding, casual intimate atmosphere', true),
  ('escena', 'Oficina en casa', 'a home office desk setup, daylight from the side, laptop and notebook props, calm workspace', true),
  ('escena', 'Interior de auto', 'inside a parked car, natural daylight through windows, dashboard and seat detail, casual setting', true),
  ('escena', 'Calle urbana', 'a busy urban sidewalk, storefronts softly out of focus, natural overcast light, real street energy', true),
  ('escena', 'Gimnasio', 'a modern gym floor, equipment in soft background blur, energetic practical lighting', true),
  ('escena', 'Naturaleza', 'an outdoor natural setting, golden hour light, greenery and open sky behind the subject', true),
  ('escena', 'Estudio minimal', 'a clean studio seamless backdrop, controlled soft key light, premium minimal styling', true),
  ('escena', 'Azotea al atardecer', 'a city rooftop at dusk, skyline behind, warm fading light with practical bulbs', true),
  ('escena', 'Mesa de mármol', 'a marble tabletop surface, top-down friendly, soft window light, minimal props', true),
  ('escena', 'Cafetería', 'a casual coffee shop table, ambient chatter feel, warm interior light, cup and pastry props', true),

  ('gancho', 'Producto entra volando', 'the product flies into frame and is caught mid-air without breaking eye contact with the camera', true),
  ('gancho', 'Golpe de cámara', 'the camera takes a sudden bump and quickly reframes, keeping the product centered', true),
  ('gancho', 'Congela y acerca', 'the action freezes for a beat while the camera pushes in fast on the product, then resumes', true),
  ('gancho', 'Caída y rescate', 'the product slips from the hands and is caught at the last moment, followed by a relieved glance to camera', true),
  ('gancho', 'Reacción en seco', 'a deadpan look straight to camera right after something unexpected happens with the product', true),
  ('gancho', 'Manos primero', 'opens on a tight shot of hands interacting with the product before revealing the wider scene', true),
  ('gancho', 'Giro de etiqueta', 'the product spins on its axis and stops with the label perfectly facing the camera', true),
  ('gancho', 'Cambio de fondo', 'mid-action the background changes to a completely different location while subject and product stay constant', true)
on conflict do nothing;
