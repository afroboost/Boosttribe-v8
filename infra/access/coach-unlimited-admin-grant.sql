-- ============================================================================
-- BoostTribe — Un accès accordé par l'admin (comp_access pro/enterprise) = coach ILLIMITÉ
-- 1) Corrige le compte bassicustomshoes@gmail.com (abo coach actif).
-- 2) Étend has_open_session_access pour reconnaître aussi un accès admin actif.
-- À exécuter en supabase_admin. Idempotent.
-- ============================================================================

-- 1) Compte bassicustomshoes@gmail.com (id bcdea755-6569-4bc0-bda9-c7133d766347)
update public.profiles
   set coach_payment_type = 'subscription'
 where id = 'bcdea755-6569-4bc0-bda9-c7133d766347';

insert into public.coach_subscriptions (user_id, status, current_period_end, stripe_subscription_id, updated_at)
values ('bcdea755-6569-4bc0-bda9-c7133d766347', 'active',
        '2026-07-28 21:08:51.398+00', 'admin-grant:bcdea755-6569-4bc0-bda9-c7133d766347', now())
on conflict (user_id) do update
   set status = 'active',
       current_period_end = excluded.current_period_end,
       updated_at = now();

-- 2) RLS : un accès admin actif (pro/enterprise) ouvre aussi les sessions « Ouverte (crédits) ».
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
  ) or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid()
      and pr.comp_access_plan in ('pro','enterprise')
      and (pr.comp_access_until is null or pr.comp_access_until > now())
  );
$$;
