-- ============================================================================
-- POST-S0 — ROLLBACK de 03 (preuve CGU). Idempotent. Transactionnel.
-- Remet l'état d'avant 03 (terms_accepted seul) SANS PERDRE les preuves déjà recueillies :
-- elles sont copiées dans public.s0c_cgu_preuve_sauvegarde (RLS active, aucune règle :
-- lisible par le backend / service_role seulement) AVANT le retrait des colonnes.
-- ⚠️ Le front post-03 reste fonctionnel sans 03 (repli automatique sur terms_accepted),
--    mais les nouvelles acceptations ne seront plus datées ni versionnées.
-- ============================================================================
begin;

create table if not exists public.s0c_cgu_preuve_sauvegarde (
  id                uuid primary key,
  terms_accepted    boolean,
  terms_accepted_at timestamptz,
  terms_version     text,
  saved_at          timestamptz not null default now()
);
alter table public.s0c_cgu_preuve_sauvegarde enable row level security;
revoke all on public.s0c_cgu_preuve_sauvegarde from public, anon, authenticated;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'profiles' and column_name = 'terms_accepted_at') then
    execute $q$
      insert into public.s0c_cgu_preuve_sauvegarde (id, terms_accepted, terms_accepted_at, terms_version)
      select id, terms_accepted, terms_accepted_at, terms_version from public.profiles
       where terms_accepted_at is not null or terms_version is not null
      on conflict (id) do update set terms_accepted = excluded.terms_accepted,
        terms_accepted_at = excluded.terms_accepted_at, terms_version = excluded.terms_version,
        saved_at = now()
    $q$;
  end if;
end $$;

drop function if exists public.accepter_cgu(text);
drop trigger if exists s0_proteger_profil_cgu on public.profiles;
drop function if exists public.s0_proteger_profil_cgu();
alter table public.profiles drop constraint if exists profiles_cgu_preuve_coherente;
alter table public.profiles drop column if exists terms_accepted_at;
alter table public.profiles drop column if exists terms_version;

commit;
