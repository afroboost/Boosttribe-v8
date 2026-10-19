-- S0 — AUDIT DES DONNÉES AVANT VERROU (19/10/2026). LECTURE SEULE : exécuté avec
-- PGOPTIONS='-c default_transaction_read_only=on'. Sorties agrégées, identifiants tronqués (8), aucun e-mail.
\pset footer off
-- ── PROFILS / CRÉDITS ──
select 'P1 PROFILS='||count(*)||' credits<0='||count(*) filter (where credits<0)||' credits>20='||count(*) filter (where credits>20)
       ||' max='||coalesce(max(credits),0)||' somme='||coalesce(sum(credits),0) from public.profiles;
select 'P2 ECART credits/ledger='||count(*) from public.profiles p
 where p.credits <> coalesce((select sum(delta) from public.credit_ledger l where l.user_id=p.id),0);
select 'P2d '||left(p.id::text,8)||' credits='||p.credits||' ledger='||coalesce((select sum(delta) from public.credit_ledger l where l.user_id=p.id),0)
  from public.profiles p where p.credits <> coalesce((select sum(delta) from public.credit_ledger l where l.user_id=p.id),0) limit 10;
select 'P3 ROLES='||string_agg(coalesce(role,'null')||':'||n, ' ') from (select role, count(*) n from public.profiles group by 1) x;
select 'P4 ADMIN '||left(p.id::text,8)||' email_admin_officiel='||(lower(coalesce(u.email,''))='contact.artboost@gmail.com')
  from public.profiles p left join auth.users u on u.id=p.id where p.role is distinct from 'user';
select 'P5 SUBSCRIPTION_STATUS='||string_agg(coalesce(subscription_status,'null')||':'||n, ' ') from (select subscription_status, count(*) n from public.profiles group by 1) x;
select 'P6 COACH_PAYMENT_TYPE='||string_agg(coalesce(coach_payment_type,'null')||':'||n, ' ') from (select coach_payment_type, count(*) n from public.profiles group by 1) x;
select 'P6d COMMISSION '||left(p.id::text,8)||' abo_coach='||coalesce((select status from public.coach_subscriptions c where c.user_id=p.id),'aucun')
       ||' billets_vendus='||(select count(*) from public.tickets t where t.coach_user_id=p.id)
  from public.profiles p where p.coach_payment_type='commission';
-- ── COMP_ACCESS ──
select 'C1 COMP_ACCESS plans='||coalesce(string_agg(coalesce(comp_access_plan,'null')||':'||n, ' '),'-') from (select comp_access_plan, count(*) n from public.profiles group by 1) x;
select 'C2 actifs='||count(*) filter (where comp_access_plan in ('pro','enterprise') and (comp_access_until is null or comp_access_until>now()))
       ||' sans_fin='||count(*) filter (where comp_access_plan in ('pro','enterprise') and comp_access_until is null)
       ||' plus_de_13h='||count(*) filter (where comp_access_until > now()+interval '13 hours')
       ||' enterprise_actif='||count(*) filter (where comp_access_plan='enterprise' and (comp_access_until is null or comp_access_until>now()))
  from public.profiles;
select 'C3 SUSPECT '||left(p.id::text,8)||' plan='||p.comp_access_plan||' fin='||coalesce(to_char(p.comp_access_until,'YYYY-MM-DD HH24:MI'),'AUCUNE')
       ||' abo_coach='||coalesce((select c.status||':'||case when c.stripe_subscription_id like 'admin-grant:%' then 'octroi_admin' else 'stripe' end
                                  from public.coach_subscriptions c where c.user_id=p.id),'aucun')
       ||' admin='||(lower(coalesce(u.email,''))='contact.artboost@gmail.com')
  from public.profiles p left join auth.users u on u.id=p.id
 where p.comp_access_plan in ('pro','enterprise')
   and (p.comp_access_until is null or p.comp_access_until > now()+interval '13 hours' or p.comp_access_plan='enterprise');
select 'C4 EMAIL profil<>compte='||count(*) filter (where lower(coalesce(p.email,''))<>lower(coalesce(u.email,'')))
       ||' profil_sans_compte='||count(*) filter (where u.id is null)
  from public.profiles p left join auth.users u on u.id=p.id;
-- ── CREDIT_LEDGER ──
select 'L1 LEDGER '||coalesce(reason,'null')||' n='||count(*)||' somme='||sum(delta)||' ref_null='||count(*) filter (where ref is null)
       ||' min='||min(delta)||' max='||max(delta) from public.credit_ledger group by reason order by reason;
select 'L2 GROS_MOUVEMENT id='||id||' '||left(user_id::text,8)||' delta='||delta||' '||reason||' '||to_char(created_at,'YYYY-MM-DD')
  from public.credit_ledger where abs(delta)>=20 order by created_at;
select 'L3 SOLDE_LEDGER_NEGATIF='||count(*) from (select user_id, sum(delta) s from public.credit_ledger group by 1) x where s<0;
select 'L4 DOUBLONS (reason,ref)='||count(*) from (select reason, ref from public.credit_ledger where ref is not null group by 1,2 having count(*)>1) x;
select 'L5 LEDGER_SANS_PROFIL='||count(*) from public.credit_ledger l where not exists (select 1 from public.profiles p where p.id=l.user_id);
select 'L6 CREDITS_EXPIRES lignes='||count(*)||' somme='||coalesce(sum(delta),0) from public.credit_ledger where delta>0 and expires_at is not null and expires_at<now();
-- ── HOST / LIVE ──
select 'H1 PLAYLISTS='||count(*)||' sans_hote='||count(*) filter (where host_id is null)
       ||' hote_sans_compte='||count(*) filter (where host_id is not null and not exists (select 1 from auth.users u where u.id=host_id))
       ||' cohotes='||count(*) filter (where coalesce(array_length(cohosts,1),0)>0)
       ||' hote_dans_cohotes='||count(*) filter (where host_id::text = any(coalesce(cohosts,'{}')))
       ||' doublons_session='||(select count(*) from (select session_id from public.playlists group by 1 having count(*)>1) d)
  from public.playlists;
select 'H2 MODES='||string_agg(coalesce(mode,'null')||'/'||coalesce(access_mode,'null')||':'||n, ' ') from (select mode, access_mode, count(*) n from public.playlists group by 1,2) x;
select 'H3 SANS_HOTE_AVEC_REGLAGES='||count(*) from public.playlists
 where host_id is null and (mode<>'open' or access_mode is not null or coalesce(is_private,false) or promo_enabled is true);
select 'H4 COHOTE_INCONNU='||count(*) from public.playlists p, unnest(coalesce(p.cohosts,'{}')) c
 where c !~ '^[0-9a-f-]{36}$' or not exists (select 1 from auth.users u where u.id::text=c);
select 'H5 TERMINES='||count(*) filter (where live_ended_at is not null)||' enregistrement_actif='||count(*) filter (where record_enabled) from public.playlists;
-- ── DEMANDES D'ACCÈS / BILLETS / ENREGISTREMENTS ──
select 'A1 DEMANDES='||coalesce(string_agg(status||':'||n, ' '),'0') from (select status, count(*) n from public.access_requests group by 1) x;
select 'A2 APPROUVEES_SANS_DATE_DECISION='||count(*) from public.access_requests where status='approved' and decided_at is null;
select 'A3 APPROUVEES_PAR_SOI (demandeur=hote)='||count(*) from public.access_requests a join public.playlists p on p.session_id=a.session_id
 where a.status='approved' and a.requester_user_id is not null and a.requester_user_id=p.host_id;
select 'T1 BILLETS='||coalesce(string_agg(status||':'||n, ' '),'0') from (select status, count(*) n from public.tickets group by 1) x;
select 'T2 PAYES_SANS_REFERENCE_PAIEMENT='||count(*) from public.tickets where status='paid' and stripe_session_id is null and tx_ref is null and stripe_payment_intent is null;
select 'T3 ACHETEUR=COACH='||count(*) from public.tickets where buyer_user_id is not null and buyer_user_id=coach_user_id;
select 'R1 ENREGISTREMENTS='||count(*)||' statuts='||coalesce(string_agg(distinct status, ','),'-') from public.session_recordings;
select 'S1 ABO_COACH='||coalesce(string_agg(status||'/'||src||':'||n, ' '),'0') from (
  select status, case when stripe_subscription_id like 'admin-grant:%' then 'octroi_admin' else 'stripe' end src, count(*) n
    from public.coach_subscriptions group by 1,2) x;
select 'S2 ABO_ACTIF_ECHU='||count(*) from public.coach_subscriptions where status in ('active','trialing') and current_period_end < now();
select 'W1 WALLETS='||count(*)||' somme='||coalesce(sum(balance_chf),0) from public.coach_wallet;
