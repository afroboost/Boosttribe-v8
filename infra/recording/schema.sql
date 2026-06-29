-- ============================================================================
-- BoostTribe — ENREGISTREMENT COMPLET + TRANSCRIPTION IA (option premium crédits)
-- À exécuter en supabase_admin. Idempotent.
-- ============================================================================

-- 1) Drapeau "session enregistrée" sur la session (pour l'avis de consentement)
alter table public.playlists add column if not exists record_enabled boolean not null default false;

-- 2) Coût en crédits de l'option (admin-éditable) — défaut 4
alter table public.pricing_settings add column if not exists cost_record_transcribe integer not null default 4;

-- 2b) Autoriser la raison 'spend_record' dans le ledger de crédits
alter table public.credit_ledger drop constraint if exists credit_ledger_reason_chk;
alter table public.credit_ledger add constraint credit_ledger_reason_chk check (reason in
  ('purchase','spend_join','spend_host','spend_record','offered','signup_bonus',
   'referral','launch_bonus','refund','gift'));

-- 3) Enregistrements + transcription IA (FR) + résumé
create table if not exists public.session_recordings (
  id          bigint generated always as identity primary key,
  session_id  text not null,
  host_id     uuid references auth.users(id) on delete set null,
  audio_path  text,
  audio_url   text,
  transcript  text,
  summary     text,
  duration_s  integer,
  status      text not null default 'processing' check (status in ('processing','done','error')),
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists session_recordings_host_idx    on public.session_recordings(host_id);
create index if not exists session_recordings_session_idx on public.session_recordings(session_id);

-- 4) Clé API IA (OpenAI) chiffrée au repos (comme la clé Stripe) — écrite par le backend
create table if not exists public.ai_secrets (
  id                   text primary key default 'default',
  encrypted_openai_key text,
  updated_at           timestamptz not null default now()
);

-- 5) Bucket de stockage des enregistrements — PRIVÉ (contenu sensible : voix + transcription).
--    L'accès se fait uniquement via des URL signées temporaires générées côté backend (service_role).
insert into storage.buckets (id, name, public)
  values ('session-recordings', 'session-recordings', false)
  on conflict (id) do update set public = false;

-- 6) RLS
alter table public.session_recordings enable row level security;
alter table public.ai_secrets         enable row level security;

drop policy if exists session_recordings_read_own on public.session_recordings;
create policy session_recordings_read_own on public.session_recordings
  for select using (auth.uid() = host_id);

-- ai_secrets : aucune policy → seul le service_role (backend) y accède.

-- 7) Recharger le cache de schéma PostgREST (nouvelles colonnes/tables visibles via l'API REST)
notify pgrst, 'reload schema';
