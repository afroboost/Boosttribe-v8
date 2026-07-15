-- =====================================================================
-- 📱 FLUTTERWAVE — Mobile Money (Orange Money, MTN MoMo, Wave, M-Pesa…)
--    Migration ADDITIVE, à exécuter dans Supabase → SQL Editor. Idempotente.
--    N'altère AUCUNE donnée Stripe existante (billets, abonnements, crédits).
-- =====================================================================

-- --------------------------------------------------------------------
-- 1) Secrets Flutterwave CHIFFRÉS (comme stripe_secrets) — service-role only.
--    encrypted_* = jetons Fernet (APP_ENCRYPTION_KEY côté backend). RLS sans policy.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flutterwave_secrets (
  id                       text PRIMARY KEY DEFAULT 'default',
  encrypted_secret_key     text,   -- clé secrète (FLWSECK-…) chiffrée
  encrypted_encryption_key text,   -- clé de chiffrement Flutterwave chiffrée
  encrypted_webhook_hash   text,   -- hash secret du webhook chiffré
  updated_at               timestamptz DEFAULT now()
);
ALTER TABLE public.flutterwave_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "flutterwave_secrets_all"    ON public.flutterwave_secrets;
DROP POLICY IF EXISTS "flutterwave_secrets_select" ON public.flutterwave_secrets;
REVOKE ALL ON public.flutterwave_secrets FROM anon, authenticated;

-- --------------------------------------------------------------------
-- 2) Idempotence webhook : un tx_ref n'est traité qu'UNE fois. Service-role only.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flw_processed (
  tx_ref     text PRIMARY KEY,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.flw_processed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "flw_processed_all" ON public.flw_processed;
REVOKE ALL ON public.flw_processed FROM anon, authenticated;

-- --------------------------------------------------------------------
-- 3) Billets : colonnes ADDITIVES pour tracer un paiement mobile money.
--    provider par défaut 'stripe' → les billets Stripe existants restent inchangés.
--    Index UNIQUE sur tx_ref (partiel : ignore les billets Stripe où tx_ref est NULL)
--    → l'insertion mobile money est idempotente (ON CONFLICT tx_ref).
-- --------------------------------------------------------------------
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS provider      text DEFAULT 'stripe';
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS tx_ref        text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS paid_currency text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS paid_amount   numeric;
CREATE UNIQUE INDEX IF NOT EXISTS tickets_tx_ref_uidx
  ON public.tickets (tx_ref) WHERE tx_ref IS NOT NULL;

-- --------------------------------------------------------------------
-- 4) site_settings : clé publique (lisible frontend) + table de taux CHF→local.
--    ⚠️ Ajuste flw_fx_rates avec tes VRAIS taux avant d'encaisser.
-- --------------------------------------------------------------------
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS flutterwave_public_key text;
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS flw_fx_rates           jsonb;

-- Valeurs de départ (indicatives) — éditables ensuite depuis l'admin.
UPDATE public.site_settings
   SET flw_fx_rates = COALESCE(flw_fx_rates,
       '{"XOF":655,"XAF":655,"GHS":16,"KES":145,"NGN":1700}'::jsonb)
 WHERE id = 1;
