-- ============================================================================
-- BoostTribe — Page PROMO / AFFICHE de session (configurable par le coach)
-- Colonnes additionnelles sur public.playlists. Idempotent (ADD COLUMN IF NOT EXISTS).
-- Lecture publique servie par le backend (service role) → pas de changement de RLS requis.
-- ============================================================================
alter table public.playlists
  add column if not exists promo_enabled      boolean default false,
  add column if not exists promo_media_url    text,
  add column if not exists promo_media_type   text,    -- 'image' | 'video'
  add column if not exists promo_description  text,
  add column if not exists promo_cta          text,    -- texte du bouton (CTA)
  add column if not exists promo_payment_link text,    -- lien de paiement du coach ; NULL/vide = gratuit
  add column if not exists promo_price        text;    -- prix affiché (ex. "20 CHF")
alter table public.playlists add column if not exists promo_format text;
