-- Base FACTICE (aucune donnée réelle) reproduisant ce que la sauvegarde doit préserver : schéma auth,
-- profils, grand livre, sessions, règle RLS, verrou S0, droits révoqués et propriétaire non superutilisateur.
create role postgres nosuperuser login; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users(id uuid primary key, email text);
create table public.profiles(id uuid primary key references auth.users(id), full_name text, credits int default 0, role text default 'user');
create table public.credit_ledger(id bigserial primary key, user_id uuid, delta int, reason text, ref text, created_at timestamptz default now());
create table public.playlists(session_id text primary key, host_id uuid, mode text not null default 'open', description text);
alter table public.profiles enable row level security;
create policy s0_profiles_select_soi on public.profiles for select to authenticated using (true);
create function public.wallet_add(p uuid) returns int language sql security definer as $$ select 1 $$;
create function public.credits_disponibles(p uuid) returns int language sql security definer as $$ select 1 $$;
revoke all on function public.wallet_add(uuid) from public, anon, authenticated; grant execute on function public.wallet_add(uuid) to service_role;
revoke all on function public.credits_disponibles(uuid) from public, anon, authenticated; grant execute on function public.credits_disponibles(uuid) to service_role;
alter function public.credits_disponibles(uuid) owner to postgres;
create function public.s0_t() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger s0_proteger_profil before update on public.profiles for each row execute function public.s0_t();
insert into auth.users select gen_random_uuid(), 'x' || g || '@exemple.invalid' from generate_series(1, 5) g;
insert into public.profiles(id, full_name, credits) select id, 'n', 3 from auth.users limit 3;
insert into public.credit_ledger(user_id, delta, reason, ref) select id, 5, 'signup_bonus', 's:' || id from auth.users;
insert into public.playlists select 'S' || g, null, 'open', 'd' from generate_series(1, 40) g;
do $$ begin for i in 1..30 loop execute format('create table public.t%s(id int)', i); end loop; end $$;
