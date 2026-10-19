-- Banc S0 — simulation de Supabase (par base de test). Les RÔLES sont créés une fois pour le cluster
-- par banc_s0.sh (supabase_admin = superutilisateur d'amorçage, postgres = NON superutilisateur,
-- comme Supabase 15). Le schéma auth et les droits par défaut sont posés ici.
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role, postgres;
grant select, references on auth.users to postgres, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role, postgres;

grant usage, create on schema public to postgres;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
