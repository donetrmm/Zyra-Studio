# Setup Supabase (manual)

Pasos a ejecutar una sola vez al crear el proyecto. Asumimos plan Free. Cuando termines, copia las claves al `.env.local` de la raíz.

## 1. Crear proyecto

1. https://supabase.com → New Project.
2. Region: la más cercana al usuario (México central → `us-east-2` o `us-west-1`).
3. Password de la DB: guardarla en password manager — no hace falta a menos que se conecte por psql.
4. Plan: Free.

## 2. Capturar claves para `.env.local`

Dashboard → Project Settings → API:

| Key dashboard | Variable .env.local |
|---|---|
| `Project URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` | `SUPABASE_SERVICE_ROLE_KEY` |

> El `service_role` jamás debe llegar al cliente. Solo se importa desde `lib/supabase/admin.ts`, que es server-side.

## 3. Auth providers

Dashboard → Authentication → Providers.

### Email
- Habilitado por default. Mantener confirmación opcional desactivada para el demo (acelera signup).

### Google OAuth (opcional pero recomendado)
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client (Web app).
2. Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Copiar Client ID y Client Secret.
4. Supabase Dashboard → Authentication → Providers → Google → habilitar y pegar credenciales.
5. Site URL: `http://localhost:3000` para dev. Más URLs en `Additional Redirect URLs`: `https://<deploy>.vercel.app`.

## 4. Configurar admin via GUC

Antes del primer signup admin, en SQL Editor:

```sql
alter database postgres set app.admin_emails = 'iskanderramos8@gmail.com';
```

Después: Dashboard → Settings → Database → **Restart server** (el GUC no se propaga al pool de pgbouncer sin reinicio).

> El trigger `handle_new_user` (migración `003`) lee este GUC al crear el profile. Si el email del nuevo usuario está en la lista, queda como `role='admin'` automáticamente.

**Fallback manual** si el GUC no surte efecto:

```sql
update profiles set role = 'admin' where email = 'iskanderramos8@gmail.com';
```

## 5. Storage buckets

Dashboard → Storage → New bucket. Crear los seis con la visibilidad indicada:

| Bucket | Visibilidad | Notas |
|---|---|---|
| `outputs` | privado | Generaciones finales. Se sirven con signed URLs desde el server. |
| `references` | privado | Uploads de usuarios para usar como referencia. |
| `voice-samples` | privado | Audio para voice cloning. |
| `thumbnails` | público | Cache largo, se sirven directos. |
| `avatars` | público | Avatares de usuario. |
| `brand-assets` | privado | Logos y assets de brand kits. |

## 6. CORS

Supabase Storage actual maneja CORS automáticamente para uploads autenticados y signed URLs — no hay configuración per-bucket en el dashboard. Para uploads directos desde el browser en Fase 2 no hace falta hacer nada extra.

> El spec original mencionaba pegar JSON de CORS por bucket; eso fue una versión anterior de Supabase, ya no aplica.

## 7. Aplicar migraciones

Después de crear el proyecto, aplicar en orden estricto desde `supabase/migrations/`:

```bash
# Opción A: SQL Editor del dashboard
# Copiar el contenido de cada archivo en orden y ejecutar:
#   001_initial_schema.sql
#   002_rls_policies.sql
#   003_functions_and_triggers.sql
#   004_realtime.sql
#   005_seed_pricing.sql

# Opción B: Supabase CLI local (recomendado si vas a tocar varias veces)
# npx supabase link --project-ref <ref>
# npx supabase db push
```

Verificación:

```sql
-- Debe regresar >= 22 filas
select count(*) from model_pricing;

-- Debe listar las 17 tablas con RLS habilitado
select tablename
  from pg_tables
  where schemaname = 'public'
    and rowsecurity = true
  order by tablename;
```

## 8. Smoke test post-setup

1. Hacer signup con `iskanderramos8@gmail.com` desde `/signup` localhost.
2. En SQL Editor: `select role, status from profiles where email = 'iskanderramos8@gmail.com';` → debe ser `admin / active`.
3. `select balance from credit_balances where user_id = (select id from profiles where email = 'iskanderramos8@gmail.com');` → 500.
4. Insertar manualmente una notificación de prueba y verificar que llega al UI via Realtime.

Si algún paso falla, revisar primero el trigger `handle_new_user` con `\df+ handle_new_user` (debe ser `security definer` y owner `postgres`).
