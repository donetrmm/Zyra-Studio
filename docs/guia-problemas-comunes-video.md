# Guía rápida: problemas comunes de generación y cómo arreglarlos

Recetas cortas **problema → qué hacer** para la generación de video (y los paneles que la
alimentan). Pensada para consultar al vuelo. Para el detalle de cada caso (causa raíz,
commits) ver `errores-generacion-video.md`.

**Dónde se arregla cada cosa** (clave para no perder tiempo):
- **Panel** (imagen base del clip): se ajusta refinando el panel en el storyboard.
- **Diálogo y duración:** editor de audio por beat en el storyboard.
- **Acción / encuadre / emoción / qué se ve:** vive en el `scene_prompt` (la dirección del
  movimiento). Hoy se edita en el plan de la campaña, no en el storyboard.
- **Cast / Producto / Locación:** son activos reutilizables (Brand Kit / Cast / Locaciones).
- **Pronunciación:** mapa curado en `lib/prompt-director/pronunciation.ts`.

---

## Paneles del storyboard (imagen base)

El panel es la base de cada clip (fotograma inicial o referencia fuerte). Si el panel está
mal, el video hereda el problema — arregla el panel primero.

**Los paneles salen casi idénticos / el panel copia al anterior**
→ El modelo preserva de más. Pide un **cambio de toma explícito** ("otro ángulo, plano más
cerrado, distinta composición"). Evita instrucciones que solo cambien un detalle de texto.

**El panel reinventa la historia / no continúa la escena anterior**
→ Los paneles se encadenan (cada uno edita al anterior). Genera **en orden** (el botón
"Generar storyboard" va en orden de escena) para que cada panel vea al anterior recién
hecho.

**Un objeto/arreglo que estaba en el panel anterior desaparece o se mueve**
→ El encadenado conserva el estado de escena. Si lo pierdes, **regenera en orden**. Para
recuperarlo, refina re-mencionando el objeto **sin volver a describir el producto** (re-
describirlo lo cambia).

**Las caras salen de plástico / con look de IA**
→ Ya se inyecta foto-realismo cuando el beat tiene personajes (salvo que el estilo sea
declarado cartoon/anime/3D/animado). Si lo quieres estilizado, **declara el estilo**. Si
sale plástico aun con personajes, refina: "piel real con textura natural, no plástico".

**El cuadro/foto del producto se confunde con un estilo (se "dibuja")**
→ El detector de estilo **excluye a propósito** palabras como pintura/cuadro/dibujo/impreso
(son el producto, no el render). Si igual lo estiliza, evita describir el render como
"ilustración/painting"; pide "fotografía realista".

---

## Refinado (editar un panel con instrucción)

**El cambio no se integra / queda "pegado"** (ej. "le quité el casco y la cara queda
pegada")
→ Refina **un cambio por iteración**. El modo conversacional edita la imagen in-place;
acumular varios cambios en una instrucción es menos fiable.

**Al refinar reaparece algo viejo o se pierde la composición**
→ En refinado conversacional **no vuelvas a subir las referencias originales**; la
composición ya viaja en el panel que estás editando. Describe el cambio en texto.

**El producto cambia cuando lo refino**
→ No le pidas "vuelve a poner el producto" describiéndolo (lo reinventa). Mejor regenera el
panel (re-ancla la referencia limpia) o refina re-mencionando el producto sin re-describirlo.

---

## Voz y pronunciación

**No pronuncia bien una palabra**
→ Pon la **tilde donde va la fuerza** (sílaba tónica) en el diálogo. Como el diálogo es
guion hablado (no se ve en pantalla), puedes "mal escribirlo" para que suene bien.
Ej.: `imprimiste → imprimíste`, `regalado → regaládo`, `Prolienzo → Prólienzo`.
→ Si es recurrente, agrégala al mapa `PRONUNCIATION_RESPELLINGS` (una línea: palabra → con
tilde) y se corrige sola en todos los clips.

**La voz suena apresurada / robótica**
→ El diálogo **no cabe** en la duración. Sube la duración o acorta el diálogo hasta que el
medidor del editor de audio diga **"Holgado"** (~2.5 palabras/seg en español).

**La voz robótica en una narración (sin nadie hablando en cámara)**
→ Es un **voiceover**: márcalo como tal en el scene_prompt (`Voiceover:` / "narración en
off"). Evita lenguaje de hablante en cámara para que no intente lip-sync de una cara que no
está.

**Habla en inglés o en otro idioma**
→ El modelo habla el idioma del **diálogo**. Escríbelo en español (ya se fuerza acento
mexicano y cadencia natural).

**Mete el diálogo como texto en la imagen**
→ Ya se prohíbe el texto en pantalla; si aparece, regenera. No escribas el diálogo como si
fuera un rótulo.

---

## Consistencia de caras / personaje (Cast)

**La cara del personaje cambia durante la acción**
→ Registra al personaje en el **Cast con hoja maestra** (foto de referencia). El clip debe
mandar el cast como referencia (modo R2V) y el `scene_prompt` debe **nombrar** al personaje.

**El personaje no se parece / deriva entre clips**
→ Sin hoja maestra su identidad no está anclada. Súbele una foto de referencia clara
(rostro frontal). La maestra fija **cara, pelo y complexión**, no la ropa.

**El personaje aparece "pegado" / estático y no anima**
→ No mandes el cast en tomas donde **no actúa** (p.ej. un close-up del producto donde la
gente está impresa en el cuadro). Esos clips deben ir por image2video (panel como
fotograma inicial), no por R2V con cast.

**El vestuario o la actitud cambian**
→ La hoja maestra solo fija la cara. Describe vestuario/actitud en el campo de descripción
del personaje para que sean consistentes.

**Varios personajes se confunden / se mezclan**
→ Máximo 3 por toma. Nómbralos claramente en el scene_prompt y dales hojas maestras
distintas.

---

## Locación / escena

**El lugar cambia entre clips**
→ Crea una **Locación** y asígnala a la secuencia. Re-ancla el lugar en cada clip y,
además, genera los clips **sin encadenar** (evita la degradación acumulativa).

**"Mismo lugar pero distinto ángulo / no es idéntico"**
→ Es esperado con clips independientes. Mejora con una imagen de locación + descripción del
lugar; aun así no serán cuartos pixel-idénticos.

**La escena reinventa el entorno**
→ Asegúrate de que la locación tenga **imagen** (no solo texto). Puedes generarla con IA
desde la descripción y registrarla como locación.

---

## Producto

**El producto cambia / deriva**
→ Sube una imagen del producto al **Brand Kit**. Se manda como referencia dedicada (en R2V)
y se cita para mantener diseño/colores.

**El producto aparece cuando NO debería (debía estar volteado / fuera de cuadro)**
→ Dilo explícito en el scene_prompt: *"el cuadro de espaldas a cámara todo el tiempo, no
vemos el impreso, solo la cara del personaje"*. Una mención de "ve la foto en el cuadro"
hace que el modelo lo enseñe.

**El contenido impreso (la foto del cuadro) se inventa**
→ Necesita la **imagen de referencia** del producto. Si el panel ancla muestra el producto
envuelto o de lejos, el close-up lo inventará; describe el contenido y/o usa la referencia.

---

## Composición y encuadre

**Muestra algo que debería ser solo lo que ve el personaje (POV)**
→ El scene_prompt no debe pedir mostrarlo a cámara. Sé explícito: *"solo vemos su cara"*,
*"el objeto de espaldas"*, *"no vemos X"*. Los paréntesis tipo "(desde su POV)" son
demasiado débiles.

**El video "desobedece" la dirección**
→ Revisa el `scene_prompt` almacenado: casi siempre es **contradictorio** (pide dos cosas
opuestas, p.ej. "de espaldas" y "ve la foto"). Ningún ajuste de modelo arregla una
instrucción contradictoria — reescribe la escena.

**El encuadre no es el que diseñé en el panel**
→ En R2V el panel es referencia fuerte, no fotograma exacto. Si necesitas el arranque
**exacto** del panel, conviene image2video (sin cast) en esa toma.

---

## Emoción y gestos

**Lágrimas / gestos exagerados o falsos**
→ Los modelos de video renderizan lágrimas mal por defecto. Simplifica la emoción y evita
acumular señales ("eyes widen + hand to mouth + gasp + tearing" → llanto). Elige UNA
emoción clara. Si quieres lágrima, dirígela sutil: *"ojos vidriosos, una lágrima que no
escurre"* (empírico, no garantizado).

---

## Movimiento y montaje

**Los clips no se montan bien (cortes feos al unirlos)**
→ Ya se pide **abrir/cerrar en fotograma estable** para cortes limpios. Mantén encuadres y
duraciones compatibles entre clips contiguos.

**El video se ve "trabado" / entrecortado en la app**
→ Primero compara el **archivo fuente** (consola del proveedor) vs la reproducción en la
app. Si el fuente está bien, es el **reproductor** (CSS/modal), no la generación.

---

## Degradación en encadenado (clips de secuencia)

**Cada clip se ve peor / más "crispeado" hacia el final** (pieles con pecas/contraste, más
saturado)
→ Es **generation loss**: re-generar desde el frame anterior una y otra vez acumula
textura. Solución: usa **Locaciones** o **storyboard** para generar cada clip desde una
base limpia (panel/locación), no heredando el frame del clip previo.
→ Diagnóstico: `pnpm measure:chain-luma -- --campaign-name "..." --dump` y **mirar** los
fotogramas (las métricas de cuadro completo esconden la degradación en las caras).

---

## Reglas de oro

1. **Pon la tilde donde va la fuerza** cuando una palabra suene mal.
2. **Lee el `scene_prompt`** antes de culpar al modelo: la mayoría de "desobediencias" son
   instrucciones contradictorias.
3. **Cada toma, sus referencias:** cast solo si actúa; producto solo si es visible; panel
   como fotograma exacto cuando se pueda.
4. **No encadenes si puedes evitarlo:** locación/storyboard dan clips limpios sin
   degradación.
5. **Mira los píxeles / el fuente** antes de asumir: el "trabado" era CSS; la degradación se
   escondía en el promedio.
6. **Refina un cambio a la vez:** el modelo edita mejor de a un cambio; no acumules varios
   en una instrucción ni re-subas las referencias originales en el refinado.
