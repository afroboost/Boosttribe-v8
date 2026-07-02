-- ===========================================================================
-- BoostTribe — 2 offres + essai 7 j illimité + débit auto (crédits conservés)
-- Idempotent, sans destruction de données.
-- À exécuter en supabase_admin (Coolify → conteneur supabase-db-...).
--
-- ⚠️ DÉVIATION VOLONTAIRE vs le prompt (§5) :
--   Le prompt place trial_days / auto_charge_enabled / plan_pro_monthly_credits dans site_settings.
--   MAIS le backend (get_pricing_settings / admin_get_trial_config / _grant_pro_monthly_credits)
--   LIT ces réglages dans la table `pricing_settings` (id='default'). trial_days & auto_charge_enabled
--   y existent déjà (infra/admin/trial-config.sql). On les garde donc dans pricing_settings, sinon
--   le backend ne verrait jamais les valeurs. Les prix/labels/visibilité + les Stripe price IDs
--   restent dans site_settings (lus par le Dashboard et par create-checkout/sync-plan).
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1) pricing_settings (id='default') : essai + crédits mensuels offre Utilisateur
-- --------------------------------------------------------------------------
ALTER TABLE public.pricing_settings ADD COLUMN IF NOT EXISTS trial_days integer DEFAULT 7;
ALTER TABLE public.pricing_settings ADD COLUMN IF NOT EXISTS auto_charge_enabled boolean DEFAULT true;
ALTER TABLE public.pricing_settings ADD COLUMN IF NOT EXISTS plan_pro_monthly_credits integer DEFAULT 20;

UPDATE public.pricing_settings SET
  trial_days = 7,
  auto_charge_enabled = true,
  plan_pro_monthly_credits = 20,
  updated_at = now()
WHERE id = 'default';

-- --------------------------------------------------------------------------
-- 2) site_settings : prix d'affichage, visibilité, libellés, Stripe price/product IDs
--    (les colonnes stripe_*_price_id / stripe_product_* sont REQUISES : sinon le PATCH
--     PostgREST de /stripe/sync-plan échoue sur colonne absente.)
-- --------------------------------------------------------------------------
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS plan_pro_visible boolean DEFAULT true;
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS plan_enterprise_visible boolean DEFAULT true;
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS plan_pro_price_monthly text DEFAULT '14.99';
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS plan_pro_price_yearly  text DEFAULT '149.90';
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS plan_enterprise_price_monthly text DEFAULT '99.99';
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS plan_enterprise_price_yearly  text DEFAULT '999.00';
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS plan_pro_label text DEFAULT 'Utilisateur';
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS plan_enterprise_label text DEFAULT 'Coach';
-- Stripe price IDs (remplis par /stripe/sync-plan)
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS stripe_pro_monthly_price_id text;
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS stripe_pro_annual_price_id text;
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS stripe_enterprise_monthly_price_id text;
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS stripe_enterprise_annual_price_id text;
-- Stripe product IDs (remplis par /stripe/sync-plan)
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS stripe_product_pro text;
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS stripe_product_enterprise text;

UPDATE public.site_settings SET
  plan_pro_visible = true,
  plan_enterprise_visible = true,
  plan_pro_price_monthly = '14.99',
  plan_pro_price_yearly  = '149.90',
  plan_enterprise_price_monthly = '99.99',
  plan_enterprise_price_yearly  = '999.00',
  plan_pro_label = COALESCE(NULLIF(plan_pro_label, ''), 'Utilisateur'),
  plan_enterprise_label = COALESCE(NULLIF(plan_enterprise_label, ''), 'Coach');

-- --------------------------------------------------------------------------
-- 3) APRÈS ce SQL : admin → onglet Stripe/plans → sauvegarder (déclenche syncPlan
--    en CHF) pour (re)créer les Stripe Price aux montants ci-dessus et remplir
--    les colonnes stripe_*_price_id.
-- --------------------------------------------------------------------------
