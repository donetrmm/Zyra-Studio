El video documenta paso a paso la creación de un anuncio comercial completo sobre unos auriculares que bloquean el ruido exterior. El creador demuestra que el secreto de un anuncio hiperrealista no es un \*prompt\* mágico, sino la iteración: el resultado final es la suma de los mejores segundos extraídos de cientos de intentos.



A continuación, se detalla todo el contenido y los trucos fundamentales mostrados en el video, divididos por las tres fases del proyecto:



\### Fase 1: Creación y Preparación de los Recursos (Assets)

El objetivo es generar referencias visuales consistentes para que la IA no improvise.



\*   \*\*El Producto (Auriculares) y Utilería:\*\* Utiliza \*GPT Image 2.0\* para crear "hojas de producto". Se deben mostrar los objetos (como los auriculares, una cafetera italiana y una taza) de frente y en perspectiva de 3/4 para evitar que el modelo de video tenga alucinaciones.

\*   \*\*El Protagonista (El Héroe):\*\* Creado en \*Soul Cinema\* (ideal para looks fotorrealistas). El prompt exige un fondo gris (que elimina distracciones y mejora los resultados) y muestra un primer plano y vistas de cuerpo entero. 

&#x20;   \*   \*Truco vital:\* El creador usa un editor de fotos para borrar la cara de las vistas de cuerpo entero en la hoja de referencia, dejando solo un rostro en el primer plano. Así, el modelo de video sabe exactamente qué cara debe seguir.

&#x20;   \*   \*Truco de la Ropa:\* Al usar Claude para ideas de ropa y generarla en GPT Image 2.0, la calidad fotorrealista baja (adquiriendo un aspecto "plástico"). Para solucionarlo, en un editor de fotos básico recorta la ropa nueva y la coloca sobre la imagen original de alta calidad de \*Soul Cinema\*, preservando la textura real de la piel y el rostro.

&#x20;   \*   \*Versiones en seco y mojado:\* Como el personaje va a correr, el creador genera dos hojas de personaje separadas: una "seca" y otra "sudada". Si solo usara la seca y pidiera con texto que esté sudado, la IA deformaría el rostro al intentarlo.

\*   \*\*El Personaje Secundario (El Jefe):\*\* Creado con \*AI Cast\*, es un jefe de oficina de 50 años, con barriga, traje y aspecto furioso.

\*   \*\*Locaciones:\*\* Genera una cocina, un estadio, una calle y una oficina. 

&#x20;   \*   \*Truco visual:\* Siempre pide las locaciones en un \*\*ángulo de 3/4\*\* para darles profundidad. Esto le da a la cámara de la IA algo a lo que anclarse al moverse, logrando mejores resultados que una toma plana frontal.

&#x20;   \*   \*Pruebas de ensayo:\* Antes de avanzar, anima locaciones y personajes juntos de forma muy básica (ej. "él camina en la cocina") para elegir qué combinación de personaje y fondo luce mejor.



\### Fase 2: El "Shot List" (Lista de Planos)

El creador evita escribir prompts desde cero en el generador de video para no desperdiciar créditos.

\*   Utiliza una "habilidad" (skill) personalizada en el modelo de lenguaje \*\*Claude\*\*.

\*   Sube el guion del anuncio y \*\*adjunta todas las imágenes definitivas\*\* (personajes, objetos, lugares) asignándoles nombres para que Claude "vea" de qué está hablando.

\*   Claude escupe un documento unificado donde cada toma está optimizada. Este documento contiene un \*\*"Prefijo de Estilo"\*\* en la parte superior. Este prefijo controla globalmente la cámara, luz y color. Si se cambia este prefijo, se actualiza automáticamente el estilo de todas las escenas.



\### Fase 3: Generación de Escenas y Corrección (Paso a Paso del Anuncio)

Todo esto se anima dentro del modelo C-Dance 2.0 de Kixel AI, arreglando los fallos toma por toma.



\*\*Escena 1: La Cocina (Mañana)\*\*

\*   La iluminación inicial era mala, así que cambia el "Prefijo de Estilo" a una luz matutina brillante y limpia, lo que arregla todo el documento.

\*   La acción de hacer café se veía plana. El creador la separa en una toma rápida de "montaje" (vista de pájaro desde arriba de la hornilla, la llama, sirviendo el café) usando recortes de 4 videos diferentes.

\*   Para que el personaje salga bailando de la cocina, descarta la frase "él baila" y le dicta a la IA una coreografía precisa: "dos asentimientos de cabeza, un giro de hombro, flexión de rodilla y chasquido de dedos".



\*\*Escena 2: El Estadio (Corriendo)\*\*

\*   Se anula el Prefijo de Estilo general de la mañana para pedir un "sol duro y directo del mediodía con sombras recortadas".

\*   Aquí usa las hojas de personaje con ropa atlética (usando la versión seca para el calentamiento y la mojada para la llegada).

\*   \*\*Plano SnorriCam:\*\* Logra una toma hiperrealista estilo comercial donde la cámara va "atornillada" al cuerpo del personaje enfocando fijamente el auricular, mientras el fondo pasa a toda velocidad con desenfoque de movimiento.



\*\*Escena 3: La Calle (El Baile)\*\*

\*   Aquí la IA comienza a equivocarse con la escala de los objetos (un muñeco inflable bailarín cambiaba de tamaño) y la posición del personaje.

\*   \*El Hack Definitivo:\* Va a GPT Image 2.0 y dibuja un \*\*mapa esquemático (schematic)\*\* del lugar. Le dice dónde está la acera, el muñeco inflable y su altura en proporción al humano. Al cargar este "mapa" en Claude, la IA comprende la geografía y mantiene todo en su lugar.

\*   Carga la pista de música real como referencia dentro del modelo de video para que el personaje sincronice sus pasos de hip-hop y movimientos de brazos exactamente con el ritmo.



\*\*Escenas 4 y 5: La Oficina y el Final\*\*

\*   El héroe entra a la oficina bailando (con los movimientos de hombros y dedos coreografiados textualmente) ignorando a su jefe furioso, quien está encuadrado perfectamente en el fondo.

\*   En la escena final, para dar un contraste cómico, el jefe rudo aparece en la calle, usando los auriculares y bailando relajado haciendo "la ola" con el cuerpo junto al muñeco inflable.



En resumen, el video expone que el flujo de trabajo profesional con IA no consiste en obtener resultados perfectos en el primer intento, sino en construir controles estrictos (hojas de personaje limpias, mapas esquemáticos, coreografías verbales) y extraer solo los fragmentos exitosos durante la edición.

