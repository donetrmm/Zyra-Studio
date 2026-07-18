# 18 — Biblioteca v2: paginación real y filtros server-side

Estado: fase 1 implementada (2026-07-14). Fase 2 pendiente de diseño fino.

## Problema

La Biblioteca cargaba un máximo de 120 generaciones (`.limit(120)`) y todos los
filtros (búsqueda, favoritos, orden) corrían client-side sobre ese subconjunto:
a partir del elemento 121 el trabajo del usuario era invisible — un favorito
antiguo no aparecía ni con el filtro de favoritos activo. Además, el contador
por campaña traía TODAS las filas con `campaign_id` (sin límite) solo para
contarlas en memoria.

## Fase 1 (implementada)

- **Query compartida** en `lib/library/list.ts` (`fetchLibraryPage`): la usan el
  Server Component (primera página) y `listLibraryAction` (filtros + paginar).
  Página de 60, keyset por `(created_at, id)` — estable con timestamps
  repetidos (lotes de storyboard) e inserciones entre páginas.
- **Filtros server-side** vía `listLibraryAction` (zod en
  `lib/schemas/library.ts`): tipo (imagen/video/audio), solo favoritos,
  búsqueda `ilike` en prompt/model_id, orden recente/antiguo y chip «Estudio»
  que incluye los turnos del estudio creativo (excluidos por default, siguen
  viviendo en su galería de sesión).
- **Cliente**: los filtros disparan refetch con debounce de 300ms y guard de
  respuesta vieja (`listReqId`); `filteredGens` sigue filtrando lo ya cargado
  para feedback inmediato entre teclas. «Cargar más» appende con dedupe por id.
  El sync de props post-`router.refresh` solo pisa el estado cuando los
  filtros están en default (si no, clobberearía el estado filtrado).
- **Contadores**: RPC `library_campaign_counts` (migración 066, `security
  invoker` — respeta RLS) reemplaza la query sin límite.

## Fase 2 (pendiente)

- **Editar en estudio**: abrir una generación de la Biblioteca como lienzo del
  estudio creativo. Requiere un 5º `assetType` (`generation`) en
  `studio_sessions` + ownership check en `ownsAsset` + entrada en el
  `DetailAside`.
- **Promover a activo de marca**: convertir una generación en personaje /
  locación / producto (hoja maestra desde la imagen). Selección de tipo +
  nombre; reusa el pipeline de creación asistida.
- Scroll infinito (IntersectionObserver) en lugar del botón, si el botón se
  siente torpe en uso real.

## Decisiones

- El total del header es el `count` exacto con filtros aplicados (solo se
  calcula al cambiar filtros, no al paginar).
- `sort=old` pagina desde el extremo antiguo (keyset ascendente), no es un
  reverse del cliente.
- Los favoritos se resuelven primero como lista de ids del usuario (acotada) y
  se filtra con `in()` — mantiene RLS simple en la query principal.
