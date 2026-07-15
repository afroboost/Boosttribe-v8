-- =====================================================================
-- 📱 PAWAPAY — Mobile Money (Orange, MTN, Moov, Wave/Free, M-Pesa, Airtel…)
--    Migration ADDITIVE, à exécuter dans Supabase → SQL Editor. Idempotente.
--    N'altère AUCUNE donnée Stripe. Auto-suffisante (inclut les colonnes
--    tickets même si la migration Flutterwave n'a pas été exécutée).
-- =====================================================================

-- --------------------------------------------------------------------
-- 1) Token PawaPay CHIFFRÉ (Fernet, APP_ENCRYPTION_KEY côté backend). Service-role only.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pawapay_secrets (
  id                  text PRIMARY KEY DEFAULT 'default',
  encrypted_api_token text,
  updated_at          timestamptz DEFAULT now()
);
ALTER TABLE public.pawapay_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pawapay_secrets_all" ON public.pawapay_secrets;
REVOKE ALL ON public.pawapay_secrets FROM anon, authenticated;

-- --------------------------------------------------------------------
-- 2) Dépôts PawaPay : mémorise depositId → métadonnées (le callback ne renvoie que l'id + statut)
--    et sert d'idempotence (processed_at posé une seule fois). Service-role only.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pawapay_deposits (
  deposit_id   text PRIMARY KEY,
  meta         jsonb,
  created_at   timestamptz DEFAULT now(),
  processed_at timestamptz
);
ALTER TABLE public.pawapay_deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pawapay_deposits_all" ON public.pawapay_deposits;
REVOKE ALL ON public.pawapay_deposits FROM anon, authenticated;

-- --------------------------------------------------------------------
-- 3) Billets : colonnes ADDITIVES pour tracer un paiement mobile money.
--    (déjà présentes si la migration Flutterwave a été exécutée → IF NOT EXISTS)
--    Index UNIQUE partiel sur tx_ref → insertion idempotente (ON CONFLICT tx_ref).
-- --------------------------------------------------------------------
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS provider      text DEFAULT 'stripe';
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS tx_ref        text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS paid_currency text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS paid_amount   numeric;
CREATE UNIQUE INDEX IF NOT EXISTS tickets_tx_ref_uidx
  ON public.tickets (tx_ref) WHERE tx_ref IS NOT NULL;

-- --------------------------------------------------------------------
-- 4) site_settings : base URL (sandbox/prod) + table de taux CHF→local.
--    ⚠️ Ajuste pawapay_fx_rates avec tes VRAIS taux avant d'encaisser.
-- --------------------------------------------------------------------
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS pawapay_base_url text;
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS pawapay_fx_rates jsonb;

UPDATE public.site_settings
   SET pawapay_base_url = COALESCE(pawapay_base_url, 'https://api.sandbox.pawapay.io'),
       pawapay_fx_rates = COALESCE(pawapay_fx_rates,
         '{"XOF":655,"XAF":655,"GHS":16,"KES":145,"NGN":1700}'::jsonb)
 WHERE id = 1;
