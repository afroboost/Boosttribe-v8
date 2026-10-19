-- ============================================================================
-- ROLLBACK de 00_urgent_wallet_add.sql — remet les droits EXACTS constatés avant (19/10/2026).
-- À n'utiliser qu'en cas de panne avérée : il ROUVRE la faille (portefeuille CHF appelable par anon).
-- Exécuter en supabase_admin (superutilisateur : agit au nom du propriétaire).
--
-- État AVANT, relevé en lecture seule (aucune donnée client) :
--   base boosttribe.pro (supabase-db-gneo8…) : propriétaire supabase_admin, SECURITY DEFINER
--     wallet_add          ACL {=X/supabase_admin, supabase_admin=X, postgres=X, anon=X, authenticated=X, service_role=X}
--     recalc_user_credits ACL identique
--   base afroboost.com/live (supabase-db-l12j96…) : propriétaire postgres, SECURITY DEFINER
--     wallet_add          ACL {=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X}
--     recalc_user_credits ACL identique
--   Les deux bases : aucune fonction SQL n'appelle wallet_add ; coach_wallet = 0 ligne ; wallet_ledger = 0 ligne.
-- ============================================================================
begin;
grant execute on function public.wallet_add(uuid,numeric,text,text,boolean) to public, anon, authenticated, service_role;
grant execute on function public.recalc_user_credits(uuid) to public, anon, authenticated, service_role;
commit;
