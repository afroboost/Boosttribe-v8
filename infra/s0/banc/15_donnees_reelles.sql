-- Banc S0 — DONNÉES SYNTHÉTIQUES reproduisant les cas réels relevés par l'audit du 19/10
-- (aucune donnée de production : identifiants inventés). Chargées en supabase_admin, avant toute migration.
insert into auth.users values
  ('10000000-0000-0000-0000-000000000001', 'coach@exemple.test'),        -- profil, 100 crédits « offered »
  ('10000000-0000-0000-0000-000000000002', 'manuel@exemple.test'),       -- recharge manuelle +100 SANS expiration
  ('10000000-0000-0000-0000-000000000003', 'sansprofil@exemple.test'),   -- compte SANS profil, signup_bonus +1
  ('10000000-0000-0000-0000-000000000004', 'joueur@exemple.test'),       -- a dépensé (join/host/record)
  ('10000000-0000-0000-0000-000000000005', 'afro@exemple.test'),         -- comp_access pro EXPIRÉ (Afroboost 12 h)
  ('10000000-0000-0000-0000-000000000006', 'contact.artboost@gmail.com');
insert into public.profiles (id, email, full_name, role, subscription_status, comp_access_plan, comp_access_until) values
  ('10000000-0000-0000-0000-000000000001', 'coach@exemple.test', 'Coach', 'user', 'free', null, null),
  ('10000000-0000-0000-0000-000000000002', 'manuel@exemple.test', 'Manuel', 'user', 'none', null, null),
  ('10000000-0000-0000-0000-000000000004', 'joueur@exemple.test', 'Joueur', 'user', 'free', null, null),
  ('10000000-0000-0000-0000-000000000005', 'afro@exemple.test', 'Afro', 'user', 'free', 'pro', now() - interval '16 days'),
  ('10000000-0000-0000-0000-000000000006', 'contact.artboost@gmail.com', 'Admin', 'user', 'free', 'pro', now() - interval '4 days');
-- Grand livre (insertions directes, comme l'historique) — le trigger tient profiles.credits à jour.
insert into public.credit_ledger (user_id, delta, reason, ref, note, expires_at) values
  ('10000000-0000-0000-0000-000000000001', 100, 'offered', 'offered:10000000', 'offre', now() + interval '8 months'),
  ('10000000-0000-0000-0000-000000000002', 100, 'offered', 'manual_topup_x', 'recharge manuelle', null),
  ('10000000-0000-0000-0000-000000000003', 1, 'signup_bonus', 'signup:10000000-0000-0000-0000-000000000003', '1er cours offert', now() + interval '9 months'),
  ('10000000-0000-0000-0000-000000000004', 1, 'signup_bonus', 'signup:10000000-0000-0000-0000-000000000004', '1er cours offert', now() + interval '9 months'),
  ('10000000-0000-0000-0000-000000000004', 10, 'purchase', 'stripe:evt_1', 'pack', now() + interval '11 months'),
  ('10000000-0000-0000-0000-000000000004', -1, 'spend_join', 'SESS-A:10000000-0000-0000-0000-000000000004', 'join', null),
  ('10000000-0000-0000-0000-000000000004', -1, 'spend_host', 'SESS-B:10000000-0000-0000-0000-000000000004', 'host', null),
  ('10000000-0000-0000-0000-000000000004', -4, 'spend_record', 'record:SESS-B:10000000-0000-0000-0000-000000000004', 'rec', null);
insert into public.coach_subscriptions values
  ('10000000-0000-0000-0000-000000000001', 'admin-grant:10000000', 'active', now() - interval '80 days', now());  -- « active » échu
insert into public.playlists (session_id, host_id, mode, access_mode, cohosts, description) values
  ('SESS-A', '10000000-0000-0000-0000-000000000006', 'open', 'account', '[]', 'admin'),
  ('SESS-B', '10000000-0000-0000-0000-000000000004', 'open', 'account', '["user_abcdefghijklmnopqrs"]', 'co-hôte = id de connexion'),
  ('SESS-C', '10000000-0000-0000-0000-000000000004', 'private', 'guest', '[]', null),
  ('SESS-D', null, 'open', 'account', '[]', 'sans hôte');
insert into public.access_requests (session_id, requester_user_id, requester_name, status, decided_at) values
  ('SESS-B', '10000000-0000-0000-0000-000000000001', 'Coach', 'approved', now() - interval '2 days'),
  ('SESS-B', null, 'Anonyme', 'refused', now() - interval '1 day');
