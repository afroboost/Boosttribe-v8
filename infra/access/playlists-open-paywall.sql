-- ============================================================================
-- BoostTribe — ENFORCEMENT du paywall crédits sur les sessions « Ouverte (crédits) »
-- À exécuter en supabase_admin. Idempotent.
--
-- Une session mode='open' (Ouverte/crédits) n'est LISIBLE que par :
--   - l'hôte / co-hôte de la session,
--   - l'admin (email),
--   - un coach abonné « illimité » (coach_subscriptions actif),
--   - un participant ayant DÉJÀ payé son crédit pour CETTE session (credit_ledger).
-- Les autres modes (privée / payante / non-configuré) restent en lecture libre (inchangé).
-- ============================================================================

-- Fonction SECURITY DEFINER : contourne la RLS de credit_ledger / coach_subscriptions
-- (sinon un payeur pourrait être bloqué par la RLS de ces tables). auth.uid() reste celui de l'appelant.
create or replace function public.has_open_session_access(p_session_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.credit_ledger l
    where l.reason in ('spend_join','spend_host')
      and l.ref = p_session_id || ':' || (auth.uid())::text
  ) or exists (
    select 1 from public.coach_subscriptions cs
    where cs.user_id = auth.uid()
      and cs.status in ('active','trialing')
      and (cs.current_period_end is null or cs.current_period_end > now())
  );
$$;
grant execute on function public.has_open_session_access(text) to anon, authenticated, service_role;

-- Policy SELECT gatée : seul mode='open' explicite est protégé ; le reste inchangé.
drop policy if exists playlists_select on public.playlists;
create policy playlists_select on public.playlists for select to public
using (
  mode is distinct from 'open'                                           -- privée / payante / non-configuré : libre
  or host_id = auth.uid()                                                -- hôte
  or cohosts @> to_jsonb((auth.uid())::text)                             -- co-hôte
  or coalesce(auth.jwt() ->> 'email', '') = 'contact.artboost@gmail.com' -- admin
  or public.has_open_session_access(session_id)                          -- déjà payé / coach illimité
);
