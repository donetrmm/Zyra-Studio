# Activos para generar en el ESTUDIO (versión realista, sin estilo render)

Complemento del prompt maestro [`showcase-multiambiente-v2-dinamica.md`](./showcase-multiambiente-v2-dinamica.md): describe las referencias (locaciones, productos, cast) que hay que crear en el estudio antes de correr la campaña.

Como los generas en el estudio (sin preset de estilo), el realismo va DENTRO del prompt. Regla clave (la que usa el propio pipeline en `lib/prompt-director/style-profiles.ts`): NO pidas "fotorrealista", "cinematográfico" ni "render" — eso etiqueta imágenes CG que imitan foto y empuja el look de IA. Pide lenguaje de captura (cámara, lente, sombras de contacto, balance de blancos neutro, materiales con desgaste) y niega el render explícito.

Tip: en el compositor del estudio puedes GUARDAR la cláusula de realismo como preset propio para no reescribirla cada vez.

----------------------------------------------------------------
## A. LOCACIONES (5) — generar 16:9 (Nano Banana o gpt-image)
----------------------------------------------------------------

1) Sala mid-century
Sala de estar mid-century acogedora: sofá de tela color arena, madera de nogal, mesa de centro baja, pared de fondo lisa color hueso, ventana lateral con luz natural cálida entrando en diagonal, planta en maceta de barro, tapete de lana. Sin personas, pared sin cuadros. Fotografía real del lugar tomada en locación con cámara full-frame y lente 35mm: luz ambiental creíble con sombras de contacto suaves, colores fieles con balance de blancos neutro (sin dominante amarilla), materiales honestos con desgaste cotidiano sutil, encuadre documental con leve imperfección natural. Un lugar real, no un set montado ni un render 3D, CGI ni ilustración.

2) Recámara principal
Recámara principal serena: cabecera de tela gris claro, cama con sábanas y edredón claros, buró de madera con lámpara, ventana lateral con luz suave de mañana, tonos cálidos neutros. Sin personas, pared sobre la cabecera sin cuadros. Fotografía real del lugar tomada en locación con cámara full-frame y lente 35mm: luz ambiental creíble con sombras de contacto suaves, colores fieles con balance de blancos neutro (sin dominante amarilla), materiales honestos con desgaste cotidiano sutil, encuadre documental con leve imperfección natural. Un lugar real, no un set montado ni un render 3D, CGI ni ilustración.

3) Pasillo/escalera
Pasillo interior con escalera de madera y barandal sencillo, pared lisa color hueso, luz lateral marcada entrando en diagonal, piso de madera. Sin personas, pared sin cuadros. Fotografía real del lugar tomada en locación con cámara full-frame y lente 35mm: luz ambiental creíble con sombras de contacto suaves, colores fieles con balance de blancos neutro (sin dominante amarilla), materiales honestos con desgaste cotidiano sutil, encuadre documental con leve imperfección natural. Un lugar real, no un set montado ni un render 3D, CGI ni ilustración.

4) Estudio en casa
Estudio en casa: escritorio de madera contra la pared, silla, una planta en maceta, libros apilados, luz natural suave lateral, pared lisa neutra. Sin personas, pared sobre el escritorio sin cuadros. Fotografía real del lugar tomada en locación con cámara full-frame y lente 35mm: luz ambiental creíble con sombras de contacto suaves, colores fieles con balance de blancos neutro (sin dominante amarilla), materiales honestos con desgaste cotidiano sutil, encuadre documental con leve imperfección natural. Un lugar real, no un set montado ni un render 3D, CGI ni ilustración.

5) Recámara de niño
Recámara de niño cálida: cómoda de madera clara, decoración infantil suave, algunos juguetes ordenados, luz natural, pared en tono pastel neutro. Sin personas, pared sobre la cómoda sin cuadros. Fotografía real del lugar tomada en locación con cámara full-frame y lente 35mm: luz ambiental creíble con sombras de contacto suaves, colores fieles con balance de blancos neutro (sin dominante amarilla), materiales honestos con desgaste cotidiano sutil, encuadre documental con leve imperfección natural. Un lugar real, no un set montado ni un render 3D, CGI ni ilustración.

----------------------------------------------------------------
## B. PRODUCTOS / CANVAS (5) — generar en el aspecto del canvas
----------------------------------------------------------------
Ficha común: canvas print sin marco · acabado mate · canto ultradelgado ~0.7 cm (imagen envolvente) · respaldo MDF con colgador dentado. Si tienes la foto real del cliente, súbela como imagen impresa.

1) Canvas Familiar — 90×60 cm (aspecto 3:2)
Un canvas print rectangular horizontal sin marco, acabado mate, canto ultradelgado (~0.7 cm) con la imagen envolviendo el borde, colgado sobre una pared lisa neutra. La imagen impresa es una foto de familia cálida. Toma de producto real y limpia, con cámara full-frame: luz de producto suave, sombras de contacto sutiles, colores fieles con balance de blancos neutro (sin dominante amarilla), textura mate del lienzo visible, materiales honestos. No es un render 3D, CGI ni ilustración. Sin texto.

2) Retrato de Pareja — 40×60 cm (aspecto 2:3)
Un canvas print vertical sin marco, acabado mate, canto ultradelgado (~0.7 cm) con la imagen envolviendo el borde. La imagen impresa es un retrato cálido de una pareja. Toma de producto real y limpia, con cámara full-frame: luz de producto suave, sombras de contacto sutiles, colores fieles con balance de blancos neutro (sin dominante amarilla), textura mate del lienzo visible, materiales honestos. No es un render 3D, CGI ni ilustración. Sin texto.

3) Candid en Blanco y Negro — 50×50 cm (aspecto 1:1)
Un canvas print cuadrado sin marco, acabado mate, canto ultradelgado (~0.7 cm). La imagen impresa es una foto candid en blanco y negro de alto contraste. Toma de producto real y limpia, con cámara full-frame: luz de producto suave, sombras de contacto sutiles, colores fieles con balance de blancos neutro, textura mate del lienzo visible, materiales honestos. No es un render 3D, CGI ni ilustración. Sin texto.

4) Paisaje de Viaje — 70×50 cm (aspecto 3:2)
Un canvas print horizontal sin marco, acabado mate, canto ultradelgado (~0.7 cm) con la imagen envolviendo el borde. La imagen impresa es un paisaje de viaje (costa o montaña al atardecer). Toma de producto real y limpia, con cámara full-frame: luz de producto suave, sombras de contacto sutiles, colores fieles con balance de blancos neutro (sin dominante amarilla), textura mate del lienzo visible, materiales honestos. No es un render 3D, CGI ni ilustración. Sin texto.

5) Foto del Peque — 40×40 cm (aspecto 1:1)
Un canvas print cuadrado sin marco, acabado mate, canto ultradelgado (~0.7 cm). La imagen impresa es una foto cálida de un niño sonriendo. Toma de producto real y limpia, con cámara full-frame: luz de producto suave, sombras de contacto sutiles, colores fieles con balance de blancos neutro (sin dominante amarilla), textura mate del lienzo visible, materiales honestos. No es un render 3D, CGI ni ilustración. Sin texto.

(Opcional — detalle del canto para el clip 7, aspecto 1:1 o 3:2)
Vista 3/4 en primer plano del canto ultradelgado de un canvas print mate, la imagen envolviendo el borde. Toma de producto real, con cámara full-frame y luz rasante sobre la textura mate: sombras de contacto sutiles, colores fieles con balance de blancos neutro, materiales honestos. No es un render 3D, CGI ni ilustración. Sin texto.

----------------------------------------------------------------
## C. CAST: Luz — generar retrato 3:4
----------------------------------------------------------------
Retrato frontal de una mujer joven latina de unos 30 años, cabello castaño ondulado a los hombros, expresión neutra cálida, blusa de lino color crema, mirando a cámara. Fotografía real sin retoque, con cámara full-frame y lente retrato 85mm: piel natural con poros y textura visibles, ligera asimetría facial natural, ojos y cabello fieles, luz de estudio suave y pareja, fondo gris claro liso, foco nítido en el rostro, balance de blancos neutro, sin retoque de belleza. Una persona ficticia fotografiada de verdad; no un render 3D, CGI ni ilustración.

Voz: asígnale una voz cálida es-MX en Marca › Voces y enlázala a Luz.

----------------------------------------------------------------
## D. FIGURANTES (pareja, peque, persona)
----------------------------------------------------------------
No requieren activo. En los clips van de 3/4 o de espaldas, silenciosos, a media distancia.
