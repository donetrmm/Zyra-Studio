-- 028_winners.sql
-- Ciclo de aprendizaje (doc V2 §4.1 etapa 5): marcar creativos ganadores.
-- El planner sobre-pondera los formatos con ganadores (items marcados o
-- plantillas destiladas) en el mix de la siguiente campaña.

alter table campaign_items
  add column if not exists is_winner boolean not null default false;

comment on column campaign_items.is_winner is
  'Creativo marcado como ganador por el usuario; alimenta el mix recomendado de campañas futuras.';
