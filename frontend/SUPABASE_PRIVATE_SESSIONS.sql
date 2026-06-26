-- =====================================================================
-- 🔒 Sessions privées (salle d'attente) — colonne is_private sur playlists.
--    À exécuter dans Supabase → SQL Editor. Idempotent.
--
-- L'écriture de is_private est déjà protégée par la policy RLS playlists_update
-- (hôte/co-hôte uniquement) si SUPABASE_RLS_SESSION_SHARING.sql a été appliqué.
-- La lecture est publique (les participants doivent savoir si la session est privée).
-- =====================================================================

ALTER TABLE public.playlists
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
