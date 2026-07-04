-- ============================================================================
-- BoostTribe — Relever la limite de taille du bucket audio-tracks à 500 Mo
-- (permet d'ajouter un mix long ~90 min, ~120–200 Mo). À exécuter en supabase_admin.
-- Idempotent. Ajuster l'id du bucket si différent ('audio-tracks' par défaut).
-- ============================================================================

update storage.buckets
set file_size_limit = 524288000   -- 500 Mo
where id = 'audio-tracks';

-- Vérification :
-- select id, file_size_limit from storage.buckets where id = 'audio-tracks';
