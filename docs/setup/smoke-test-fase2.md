# Smoke test — Fase 2

Checklist manual para validar generación de imagen (Nano Banana + FLUX), uploads directos, biblioteca y compras simbólicas. Requiere Fase 1 cerrada (ver [`smoke-test-fase1.md`](./smoke-test-fase1.md)) y haber completado [`api-keys.md`](./api-keys.md).

## 0. Pre-vuelo

- [ ] `pnpm install` corre sin errores.
- [ ] `pnpm typecheck` pasa.
- [ ] `pnpm lint` pasa.
- [ ] `pnpm build` pasa.
- [ ] `.env.local` tiene `GEMINI_API_KEY` y `BFL_API_KEY` con valores reales (no placeholders).
- [ ] En Supabase SQL Editor:

  ```sql
  -- Migraciones 007 + 008 aplicadas
  select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects';
  -- → refs_member_select, refs_member_insert, refs_owner_delete, outputs_member_select
  -- (NO debe estar thumbnails_public_select; lo quita la 008)

  -- Balance del admin con créditos para probar
  select balance from credit_balances
    where user_id = (select id from profiles where email = 'iskanderramos8@gmail.com');
  -- → ≥ 200 (Nano Banana Pro 2K cuesta 90, FLUX 1MP cuesta 25)
  ```

Arranca: `pnpm dev` → http://localhost:3000.

## 1. Pantalla de generación

- [ ] Login con admin → `/app`.
- [ ] Sidebar → **Crear → Imagen** → `/app/create/image`.
- [ ] Layout muestra 2 columnas en desktop. Mobile colapsa a stack.
- [ ] Selector de modelo presenta 4 cards: **Auto**, **Nano Banana Pro**, **Nano Flash**, **FLUX 2 Pro**.
- [ ] Por default está seleccionado **Nano Banana Pro**.
- [ ] El **CostPreview** muestra `90` créditos (Pro 2K). Cambiar resolución a 1K → baja a 60. A 4K → sube a 120 + warning amarillo de tiempo.
- [ ] Toggle **Edición conversacional** ON → costo sube ×1.5 (90 → 135).
- [ ] Toggle **Grounding** ON encima → costo sube ×1.2 más (135 → 162). Ambos OFF para los pasos siguientes.

## 2. Nano Banana Pro 2K (golden path)

Mantén una segunda pestaña con `/app` abierta para observar la pill de créditos en vivo.

- [ ] Prompt: `Una manzana roja brillante sobre un fondo blanco minimalista, fotografía de estudio con luz suave`.
- [ ] Resolución **2K**, aspect ratio **1:1**.
- [ ] **CostPreview** = 90, balance suficiente, botón **Generar** habilitado.
- [ ] Click **Generar** → botón muestra spinner "Generando…".
- [ ] En la pestaña de `/app`, la pill de créditos baja de inmediato (reserva) y se queda con `pending` durante el procesado.
- [ ] En <30s el panel derecho muestra la imagen real (no la skeleton).
- [ ] Al completar: el balance refleja el cobro definitivo (sin doble débito).
- [ ] Aparece toast verde "Imagen lista".
- [ ] La sección "Esta sesión" abajo muestra un thumbnail de la imagen.

Verificación SQL paralela:

```sql
select status, model_id, credits_estimated, credits_charged, processing_ms
  from generations
  order by created_at desc limit 1;
-- → done / gemini-3-pro-image-preview / 90 / 90 / <30000

select output_url, thumbnail_url from generations order by created_at desc limit 1;
-- → outputs/<ws>/<gen>/output.{jpg,png} | thumbnails/<ws>/<gen>/thumb.jpg
```

## 3. FLUX 2 Pro 1MP

- [ ] Cambiar modelo a **FLUX 2 Pro**. Los toggles de Nano desaparecen; aparece **Megapixels** (1/2/4) y **Photoreal**.
- [ ] Megapixels **1 MP** → costo `25`.
- [ ] Prompt: `Cinematic portrait of an elderly Mexican artisan in CDMX market at golden hour, 85mm lens`.
- [ ] Generar. La generación debe completar en <30s (FLUX típicamente 8–15s).
- [ ] La imagen aparece en panel derecho.

## 4. Upload directo de referencias (Network tab)

Abre DevTools → Network → filtra por `supabase.co`.

- [ ] Volver a Nano Banana Pro. En el panel de referencias, arrastra una imagen `.jpg` o `.png` de tu disco (< 10 MB).
- [ ] **CRÍTICO**: en Network debe verse:
  1. Un `POST` a `localhost:3000` (la server action que pide el signed URL).
  2. Un `PUT` directo a `<project>.supabase.co/storage/v1/...` con tu archivo. **NO a Vercel/localhost**.
- [ ] El thumbnail aparece en la grilla de referencias del panel.
- [ ] Subir un archivo > 10 MB → toast "supera 10 MB", no se sube.
- [ ] Subir un `.pdf` → toast "no es una imagen válida".

Verificación SQL:

```sql
select id, storage_url, type, source from media_references
  order by created_at desc limit 3;
-- → image / upload / <ws>/<user>/<uuid>-<filename>
```

## 5. Generación con referencias

- [ ] Con 1–2 referencias cargadas en el panel, vuelve a generar Nano Banana Pro 2K.
- [ ] Prompt: `Mismo estilo y composición que las referencias, pero cambia el sujeto a una flor`.
- [ ] La imagen resultante debe respetar visiblemente el estilo de las referencias.
- [ ] Network: el server action lee las refs desde `outputs/`-style por `download` admin (server-side), no las re-sube; no debe haber tráfico cliente-cliente hacia `*.supabase.co` para las refs durante el generate.

## 6. Biblioteca

- [ ] Click **Library** en la sidebar → `/app/library`.
- [ ] Tab **Generaciones** activo. Grid muestra las 3 generaciones recientes con thumbnails.
- [ ] Filtro **Tipo → Imagen** mantiene las 3. **Video / Audio** vacían el grid.
- [ ] Filtro **Modelo → FLUX** deja 1 fila. **Nano Banana** deja 2.
- [ ] Click en la card de FLUX → modal con la imagen grande, badges (modelo, créditos, status) y botón **Descargar**.
- [ ] Click **Descargar** → el browser descarga el archivo desde `*.supabase.co` (signed URL).
- [ ] Cerrar el modal y abrir tab **Referencias** → muestra las que subiste en §4.

## 7. Compras simbólicas — flujo user

En navegador privado con la sesión de un user normal (no admin):

- [ ] Sidebar → **Billing** → `/app/billing`.
- [ ] Card del balance muestra los créditos actuales.
- [ ] 4 cards de packs: **Starter** ($99 / 2K), **Creator** ($399 / 10K), **Pro** ($1,499 / 50K), **Studio** ($4,999 / 200K). **Creator** marcado como recomendado.
- [ ] Click **Comprar** en Starter → toast "Compra creada. Espera la aprobación del admin."
- [ ] Pestaña **Pendientes** muestra 1 fila con `Starter / 2,000 créditos / $99 MXN` y badge "Pendiente".
- [ ] Click **Comprar** en Starter de nuevo → toast "Ya tienes una compra pendiente de este pack."

Verificación SQL:

```sql
select pack_id, status, credits, price_mxn from credit_purchases
  where user_id = (select id from profiles where email = 'usuario-prueba@example.com')
  order by created_at desc;
-- → starter / pending / 2000 / 99.00
```

## 8. Compras simbólicas — aprobación admin

En la sesión admin, otra pestaña abierta en `/app` para ver el balance del user de prueba... espera, no: para ver el balance del user en vivo necesitas la **sesión del user** abierta. Mantén una pestaña con `/app` o `/app/billing` del user normal.

- [ ] Como admin, abrir `/admin/purchases`. La compra de Starter del user aparece en tab **Pendientes (1)**.
- [ ] Click **Aprobar** → toast verde "Compra aprobada".
- [ ] El contador del tab cambia a Pendientes (0) y la fila se mueve a **Aprobadas**.
- [ ] En la pestaña del user: la pill de créditos sube **en vivo** (+2,000) sin recargar.
- [ ] El bell de notificaciones del user marca punto rojo y al abrir muestra "Recibiste créditos por tu compra".

Verificación SQL:

```sql
select status, approved_by, approved_at from credit_purchases
  where pack_id = 'starter' and user_id = (select id from profiles where email = 'usuario-prueba@example.com');
-- → approved / <admin uuid> / <timestamp reciente>

select reason, delta from credit_transactions
  where user_id = (select id from profiles where email = 'usuario-prueba@example.com')
  order by created_at desc limit 3;
-- → purchase_approved +2000

select action, payload from admin_audit_log order by created_at desc limit 1;
-- → purchase_approve, {credits: 2000}
```

## 9. Compras simbólicas — rechazo

- [ ] Como user normal, comprar pack **Pro**.
- [ ] Como admin en `/admin/purchases`, click **Rechazar** → dialog pide motivo.
- [ ] Motivo de 1–2 chars → botón Rechazar deshabilitado (validación ≥ 3 chars).
- [ ] Motivo `Prueba de rechazo` → click Rechazar → toast "Compra rechazada".
- [ ] La fila se mueve a tab **Rechazadas**, mostrando la nota.
- [ ] En la sesión del user: balance **NO** cambia, bell muestra notificación con el motivo.

## 10. Edge cases de generación

### Créditos insuficientes

- [ ] Como user nuevo con menos de 90 créditos: intentar generar Nano Banana Pro 2K. El botón **Generar** debe estar **deshabilitado** y mostrar `Te faltan N créditos`.
- [ ] Forzar via DevTools (deshabilitar disabled del botón y submit) → toast "Créditos insuficientes para esta generación.", balance no cambia, no se crea fila en `generations`.

### Safety filter

- [ ] Prompt diseñado para violar políticas (ej. una palabra explícita explícita o contenido violento gráfico). Generar.
- [ ] La generación debe fallar con toast "El proveedor rechazó el contenido por políticas de seguridad."
- [ ] **El balance vuelve al valor original en vivo** (refund automático).

Verificación SQL:

```sql
select status, error_message, credits_charged from generations
  order by created_at desc limit 1;
-- → failed / "rechazó el contenido…" / null

select reason from credit_transactions
  where user_id = (select id from profiles where email = 'iskanderramos8@gmail.com')
  order by created_at desc limit 2;
-- → generation_refund (más reciente), generation_charge
```

### 4K cerca del límite

- [ ] Generar Nano Banana Pro 4K. Verificar que el `processing_ms` esté por debajo de 55,000 (el server action aborta a 60s).
- [ ] Si revienta el timeout: la fila queda `failed` y el balance vuelve completo.

## 11. Auditoría y consistencia

```sql
-- No debe haber generaciones huérfanas (charged sin output_url)
select count(*) from generations
  where status = 'done' and (output_url is null or thumbnail_url is null);
-- → 0

-- No debe haber pending crédito sin reflejo en balance
select user_id, sum(case when delta < 0 then -delta else 0 end) as cargos,
       sum(case when delta > 0 then delta else 0 end) as ingresos
  from credit_transactions
  group by user_id;
-- Cuadrar mentalmente con credit_balances.balance + pending por user.
```

## Criterios de aceptación de Fase 2

| Criterio | Estado |
|---|---|
| Generar Nano Banana Pro 2K en <30s end-to-end | ⬜ |
| Balance baja en topbar en vivo (Realtime) sin recargar | ⬜ |
| Generar FLUX 2 Pro 1MP aparece con thumbnail en biblioteca | ⬜ |
| Botón Generar deshabilitado si cost > balance; server action también lo rechaza si se fuerza | ⬜ |
| Upload de imagen 5 MB como referencia va directo a `*.supabase.co` (verificable en Network) | ⬜ |
| Comprar pack como user → aparece en `/admin/purchases` → aprobar → balance sube en vivo + notificación | ⬜ |
| Rechazar pack → status pasa a rejected con motivo, notificación al user | ⬜ |
| Generación fallida por safety devuelve créditos automáticamente | ⬜ |
| Outputs servidos directo desde Supabase (no proxiados por Next) | ⬜ |

Cuando todos estén checked, Fase 2 está cerrada y se puede empezar Fase 3.
