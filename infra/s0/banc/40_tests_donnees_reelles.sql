-- Banc S0 — sur la base « données réelles » : aucune donnée existante n'est modifiée par les migrations ;
-- les comptes sans profil gardent EXACTEMENT leur solde du grand livre ; les fonctions de crédit marchent
-- appelées par service_role avec leur VRAI propriétaire (supabase_admin ou postgres).
-- :etape = libellé de l'instantané (avant_m1, apres_m1, apres_m2, apres_rollback).
insert into banc.instantanes(etape, tableau, empreinte)
select :'etape', t, e from (
  select 'profiles' t, md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) e from public.profiles p
  union all select 'credit_ledger', md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) from public.credit_ledger l
  union all select 'playlists', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.session_id), '')) from public.playlists x
  union all select 'access_requests', md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) from public.access_requests a
  union all select 'coach_subscriptions', md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.user_id), '')) from public.coach_subscriptions c
  union all select 'tickets', md5(coalesce(string_agg(to_jsonb(k)::text, '|' order by k.id), '')) from public.tickets k
  union all select 'auth.users', md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) from auth.users u
) s;
select banc.verifier('D-' || :'etape' || '. données existantes INCHANGÉES (profils, grand livre, sessions, demandes, abonnements, billets, comptes)',
  (select count(*) = 0 from banc.instantanes a join banc.instantanes b using (tableau)
    where a.etape = 'avant_m1' and b.etape = :'etape' and a.empreinte is distinct from b.empreinte));
