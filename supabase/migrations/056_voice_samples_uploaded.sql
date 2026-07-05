-- 056_voice_samples_uploaded.sql
-- Voces CARGADAS (no clonadas): el usuario sube un audio ya terminado y se
-- guarda tal cual como voz (voice_clones con sample_storage_url y
-- elevenlabs_voice_id NULL). Solo hace falta ampliar los tipos MIME del bucket
-- voice-samples: m4a/mp4/aac son formatos comunes de grabaciones/locuciones que
-- la definición original (013) no aceptaba. Sin cambios de esquema: la tabla
-- voice_clones ya tiene sample_storage_url y elevenlabs_voice_id es nullable.
update storage.buckets
set allowed_mime_types = array[
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg',
  'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'
]
where id = 'voice-samples';
