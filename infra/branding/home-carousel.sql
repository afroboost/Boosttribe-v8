-- ============================================================================
-- BoostTribe — Carrousel d'images d'accueil (géré depuis l'admin « Identité »)
-- Colonne JSONB sur site_settings : tableau de { url, alt }. Idempotent.
-- ============================================================================
alter table public.site_settings
  add column if not exists home_carousel jsonb default '[]'::jsonb;
