# Smoke test E2E — Zyra Studio V2

> Recorrido completo del Campaign Studio con APIs reales, de Brand Kit a reporte de valor.
> Lo corre el usuario (gasta créditos y dinero real en fal.ai). Duración estimada:
> **30-45 min** activos. Costo estimado del recorrido completo: **~4,000-6,000 créditos**
> (~$2-4 USD de costo real en fal.ai con drafts 480p + 1-2 finales 720p + pack de imágenes).
>
> Estado: fases A-C ya validadas el 2026-06-11 (campaña LUMEN). Las secciones 6-9 (fases D y
> E) están pendientes de su primera pasada.

## 0. Prerequisitos

- [ ] Rama `development` corriendo (`pnpm dev`) o deploy con el código de development.
- [ ] `.env.local` completo: `FAL_KEY`, `GEMINI_API_KEY`, `QSTASH_TOKEN`, `NEXT_PUBLIC_APP_URL`
      apuntando a una URL alcanzable por QStash (deploy o túnel; localhost NO funciona para el worker).
- [ ] Balance de créditos ≥ 6,000 (visible en el topbar; si falta, admin → ajustar créditos).
- [ ] Migraciones 019-028 aplicadas (ya están en el proyecto Supabase).
- [ ] Assets de prueba listos: 2-3 imágenes de producto + 1 hoja maestra de personaje
      (prompts para generarlos con otra IA: ver conversación "marca LUMEN" o usar cualquier
      producto con empaque consistente; la hoja maestra debe ser frontal, neutra, NO persona real).

---

## 1. Brand Kit (Fase C prereq) ✅ validado

1. [ ] `Brand Kits → Nuevo kit`: nombre, paleta, tono.
2. [ ] Subir **2-3 imágenes de producto** (sección "Imágenes de producto").
3. [ ] (Opcional) Subir **empaque** — habilita el formato El Descubrimiento.
4. [ ] Guardar. **Verificar**: la card muestra el conteo de imágenes.

## 2. Cast ✅ validado (generador IA ⏳)

1. [ ] `Cast → Nuevo personaje`: nombre + **hoja maestra** (obligatoria) + descripción sin edad.
2. [ ] Guardar. **Verificar**: la card muestra el avatar.
   Sin personaje, el plan omite Voz Cercana y A Pie de Calle (esperado, no es bug).
3. [ ] **Generador IA**: escribir solo la descripción → "Generar con IA" → ~15s →
       **Verificar**: la hoja maestra se llena con un retrato frontal neutro acorde a la
       descripción; guardar el personaje y usarlo en una campaña.
4. [ ] **Validación de resolución**: intentar subir una imagen <512px por lado →
       **Verificar**: se rechaza con mensaje claro.

## 3. Campaña y plan ✅ validado (URL, captions y addItem ⏳)

1. [ ] `Campañas → Nueva campaña`: nombre, Brand Kit, objetivo. (El selector de
       volumen ya no existe: la cantidad sale de "Describe lo que imaginas".)
   - [ ] (Nuevo) **URL del producto**: pegar la URL de una página real → el brief detecta
         nombre/tono coherentes con la página. Una URL inválida bloquea con mensaje claro.
   - [ ] (Nuevo) **Plan dirigido**: describir 2-3 ideas (una con cantidad, ej. "3
         unboxings") → el plan tiene exactamente esos creativos, con scene_prompt
         que refleja cada idea; lo que no encaja crea un formato custom.
   - [ ] (Nuevo) **Sin ideas**: dejar el campo vacío → diálogo "¿Cómo armamos el
         plan?"; "Proponer un plan por mí" genera 6 creativos del mix por categoría.
2. [ ] "Analizar producto y armar plan" → **Verificar**:
   - Toast con N creativos y créditos estimados.
   - El plan muestra formatos coherentes con la categoría detectada (camino sin ideas).
   - Escenas variadas, fechas repartidas en ~30 días, personaje solo en formatos UGC.
   - [ ] (Nuevo) Cada fila muestra **"Caption: …"** (gancho + CTA según objetivo + hashtags).
3. [ ] Editar un item y guardar. **Verificar**: el cambio persiste. El editor ahora incluye
       **escena, personaje y caption** además de prompt y fecha.
4. [ ] (Nuevo) **"Agregar creativo"** en el Plan: elegir formato + acción → aparece como
       `planned` con caption generado.
5. [ ] (Nuevo) **Formatos custom**: `Formatos → Nuevo formato` (con "requiere producto") →
       crear campaña nueva → **Verificar**: el formato custom aparece en el plan con las
       semillas genéricas.

## 4. Producción — muestra y lote ✅ validado

1. [ ] Pestaña Producción → en un formato, **"Muestra (2)"**.
2. [ ] **Verificar**: toast con créditos reservados; los 2 items pasan a "muestra…" y el
       balance del topbar baja en vivo.
3. [ ] Esperar ~2-4 min por clip (fast 480p). **Verificar sin recargar** (Realtime): items →
       "draft listo".
4. [ ] Revisar los drafts en la librería de la campaña: producto fiel a las referencias,
       personaje consistente entre clips, sin texto renderizado en pantalla.
   - [ ] (Nuevo) **El diálogo/voz se escucha en español** (o en el idioma elegido en el
         wizard). Campañas creadas antes del fix de idioma siguen generando en inglés:
         crear campaña nueva para validar.
5. [ ] (Nuevo) **Rehacer muestra**: "La muestra no convence: regresar drafts al plan" →
       los drafts vuelven a `planned`; editarlos y volver a tirar muestra cobra de nuevo.
6. [ ] (Nuevo) **CTA de compra**: con balance insuficiente, el toast de bloqueo trae el
       botón "Comprar créditos" que lleva a Billing.

## 5. Draft → final ✅ validado

1. [ ] En un draft: **"Aprobar final 720p"**. **Verificar**: item → "render final…".
2. [ ] Esperar (standard tarda más que fast). **Verificar**: item → "final listo" **solo**
       (sin recargar — esto valida el fix del trigger 026).
3. [ ] El final en la librería: misma composición que el draft (seed fijo), mejor calidad.

---

## 6. Plantillas vivas (Fase D) ⏳ pendiente

1. [ ] Producción → en el final listo: **"Convertir en plantilla"** → nombre → crear.
   **Verificar**: toast de éxito; la pestaña Plantillas muestra la plantilla con su formato.
2. [ ] Pestaña Plantillas → tamaño de serie **2** → **"Generar serie (2)"**.
   **Verificar**:
   - Toast "Serie creada: 2 items".
   - En el Plan: 2 items nuevos con badge **"serie"**, misma acción que el ganador,
     **escenas distintas** entre sí y distintas de la original.
   - Fechas DESPUÉS de la última fecha del calendario existente.
3. [ ] Producción → en el formato de la serie: **"Muestra (2)"** (o lote).
4. [ ] Al terminar, comparar los 2 clips de la serie contra el ganador:
   - [ ] **Estructura/cámara/ritmo se conservan** (es la prueba clave de @Video1).
   - [ ] La escena cambió según lo planificado.
   - [ ] El producto sigue fiel.

## 7. Variante dirigida (Fase D) ⏳ pendiente

> Requiere un segundo personaje en el Cast para "Cambiar personaje"; si solo hay uno,
> probar únicamente "Extender clip".

1. [ ] Producción → en un final: **"Variante" → Extender clip** (+4s, continuación breve).
   **Verificar**: toast; al terminar, en la librería hay un clip de ~4s que continúa el
   movimiento del original (mismo encuadre y luz).
2. [ ] (Opcional) **"Variante" → Cambiar personaje**: mismas acciones y cámara, cara nueva.
3. [ ] (Nuevo) **"Variante" → Cambiar acción**: describir otra acción/desenlace →
   **Verificar**: mismo sujeto, escenario y cámara con la acción nueva.
4. [ ] (Nuevo) **"Variante" → Escena puente** (requiere 2 finales): elegir clip destino →
   **Verificar**: el clip generado arranca donde termina el origen y cierra empatando el
   inicio del destino (continuidad de sujeto/luz/cámara).
5. [ ] (Nuevo) **Marcar ganador**: en un final, botón "Marcar ganador" → queda en ámbar.
   En la **siguiente campaña**, el plan da más items a ese formato (doble peso en el mix).

## 8. Entrega (Fase E) ⏳ pendiente

1. [ ] Pestaña **Calendario**: los creativos aparecen en sus fechas, colores por estado.
2. [ ] **Arrastrar** un creativo a otro día. **Verificar**: se mueve; recargar la página y
       confirmar que persistió.
3. [ ] Botón **CSV** del header. **Verificar**: descarga, abre en Excel/Sheets sin caracteres
       rotos (BOM), las filas con video tienen URL firmada que reproduce al abrirla.
4. [ ] Botón **Reporte**. **Verificar**:
   - Hero card: gasto real en USD y créditos coherentes con lo consumido.
   - Rango tradicional low-mid-high > gasto real; % de ahorro alto.
   - Tabla por tipo de activo solo con los formatos que tienen finales.
5. [ ] Producción → **Pack de imágenes (4)** → "Generar pack".
   **Verificar**: progreso 1/4…4/4 (cada imagen tarda ~10-20 s); al terminar, 4 imágenes en
   la librería de la campaña — posts 1:1 con las escenas de los videos, banner 16:9 con
   espacio vacío para copy, still de producto. Producto fiel en todas.
6. [ ] (Nuevo) **Refinar el pack**: al terminar aparece el bloque "Refinar con Nano Banana";
   dejar la instrucción default (ajustar fondo) → "Refinar el pack" → **Verificar**: N
   ediciones nuevas en la librería con el producto idéntico y el fondo ajustado.
7. [ ] **CSV**: la columna caption va llena para todos los items del plan.

## 9. Admin (Fase E) ⏳ pendiente

1. [ ] `/admin/rate-card` (con el usuario admin): editar el valor mid de un tipo de activo
       y guardar.
2. [ ] Volver al Reporte de la campaña. **Verificar**: el total tradicional refleja el cambio.

---

## 10. Creador manual de video con Seedance ⏳ pendiente

1. [ ] `Crear → Video`: Seedance 2.0 aparece como modelo default, con duración 4-15s,
       resolución por tier (Fast: 480p/720p; Standard: +1080p), 6 proporciones, audio nativo
       y seed opcional.
2. [ ] **t2v**: prompt simple sin referencias → genera (Fast 480p 4s es lo más barato).
3. [ ] **Multi-referencia (@)**: subir 1-2 imágenes (y opcionalmente un mp4 corto o un mp3)
       → los chips muestran @Image1, @Video1, @Audio1; citar al menos una en el prompt con
       propósito ("@Image1 es el producto, empaque exacto") → genera.
4. [ ] **Frame inicial**: con solo 1-2 imágenes subidas, activar "Usar como frame inicial"
       → genera vía image-to-video.
5. [ ] **Brand Kit y Cast**: en "Referencias multimodales", el chip del Brand Kit agrega sus
       imágenes de producto/empaque como @referencias (badge con origen en el thumbnail) y el
       chip de cada personaje agrega su hoja maestra; "Citar en prompt" inserta la frase
       "@ImageN es … " lista para usar; quitar el chip retira sus imágenes. Sin kits/cast se
       muestran links a crearlos.
6. [ ] **Verificar**: costo mostrado = duración × tarifa del tier/resolución; el video llega
       con audio; la generación aparece en la librería.

## Diagnóstico cuando algo falla

| Síntoma | Dónde mirar |
|---|---|
| Item se queda "generando…" >10 min | Supabase → `generations`: `status`, `poll_attempts`, `error_message`. Si `provider_task_id` es null, el submit a fal falló. |
| Item "bloqueado" | `campaign_items.warnings` tiene el motivo (referencia faltante del formato). |
| QStash no llega al worker | `NEXT_PUBLIC_APP_URL` debe ser alcanzable desde internet; revisar dashboard de Upstash → mensajes con error. |
| Créditos descontados sin video | El refund es automático en fallo (`credit_transactions`); si no aparece, revisar `error_message` de la generación. |
| Realtime no actualiza | Consola del navegador: el canal debe suscribirse tras `setAuth`; recargar restaura el estado real. |
| CSV sin URLs | Solo items `draft_ready`/`final_ready` con generación `done` llevan URL; las firmadas expiran (~1 h). |

## Criterio de cierre de V2

Con las secciones 6-9 en verde, V2 está validada de punta a punta y `development` se mergea
a `main`.
