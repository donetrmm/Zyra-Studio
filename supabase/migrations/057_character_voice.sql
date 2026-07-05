-- 057_character_voice.sql
-- Enlace voz -> personaje: cada personaje del Cast puede tener una voz asignada
-- (voice_clones, clonada o cargada). En generación, el hablante primario del clip
-- ancla su voz como referencia de timbre (@audio1). Nullable: un personaje sin voz
-- se comporta igual que antes. on delete set null: si se borra la voz, el personaje
-- solo pierde el enlace, no se borra. Ownership (misma workspace) lo valida la
-- server action; la FK solo garantiza integridad referencial.
alter table characters
  add column if not exists voice_clone_id uuid references voice_clones(id) on delete set null;
