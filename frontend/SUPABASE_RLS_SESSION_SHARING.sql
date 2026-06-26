-- =====================================================================
-- 🔒 SÉCURITÉ — Partage de média réservé à l'HÔTE de la session (host_id)
--    et aux CO-ANIMATEURS (cohosts). À exécuter dans Supabase → SQL Editor.
--
-- Contexte : la policy historique `playlists_all FOR ALL USING (true) WITH CHECK (true)`
-- autorisait N'IMPORTE QUEL utilisateur (même un simple participant) à écrire
-- `shared_media` (et tracks/description) dans la session d'un AUTRE. Ce fichier la
-- remplace par des règles qui n'autorisent l'écriture qu'au propriétaire (host_id)
-- ou aux co-animateurs déclarés (cohosts).
--
-- NB :
--  • La LECTURE reste publique (les participants doivent voir tracks/shared_media).
--  • Le backend écrit host_id / cohosts avec la SERVICE_ROLE_KEY → bypass RLS (OK).
--  • host_id et cohosts stockent l'UID auth (sous forme texte) ; on caste en ::text
--    des deux côtés pour rester indépendant du type exact (uuid/text).
-- =====================================================================

-- ---------- TABLE playlists ----------
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

-- Supprimer l'ancienne policy permissive (la faille)
DROP POLICY IF EXISTS "playlists_all"    ON public.playlists;
DROP POLICY IF EXISTS "playlists_select" ON public.playlists;
DROP POLICY IF EXISTS "playlists_insert" ON public.playlists;
DROP POLICY IF EXISTS "playlists_update" ON public.playlists;
DROP POLICY IF EXISTS "playlists_delete" ON public.playlists;

-- Lecture : publique (nécessaire aux participants pour suivre la session)
CREATE POLICY "playlists_select" ON public.playlists
  FOR SELECT
  USING (true);

-- Création : un utilisateur authentifié peut amorcer une session
-- (host_id encore NULL le temps que le backend la revendique, ou déjà = lui-même)
CREATE POLICY "playlists_insert" ON public.playlists
  FOR INSERT TO authenticated
  WITH CHECK (
    host_id IS NULL
    OR (host_id)::text = (auth.uid())::text
  );

-- Mise à jour (tracks, shared_media, description…) : UNIQUEMENT l'hôte propriétaire
-- OU un co-animateur déclaré. (host_id NULL toléré juste avant le claim initial.)
CREATE POLICY "playlists_update" ON public.playlists
  FOR UPDATE TO authenticated
  USING (
    host_id IS NULL
    OR (host_id)::text = (auth.uid())::text
    OR (auth.uid())::text = ANY (COALESCE(cohosts, ARRAY[]::text[]))
  )
  WITH CHECK (
    host_id IS NULL
    OR (host_id)::text = (auth.uid())::text
    OR (auth.uid())::text = ANY (COALESCE(cohosts, ARRAY[]::text[]))
  );

-- Suppression : seulement l'hôte propriétaire
CREATE POLICY "playlists_delete" ON public.playlists
  FOR DELETE TO authenticated
  USING ((host_id)::text = (auth.uid())::text);

-- ---------- TABLE session_media ----------
-- (média partagé persistant : owner_id, session_id, storage_path, url, media_type, created_at)
ALTER TABLE public.session_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_media_all"    ON public.session_media;
DROP POLICY IF EXISTS "session_media_select" ON public.session_media;
DROP POLICY IF EXISTS "session_media_insert" ON public.session_media;
DROP POLICY IF EXISTS "session_media_delete" ON public.session_media;

-- Lecture : publique (le média partagé est visible par les participants)
CREATE POLICY "session_media_select" ON public.session_media
  FOR SELECT
  USING (true);

-- Insertion : on doit être le propriétaire de la ligne ET hôte/co-animateur de la session.
CREATE POLICY "session_media_insert" ON public.session_media
  FOR INSERT TO authenticated
  WITH CHECK (
    (owner_id)::text = (auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.playlists p
      WHERE p.session_id = session_media.session_id
        AND (
          (p.host_id)::text = (auth.uid())::text
          OR (auth.uid())::text = ANY (COALESCE(p.cohosts, ARRAY[]::text[]))
        )
    )
  );

-- Suppression : le propriétaire de la ligne ou l'hôte de la session
CREATE POLICY "session_media_delete" ON public.session_media
  FOR DELETE TO authenticated
  USING (
    (owner_id)::text = (auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.playlists p
      WHERE p.session_id = session_media.session_id
        AND (p.host_id)::text = (auth.uid())::text
    )
  );

-- =====================================================================
-- Vérification rapide : un participant (auth.uid() != host_id et hors cohosts)
-- ne doit PAS pouvoir UPDATE playlists.shared_media ni INSERT session_media.
-- =====================================================================
