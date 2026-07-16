-- ============================================================
-- BoostTribe · Hero plein écran (vidéo de fond) — configurable en admin
-- ------------------------------------------------------------
-- Ajoute deux colonnes à site_settings :
--   • hero_video_url  : URL de la vidéo de fond du hero (autoplay/muted/loop)
--   • hero_poster_url : image « poster » de la vidéo + image de secours
--
-- 100 % ADDITIF et IDEMPOTENT : « IF NOT EXISTS » → aucune donnée existante
-- n'est touchée, on peut relancer ce script sans risque.
-- Aucune valeur par défaut imposée : hero vide = fallback carrousel (Ken Burns).
-- ============================================================

ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS hero_video_url  text;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS hero_poster_url text;

-- (Optionnel) Vérification rapide des colonnes après exécution :
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'site_settings'
--    AND column_name IN ('hero_video_url', 'hero_poster_url');
