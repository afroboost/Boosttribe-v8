-- =====================================================================
-- 📱 PAWAPAY — Payer AVANT inscription : accès payé EN ATTENTE (rattaché à l'email)
--    Migration ADDITIVE, idempotente, service-role only. N'altère AUCUNE donnée Stripe.
--    À exécuter dans Supabase → SQL Editor (après SUPABASE_PAWAPAY.sql).
-- =====================================================================

-- --------------------------------------------------------------------
-- 1) Abonnements payés en attente (acheteur pas encore inscrit) → activés à /pawapay/claim.
--    tx_ref UNIQUE (= depositId) → le callback n'insère qu'une fois. claimed_at posé une seule fois.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pawapay_pending_access (
  id              bigserial PRIMARY KEY,
  email           text NOT NULL,
  kind            text NOT NULL DEFAULT 'subscription',
  plan            text,
  interval        text,
  days            int,
  tx_ref          text UNIQUE,
  created_at      timestamptz DEFAULT now(),
  claimed_at      timestamptz,
  claimed_user_id text
);
CREATE INDEX IF NOT EXISTS pawapay_pending_email_idx
  ON public.pawapay_pending_access (email) WHERE claimed_at IS NULL;

ALTER TABLE public.pawapay_pending_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pawapay_pending_access_all" ON public.pawapay_pending_access;
REVOKE ALL ON public.pawapay_pending_access FROM anon, authenticated;

-- --------------------------------------------------------------------
-- 2) Billets : colonne buyer_email (déjà présente pour Stripe → IF NOT EXISTS, sans risque)
--    + index pour retrouver vite les billets payés anonymement à rattacher (buyer_user_id NULL).
-- --------------------------------------------------------------------
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS buyer_email text;
CREATE INDEX IF NOT EXISTS tickets_pending_claim_idx
  ON public.tickets (buyer_email) WHERE buyer_user_id IS NULL;
