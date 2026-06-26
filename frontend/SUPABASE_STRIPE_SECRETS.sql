-- =====================================================================
-- 🔒 Table stripe_secrets — stockage CHIFFRÉ de la clé secrète Stripe (sk_...)
--    Accessible UNIQUEMENT via la service-role (backend). RLS activée SANS policy
--    → la clé anon/authenticated ne peut JAMAIS lire/écrire cette table.
--    À exécuter dans Supabase → SQL Editor. Idempotent.
--
-- La valeur stockée est chiffrée au repos (Fernet, APP_ENCRYPTION_KEY côté backend).
-- La clé n'apparaît jamais dans le bundle frontend ni dans site_settings.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.stripe_secrets (
  id            text PRIMARY KEY,        -- ex. 'stripe_secret_key'
  value_encrypted text NOT NULL,         -- jeton Fernet (chiffré)
  updated_at    timestamptz DEFAULT now()
);

-- RLS activée, AUCUNE policy → seul le service-role (qui bypass la RLS) y accède.
ALTER TABLE public.stripe_secrets ENABLE ROW LEVEL SECURITY;

-- Par sécurité, retirer toute policy qui aurait pu être créée auparavant.
DROP POLICY IF EXISTS "stripe_secrets_all"    ON public.stripe_secrets;
DROP POLICY IF EXISTS "stripe_secrets_select" ON public.stripe_secrets;
DROP POLICY IF EXISTS "stripe_secrets_insert" ON public.stripe_secrets;
DROP POLICY IF EXISTS "stripe_secrets_update" ON public.stripe_secrets;

-- Révoquer explicitement l'accès des rôles anon/authenticated (ceinture + bretelles).
REVOKE ALL ON public.stripe_secrets FROM anon, authenticated;

-- (Optionnel) Colonne pour la clé publique : elle reste dans site_settings (lisible frontend),
-- ce SQL ne s'en occupe pas. Le backend écrit site_settings.stripe_public_key via service-role.
