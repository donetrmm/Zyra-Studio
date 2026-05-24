-- 008_storage_thumbnails_no_listing.sql
-- Cierra el advisor `public_bucket_allows_listing` introducido por la 007:
-- el bucket `thumbnails` es público (bucket.public = true) y los URLs públicos
-- funcionan sin policy. Tener una SELECT policy abierta permite además LISTAR
-- todos los archivos del bucket, lo que expone más de lo necesario.

drop policy if exists "thumbnails_public_select" on storage.objects;
