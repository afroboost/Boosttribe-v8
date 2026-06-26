-- =====================================================================
-- 🔒 RLS — Likes & commentaires de session (session_likes, session_comments)
--    Objectif : TOUT utilisateur AUTHENTIFIÉ (hôte OU participant) peut liker et
--    commenter ses PROPRES lignes ; lecture publique ; suppression de sa propre ligne.
--    À exécuter dans Supabase → SQL Editor. Idempotent (DROP IF EXISTS + CREATE).
--
-- Le bug "le participant ne peut pas commenter/liker" venait d'un INSERT refusé par le
-- RLS (ou RLS activé sans policy d'insertion). Ces policies l'autorisent pour auth.uid().
-- =====================================================================

-- ---------- session_likes ----------
ALTER TABLE public.session_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_likes_all"    ON public.session_likes;
DROP POLICY IF EXISTS "session_likes_select" ON public.session_likes;
DROP POLICY IF EXISTS "session_likes_insert" ON public.session_likes;
DROP POLICY IF EXISTS "session_likes_delete" ON public.session_likes;

-- Lecture publique (compteur visible par tous)
CREATE POLICY "session_likes_select" ON public.session_likes
  FOR SELECT
  USING (true);

-- Insertion : tout authentifié, pour SA propre ligne uniquement
CREATE POLICY "session_likes_insert" ON public.session_likes
  FOR INSERT TO authenticated
  WITH CHECK ((user_id)::text = (auth.uid())::text);

-- Suppression : uniquement sa propre ligne (toggle unlike)
CREATE POLICY "session_likes_delete" ON public.session_likes
  FOR DELETE TO authenticated
  USING ((user_id)::text = (auth.uid())::text);

-- ---------- session_comments ----------
ALTER TABLE public.session_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_comments_all"    ON public.session_comments;
DROP POLICY IF EXISTS "session_comments_select" ON public.session_comments;
DROP POLICY IF EXISTS "session_comments_insert" ON public.session_comments;
DROP POLICY IF EXISTS "session_comments_delete" ON public.session_comments;

-- Lecture publique (tous les participants voient les commentaires)
CREATE POLICY "session_comments_select" ON public.session_comments
  FOR SELECT
  USING (true);

-- Insertion : tout authentifié, pour SA propre ligne (user_id = auth.uid())
CREATE POLICY "session_comments_insert" ON public.session_comments
  FOR INSERT TO authenticated
  WITH CHECK ((user_id)::text = (auth.uid())::text);

-- Suppression : uniquement l'auteur
CREATE POLICY "session_comments_delete" ON public.session_comments
  FOR DELETE TO authenticated
  USING ((user_id)::text = (auth.uid())::text);

-- =====================================================================
-- ⚡ Realtime : si ce n'est pas déjà fait, activer la réplication temps réel
--    pour que les nouveaux likes/commentaires apparaissent chez tout le monde.
--    (Ignore l'erreur "already member of publication".)
-- =====================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_likes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_comments;
