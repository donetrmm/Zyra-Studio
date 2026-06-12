-- 031_campaign_characters.sql
-- Pool de personajes por campaña y multi-personaje por creativo (máx 3).
-- character_id se conserva como PRINCIPAL (= primer elemento del array),
-- sincronizado por las server actions: replace_character, rotateCharacters
-- y la edición del detalle siguen operando sobre él.

alter table campaigns
  add column if not exists character_ids uuid[] not null default '{}';

alter table campaign_items
  add column if not exists character_ids uuid[] not null default '{}';

update campaign_items
  set character_ids = array[character_id]
  where character_id is not null and character_ids = '{}';

comment on column campaigns.character_ids is
  'Pool de personajes de la campaña (máx 3 — validado en server action). Orden significativo: el primero es el principal.';
comment on column campaign_items.character_ids is
  'Personajes del creativo (máx 3). Orden = orden de referencias en el prompt. character_id = principal sincronizado.';
