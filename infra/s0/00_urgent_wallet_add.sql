-- ============================================================================
-- URGENT — INDÉPENDANT DE S0. À appliquer dès le GO, sur LES DEUX bases.
-- Constaté le 19/10/2026 (description publique de l'API, clé anonyme) : `wallet_add` (crédit /
-- débit du portefeuille CHF des coachs, SECURITY DEFINER) et `recalc_user_credits` sont
-- APPELABLES PAR UN VISITEUR ANONYME. N'importe qui peut se créditer un portefeuille, puis
-- demander un virement, ou vider celui d'un autre coach.
-- Seul le backend (service_role) les appelle (backend/main.py `wallet_add`) : rien ne casse.
-- Idempotent. Rollback : grant execute ... to anon, authenticated (déconseillé).
-- ============================================================================
begin;
do $$
begin
  if to_regprocedure('public.wallet_add(uuid,numeric,text,text,boolean)') is not null then
    revoke all on function public.wallet_add(uuid,numeric,text,text,boolean) from public, anon, authenticated;
    grant execute on function public.wallet_add(uuid,numeric,text,text,boolean) to service_role;
  end if;
  if to_regprocedure('public.recalc_user_credits(uuid)') is not null then
    revoke all on function public.recalc_user_credits(uuid) from public, anon, authenticated;
    grant execute on function public.recalc_user_credits(uuid) to service_role;
  end if;
end $$;
commit;
-- Contrôle : GET {SUPABASE_URL}/rest/v1/ avec la clé anon → plus de /rpc/wallet_add ni /rpc/recalc_user_credits.
