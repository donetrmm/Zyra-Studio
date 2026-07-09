# Guía y plantilla del Prompt Maestro (1to1 Studio + Seedance 2.0)

Esta guía explica cómo escribir un **prompt maestro** que rinda con nuestro pipeline y con Seedance 2.0 (video con audio nativo). Está basada en cómo funciona el sistema (ingest → matcher → compiler Seedance) y en lo aprendido comparando anuncios que salieron bien vs mal.

---

## 0. Cómo lee tu prompt maestro el sistema

Escribes **un solo texto** (el prompt maestro, como para un render tipo Veo/Sora). El sistema no reinventa tu idea: la **reparte** en piezas (la traduce, la reordena por clips y la dirige, pero respeta tu creativo).

1. **Ingest** extrae de tu texto: datos del producto (medidas/peso/material), estilo visual (`casero`, `ultra_realista`, `fantasia`, `animado`), guías (safe 4:5, producto completo, hook-héroe), nombres del reparto, locaciones, y el **guion clip por clip** (una escena por clip, en el mismo orden que escribiste).
2. **Matcher** convierte cada escena en el prompt de un clip (reparte la acción en el tiempo, detecta el diálogo).
3. **Compiler Seedance** arma el prompt final y decide, **leyendo tu texto**, si el clip lleva **lip-sync** (habla en cámara) o **voz en off**, y sincroniza la voz.

**Lo que TÚ controlas** (y esta guía cubre): qué se dice, quién lo dice, si mira o no a cámara, cuánto dura cada clip, y cómo se reparte el diálogo. **Lo que el sistema hace solo** (no lo dupliques): normaliza la voz a es-MX, parte líneas largas con pausas, reparte el tiempo en clips con varias acciones y prohíbe el texto en pantalla (esto último, siempre). El encuadre seguro 4:5 es distinto: es opt-in y una guía de encuadre (mantener rostro y producto centrados), no un recorte automático del video — ver §6.

---

## 1. Las 8 reglas de oro

### 1. Una sola línea hablada por clip, dicha una vez, entre comillas
La frase entre comillas es **lo único que Seedance pronuncia**. Escríbela **completa y una sola vez**. **Nunca** partas una frase en varios entrecomillados dentro del mismo clip, ni re-cites fragmentos ("…pude hacerlo…" después de haber dicho "pude hacerlo"). Cada entrecomillado se pronuncia como una locución nueva → el modelo **repite palabras**. Todo lo que no va entre comillas (gestos, cámara, acción) es dirección: no se pronuncia.

- Mal: `"Ahora con Prolienzo…"` [volteo] `"…pude hacerlo…"`
- Bien: Luz mira a cámara y dice: `"Ahora con Prolienzo por fin pude hacerlo."` El volteo del cuadro va en **otro clip** (en silencio), no en el mismo (ver regla 3).

### 2. Rostro a cámara = lip-sync; no dar la cara = voz en off o silencio
Seedance solo sincroniza labios bien si la **cara está de frente, grande y estable**. Decide por clip:
- **Habla en cámara (lip-sync):** el personaje **mira a la lente** y habla. Úsalo para hooks, testimonio y CTA.
- **Producto puro / de espaldas / manipulando algo:** **no** pongas lip-sync. Deja el clip **sin diálogo**, o usa **voz en off** deliberada (una línea completa) y márcala como `Voz en off:`.

Regla práctica (la que hizo bueno al anuncio #11): *si el talento aparece y habla, su rostro va a cámara; toda toma sin rostro es producto puro sin lip-sync.*

### 3. No cargues la cara con acción pesada mientras habla — y si la acción tapa/gira la cara, va en OTRO clip
Voltear el producto, agacharse, mirar hacia abajo o girar la cabeza **mientras** se dice la línea desincroniza los labios y empuja a que salga como voz en off. Orden correcto: **habla a la lente** primero, **luego** la acción. Quita instrucciones de "asiente / gira la cabeza" en el tramo hablado.

Ojo con el matiz que rompió el clip 2 del Anuncio #12 V2: no basta con poner la acción "después" **dentro del mismo clip**. Si la acción **tapa o gira la cara** (voltear/rotar el cuadro, alzarlo frente al rostro, darse la vuelta), el modelo la prioriza y **pierde el lip-sync** aunque la hayas puesto al final. Pártelo en **dos clips**: uno habla (cara despejada, el cuadro a la altura del pecho o a un lado, sin taparle la boca) y el **siguiente** hace el volteo, en silencio. Un clip hablado no debe cargar además una acción que oculte la boca.

**Y el volteo en sí tampoco funciona como movimiento continuo.** Si el guion quiere el **antes/después de las dos caras** de un objeto plano (el reverso del cuadro y luego el frente impreso), no lo pidas como "gira el cuadro 180°": el modelo **no gira el objeto físicamente**, la otra cara **aparece mágicamente** a mitad del giro (morph). Hazlo con un **corte entre dos clips** —un clip muestra el reverso, el **siguiente** muestra el frente— o muestra el frente desde el inicio si no necesitas el suspenso. El corte entre clips es gratis y limpio; el volteo animado, no. (Fue el problema real del clip 2 del Anuncio #12 V2.)

### 4. Dimensiona el diálogo a la duración (~2 palabras/segundo en es-MX)
El modelo **rellena toda la duración con audio**. Si la línea es más corta que el clip, rellena repitiendo; si es más larga, atropella y la boca se emborrona (sobre todo pasados ~8 s).

| Duración del clip | Palabras habladas objetivo (es-MX) |
|---|---|
| 4 s | ~4–6 |
| 5 s | ~6–8 |
| 6 s | ~8–10 |
| 8 s | ~11–14 |
| 10 s | ~14–18 |
| 12 s | ~18–22 |

Si una línea no cabe, **acorta la línea** o **pártela en más clips**. Si la línea es muy corta para el clip, **baja la duración** del clip (no dejes tiempo muerto).

**Techo efectivo por clip:** el sistema recorta la duración de cada clip según su rol (el clip de apertura/revelación puede ir más largo; los demás, incluido el CTA, se capan a ~8 s). En la práctica: no cuentes con más de **~8 s de habla por clip** salvo el de apertura. Un monólogo de 10–12 s no sobrevive: se capa y sale atropellado. Si necesitas decir más, reparte en varios clips.

### 5. Voz en off: deliberada y de una sola línea
La voz en off está bien cuando es intencional (narración sobre b-roll de producto). Márcala `Voz en off:` y escribe **una línea completa**, no fragmentos. El sistema la entregará como narración natural, sin intentar lip-sync.

### 6. El producto va en su sección, no en el diálogo
Medidas, peso, material y acabado descríbelos en la sección de producto. No los metas en la línea hablada (números y símbolos crudos se mascan en la voz; el sistema ya los normaliza, pero mantenlos fuera del guion).

### 7. Encuadre 9:16 con área segura 4:5, sin texto en imagen
Rostro y producto **dentro del 4:5 central**. Franja superior para aire de cabeza, inferior como placa limpia para CTA/logo en post. **No** pidas subtítulos, logos, gráficos ni tipografía: se agregan en post (el sistema además los prohíbe).

### 8. Un personaje habla por clip; mismo look en toda la pieza
Si hay dos personas en cuadro, deja claro que **solo una habla**. Mantén peinado, ropa y maquillaje idénticos en todos los clips (continuidad). Cada personaje puede tener su **voz asignada** (referencia de timbre); nómbralo por su nombre propio.

---

## 2. Plantilla rellenable

Copia y rellena. Borra lo que no aplique. Máximo ~12 clips (más de eso, divídelo en varias campañas).

```
# [Marca] — Prompt maestro · [tipo de anuncio] ([duración] · 9:16 con safe 4:5)

[Una frase: qué es el anuncio y la idea central.]

## 1. Especificaciones globales
- Estética: [casero/UGC | ultra_realista | fantasia | animado] — [descripción].
- Sin texto en imagen (todo se agrega en post).
- El producto es el protagonista.
- Regla de talento: si habla, rostro a cámara; tomas sin rostro = producto puro.

## 2. Encuadre 9:16 con safe 4:5
- Rostro + producto siempre dentro del 4:5 central.
- Franja superior: aire de cabeza. Franja inferior: placa limpia para CTA.

## 3. Locación(es)
[Describe cada locación: espacio, luz, fondo.]

## 4. Talento
[Nombre propio, apariencia, ropa (misma en toda la pieza), tono de voz. Idioma es-MX.]

## 5. Producto (coherencia física)
[Material, acabado, proporción, medidas reales, peso, cómo se manipula. Fidelidad a la referencia.]

## 6. Guion por clips (una escena y UNA línea hablada por clip)
### Clip 1 · ~[N] s — [propósito] · [locación] · [a cámara / producto puro]
[Plano, encuadre, quién está, qué hace. Si habla: rostro a la lente, cabeza estable.]
Diálogo: "[una sola frase completa, ~2 palabras/seg de la duración]"
   — o —
Voz en off: "[una sola frase completa]"   (para tomas sin rostro a cámara)
   — o —
Sin diálogo.   (para producto puro / b-roll)

### Clip 2 · ~[N] s — ...
...

## 7. Reglas transversales
- Una escena y una línea por clip; nunca fragmentar el diálogo.
- Rostro a cámara y cabeza estable en los clips con lip-sync.
- Diálogo dimensionado a la duración.
- Manipulación del producto con las dos manos, sin arrastrar.
- Mismo look del talento; cortes motivados entre clips.
```

---

## 3. Después de «Analizar prompt»: convierte las referencias en activos

Cuando pegas el maestro y das **Analizar prompt**, el sistema reparte tu texto: el guion por clip cae en el campo de "describe", y el resto se extrae a **fichas y notas** (producto, estilo, guías, cast, locaciones). Varias de esas cosas son **referencias que debes convertir en activos** para que el detalle no se adelgace y el set/persona no deriven entre clips. Hazlo **antes** de armar el plan:

- **Locación (lo más importante):** el ingest condensa tu locación a una etiqueta corta (p. ej. "Sala de estar cálida y luminosa"). El detalle fino (colores de pared, muebles, cortinas, luz) **no viaja en el "describe"**. Crea o genera la **Locación** con la descripción completa y adjúntala como base → mantiene el mismo set en todos los clips. Sin el activo, la sala puede cambiar de un clip a otro.
- **Producto:** verifica que la ficha del producto tenga los **detalles visuales finos** (material, acabado, medidas, contenido impreso) y sube imágenes de referencia (frontal, perfil, detalle). El chip resumido solo muestra peso y medio; el resto vive en la ficha, no en el chip.
- **Cast (personaje):** la apariencia del personaje viene de **su ficha en el Cast**, no del texto del maestro. Asegúrate de que exista en el Cast con una referencia que **coincida** con cómo lo describiste (rostro, peinado, vestuario). Si no está, su identidad cambiará entre clips.
- **Voz del cast:** asígnale al personaje su **referencia de voz** (timbre/acento). El sistema la usa como molde de voz (@audio1) para el diálogo hablado; sin ella, la voz sale genérica.

Regla mental: **lo descriptivo se vuelve activo; lo narrativo (acción + diálogo) se queda en el "describe".** El maestro siembra ambos, pero la consistencia entre clips la dan los activos.

---

## 4. Checklist antes de generar

- [ ] ¿Cada clip tiene **una sola** frase entre comillas (o ninguna)? ¿Ningún fragmento re-citado?
- [ ] ¿Los clips con diálogo tienen al personaje **de frente a la lente** y **sin acción pesada de cara** durante el habla? ¿Ninguna acción que **tape o gire la cara** (voltear el cuadro) comparte clip con la línea? (Va en otro clip.)
- [ ] ¿Las tomas sin rostro a cámara están marcadas como `Voz en off:` (una línea) o `Sin diálogo`?
- [ ] ¿Cada línea **cabe** en la duración (~2 palabras/seg)? ¿Ninguna línea corta en un clip largo?
- [ ] ¿Rostro y producto dentro del 4:5? ¿Cero pedidos de texto/subtítulos/logos?
- [ ] ¿Medidas/peso/material en la sección de producto, no en el diálogo?
- [ ] ¿Un solo personaje habla por clip? ¿Mismo look en toda la pieza?
- [ ] ¿≤ 12 clips?
- [ ] Tras analizar: ¿creaste el **activo de Locación** con la descripción completa (no solo la etiqueta)?
- [ ] ¿La ficha del **producto** tiene los detalles visuales finos y sus imágenes de referencia?
- [ ] ¿El **personaje** está en el Cast con una referencia que coincide, y con su **voz** asignada?

---

## 5. Errores comunes (y cómo se ven al generar)

| Error en el maestro | Qué sale en el video |
|---|---|
| Frase partida en varios entrecomillados / fragmentos re-citados | **Repite palabras** al terminar/empezar la frase; audio desincronizado |
| Habla puesta sobre una toma donde el personaje no mira a cámara o manipula el producto | Sale como **voz en off** (sin lip-sync) o boca desincronizada |
| Habla + acción que tapa/gira la cara (voltear el cuadro) en el **mismo** clip, aunque sea "después" | El modelo hace la acción y **pierde el lip-sync**; parte en dos clips (uno habla, otro voltea) |
| Voltear/rotar ~180° un objeto plano (cuadro, teléfono) para revelar su otra cara dentro de un clip | El modelo no lo gira; la otra cara **aparece mágicamente** a mitad (morph). Revela con un **corte** entre dos clips (reverso / frente) |
| Línea corta en un clip largo | El modelo **rellena repitiendo** la cola de la frase |
| Línea muy larga para la duración (o clip >8 s con monólogo) | Habla **atropellada**, boca "mushy", deriva del sync |
| Marcar "Voiceover/narración/voz en off" cuando querías lip-sync | El sistema apaga el lip-sync **a propósito** |
| Números/símbolos crudos en el diálogo ($499, 24/7, 3km) | Se mascan en la voz (mételos en la sección de producto o escríbelos con palabras) |
| Pedir subtítulos/logo/CTA en el video | Se ignoran / ensucian el cuadro (van en post) |
| Movimiento rápido o "mucho movimiento" | Cuerpos deformados, miembros que se estiran a media acción (baja el ritmo, evita "rápido") |
| Manos en primer plano extremo | Dedos rotos, de más o doblados (encuádralas a media distancia) |
| 5+ personajes o escena recargada | Caras de fondo genéricas, conteo erróneo, detalle fino que colapsa (composición despejada, un sujeto) |
| Espejos/reflejos en cuadro | El reflejo no coincide con el sujeto (evita encuadrarlos) |
| Adjetivos-piropo ("épico", "hermoso", "cinematográfico") en vez de verbos concretos | Resultado promedio/genérico |
| Apilar 3+ movimientos de cámara o modificadores contradictorios | El modelo se rinde y hace algo genérico |

---

## 6. Qué hace el sistema por ti (no lo dupliques)

- Normaliza la voz a **es-MX** con cadencia natural (no escribas "acento mexicano" en cada clip).
- Parte automáticamente una **línea larga** (a partir de ~11 palabras) en segmentos con un beat de pausa para re-sincronizar.
- Reparte el tiempo en **timeline** para clips con varias acciones (desde ~5 s).
- Recorta la **duración efectiva** de cada clip por su rol (fuera del de apertura, ~8 s de habla como techo).
- Aplica **siempre** la protección **anti-texto en pantalla**.
- El **encuadre seguro 4:5** es opt-in: si lo activas o lo mencionas, instruye al modelo para mantener rostro y producto centrados. Es una **guía de encuadre**, no un recorte automático del video (el crop real 4:5→9:16 vive en el flujo de storyboard/imágenes, no en el de video hablado).
- Asigna la **voz por personaje** (referencia de timbre en @audio1) si el personaje tiene voz configurada.

> Referencia viva: el anuncio **#11 V3** es un buen ejemplo del patrón (una línea por clip, rostro a cámara, producto puro sin diálogo). El ejemplo corregido de **#12** está en `docs/prompt-maestro/anuncio-12-corregido.md`.

---

## 7. Cómo lee Seedance un clip: vocabulario y límites (referencia general)

Las 8 reglas de arriba son sobre **diálogo y lip-sync** (donde más nos ha dolido). Esta sección es lo **general**: cómo describir la imagen y el movimiento para que Seedance obedezca, y qué cosas el modelo simplemente no hace bien (aparte del audio). El matcher **traduce tu coreografía** al prompt del clip, así que lo que escribas aquí llega al modelo.

### Anatomía de un clip (el orden que el modelo lee mejor)
Describe cada clip como un **brief de una toma**, en este orden: **sujeto → acción → entorno → luz → cámara** (el diálogo aparte, entre comillas). Pon lo más importante primero: ancla la atención del modelo.

- **Concreto, no evocativo.** "Una mujer" no dice nada; "una mujer de cabello castaño con un abrigo largo gris camina cruzando un puente de piedra mojada" da sujeto, postura y un vector de movimiento.
- **Nada de adjetivos-piropo** ("hermoso", "impresionante", "cinematográfico épico"): dan resultados **promedio**. Gasta las palabras en **verbos y sustantivos concretos**, no en calificativos.
- **Una acción principal + un movimiento de cámara por clip.** Si necesitas complejidad, escálala en **fases** ("primero… luego… al final…"), nunca varias acciones simultáneas. (Es la misma "un clip = una toma": no metas dos cosas en una sola.)

### Vocabulario de cámara y movimiento que Seedance obedece
Usa términos de cine reales como instrucciones literales; el modelo los entiende mejor que las descripciones casuales.

| Quieres… | Escribe (términos que el modelo obedece) |
|---|---|
| Tamaño de plano | close-up, plano medio (medium), plano abierto (wide), two-shot, plano de pecho, contrapicado (low angle) |
| Acercarte físicamente | **push-in / dolly in** (mueve la cámara, perspectiva natural) — **no** es zoom (cambio de lente, se ve "de post") |
| Alejarte | pull-out / dolly out |
| Barrer / inclinar | pan (horizontal), tilt (vertical) |
| Rodear al sujeto | orbit / arc / 360° |
| Seguir al sujeto | tracking / follow shot |
| Cámara quieta | static / locked-off |
| Look casero/UGC | **handheld** ("handcam"): vaivén orgánico sutil. Para forzar suavidad: gimbal / steadicam / stabilized |
| Punto de vista | POV / first-person |
| Enfoque que cambia de plano | rack focus |

Reglas de la cámara:
- **Di la dirección y la velocidad.** "push-in lento de 3 s sobre los ojos", "pan rápido a la izquierda", "órbita completa 360°". Velocidades que entiende: lento/gradual/sutil/suave vs rápido/súbito.
- **No apiles más de 2–3 instrucciones de cámara** ni pongas modificadores contradictorios ("dolly suave rápido agresivo"): el modelo se rinde y hace algo genérico.
- **Separa lo que hace el sujeto de lo que hace la cámara** (dos frases distintas); no lo mezcles en la misma cláusula.

### Límites del modelo (diseña alrededor de ellos)
Además de los de diálogo (reglas 1–5), Seedance tropieza con esto — vale para **cualquier** producto/escena:

- **Movimiento rápido o complejo deforma cuerpos** (miembros que se estiran, torso que se dobla a media acción). Evita "rápido" y "mucho movimiento"; **baja el ritmo**. Un gesto tranquilo sale limpio; una carrera o un truco, no.
- **Transformaciones y volteos "mágicos".** Rotar/voltear un objeto ~180°, o cualquier antes/después dentro de un clip, morphea. Va con un **corte entre clips** (regla 3).
- **Texto legible en cuadro = garabatos.** El modelo no escribe letras de verdad: nada de letreros, etiquetas ni pantallas con texto. Va en post (el sistema ya lo prohíbe).
- **Manos en primerísimo plano se rompen** (dedos de más, doblados). Encuadra las manos a **distancia media**, no en extreme close-up.
- **Multitudes y detalle fino se simplifican** (caras de fondo genéricas, elementos pequeños que colapsan). **Composición despejada, un sujeto en primer plano.** Con 5+ personajes o muchos elementos la calidad cae; el conteo exacto tampoco es fiable.
- **Espejos y reflejos no coinciden** con el sujeto: evita encuadrarlos.
- **La física se guía con la consecuencia**, no solo el movimiento: "las hojas se dispersan al impacto" rinde mejor que describir el golpe solo.
- **La consistencia entre clips es imperfecta:** cuenta con **2–3 generaciones** para clavar un clip exacto; por eso las **referencias (activos) son carga real**, no un adorno (ver §3).

### Lip-sync: encuadre y matices (complementa las reglas 1–5)
- **Plano medio / medium close-up, cara de frente o 3/4 leve** (los perfiles no sincronizan). El plano abierto **baja la resolución de la cara** y emborrona la boca → en piezas habladas, vertical + cara razonablemente grande ayuda.
- **La cámara estable ayuda, pero handheld está bien** para el look casero **si la cabeza del personaje se mantiene estable**: lo que rompe el sync no es el vaivén de la cámara, es que **el sujeto** mueva o gire la cara mientras habla. (Así se resolvió el clip 6 del Anuncio #12 V2: handcam con deriva suave + mirada estable a la lente.)
- **El español no es el idioma más fuerte del modelo para el sync** (rinde mejor en inglés/mandarín): razón de más para **líneas cortas, dicción limpia y ~2 palabras/seg** (regla 4). El sistema ya normaliza a es-MX; no lo pelees con líneas largas.

> Basado en investigación de buenas prácticas de Seedance (fal.ai, Higgsfield, Volcengine y guías especializadas, jul-2026) + lo aprendido en producción. Los detalles de resolución/duración varían por versión y endpoint; el pipeline los fija por su cuenta.
