-- Compléments FACTICES (aucune donnée réelle) appliqués APRÈS le schéma réel du banc S0
-- (infra/s0/banc/00_supabase_simule.sql + 10_etat_actuel.sql + migrations 00, 01, 02) :
--   - schéma storage minimal (seaux audio-tracks public et session-recordings privé, objets, règles RLS
--     de frontend/supabase-setup.sql) dont les objets correspondent aux fichiers factices du banc ;
--   - quelques comptes, profils, lignes de grand livre et sessions ;
--   - BANC SEULEMENT : une RLS FORCÉE et un droit par colonne, pour prouver que leur perte est vue.
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text not null, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
create policy "Allow public uploads" on storage.objects for insert to anon, authenticated with check (bucket_id = 'audio-tracks');
create policy "Allow public read" on storage.objects for select to anon, authenticated using (bucket_id = 'audio-tracks');
create policy "Allow owner delete" on storage.objects for delete to authenticated using (bucket_id = 'audio-tracks');
insert into storage.buckets values ('audio-tracks', 'audio-tracks', true), ('session-recordings', 'session-recordings', false);
insert into storage.objects (bucket_id, name, metadata) values
  ('audio-tracks', 'S1/1760000000_intro.mp3', '{"size": 4096}'),
  ('audio-tracks', 'S1/1760000001_danse.mp3', '{"size": 8192}'),
  ('audio-tracks', 'S2/1760000002_final.mp3', '{"size": 2048}'),
  ('session-recordings', 'S1/enregistrement.webm', '{"size": 16384}');

insert into auth.users select ('00000000-0000-0000-0000-00000000000' || g)::uuid, 'x' || g || '@exemple.invalid'
  from generate_series(1, 5) g;
insert into public.profiles (id, full_name, email) select id, 'Nom ' || right(id::text, 1), email from auth.users limit 3;
insert into public.credit_ledger (user_id, delta, reason, ref) select id, 5, 'signup_bonus', 's:' || id from auth.users;
insert into public.credit_ledger (user_id, delta, reason, ref)
  select id, -2, 'spend_join', 'j:' || id from auth.users limit 2;
insert into public.playlists (session_id, mode, description) select 'S' || g, 'open', 'd' from generate_series(1, 40) g;

-- BANC SEULEMENT (absent de la production) : FORCE RLS, droit de colonne, grand livre fermé en écriture
-- au niveau des DROITS (en production il l'est par la RLS seule) — pour prouver que chaque perte est vue.
alter table public.coach_subscriptions force row level security;
grant update (full_name) on public.profiles to authenticated;
revoke all on public.credit_ledger from anon, authenticated;
grant select on public.credit_ledger to authenticated;
