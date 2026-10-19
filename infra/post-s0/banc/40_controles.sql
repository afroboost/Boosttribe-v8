-- Contrôles du banc post-S0 (phase « <variante>:CONTROLES ») sur banc.ecritures.
-- Les essais « insert host_id=soi » sont INFORMATIFS (ils montrent pourquoi la correction n'insère jamais).
create temp view e as
  select *, split_part(phase, ':', 2) || ':' || split_part(phase, ':', 3) as ph
    from banc.ecritures where split_part(phase, ':', 1) = split_part(current_setting('banc.phase'), ':', 1);
create temp view corr as
  select * from e where ph = 'S0:APRES' and nom not like '%insert%';

select banc.verifier('C1. ACTUEL (après S0) : les 27 upserts is_private / média / description sont REFUSÉS 42501, hôte compris',
  (select count(*) = 27 and bool_and(erreur like '42501 %') from e where ph = 'S0:AVANT' and nom ~ '^(PRIVE|MEDIA|DESC)'));
select banc.verifier('C2. ACTUEL : résultat IDENTIQUE avant S0 (défaut préexistant, pas une régression S0)',
  (select count(*) = 0 from (
     (select nom, acteur, session, coalesce(left(erreur, 5), 'OK') from e where ph = 'PRE_S0:AVANT' and nom ~ '^(PRIVE|MEDIA|DESC)'
      except select nom, acteur, session, coalesce(left(erreur, 5), 'OK') from e where ph = 'S0:AVANT' and nom ~ '^(PRIVE|MEDIA|DESC)')
     union all
     (select nom, acteur, session, coalesce(left(erreur, 5), 'OK') from e where ph = 'S0:AVANT' and nom ~ '^(PRIVE|MEDIA|DESC)'
      except select nom, acteur, session, coalesce(left(erreur, 5), 'OK') from e where ph = 'PRE_S0:AVANT' and nom ~ '^(PRIVE|MEDIA|DESC)')) d));
select banc.verifier('C3. CORRIGÉ : hôte ET co-hôte enregistrent confidentialité, média, retrait du média, description (1 ligne, sans erreur)',
  (select count(*) = 8 and bool_and(erreur is null and lignes = 1) from corr where session = 'S1SESSN-AAAAAA' and acteur in ('H', 'C')));
select banc.verifier('C4. CORRIGÉ : la valeur est RÉELLEMENT écrite (relue en base)',
  (select bool_and(case when nom like 'PRIVE%' then etat like '%prive=t%'
                        when nom like 'MEDIA  update%' then etat like '%media=https://exemple.invalid/v.mp4%'
                        when nom like 'MEDIA  retrait%' then etat like '%media=-%'
                        else etat like '%desc=nouvelle desc%' end)
     from corr where session = 'S1SESSN-AAAAAA' and acteur in ('H', 'C')));
select banc.verifier('C5. CORRIGÉ : un TIERS (session d''un autre, même en entrée libre) ne modifie rien — 0 ligne, sans erreur',
  (select count(*) = 8 and bool_and(lignes = 0 and erreur is null) from corr where acteur = 'T' and session in ('S1SESSN-AAAAAA', 'S4SESSN-AAAAAA')));
select banc.verifier('C6. CORRIGÉ : l''admin qui n''est ni hôte ni co-hôte ne modifie rien (comme avant)',
  (select count(*) = 4 and bool_and(lignes = 0) from corr where acteur = 'A'));
select banc.verifier('C7. CORRIGÉ : session ABSENTE ou SANS HÔTE → 0 ligne : jamais créée ni revendiquée depuis le navigateur',
  (select count(*) = 16 and bool_and(lignes = 0 and (etat = 'ABSENTE' or etat like 'hote=NULL%prive=f media=- desc=-%'))
     from corr where session in ('S2SESSN-AAAAAA', 'S3SESSN-AAAAAA')));
select banc.verifier('C8. CORRIGÉ : mode, hôte et co-hôtes JAMAIS modifiés par ces écritures',
  (select bool_and((etat = 'ABSENTE' or etat like '%mode=open%') and
                   case session when 'S1SESSN-AAAAAA' then etat like 'hote=a %' and etat like '%cohotes=["cccccccc-0000-0000-0000-00000000000c"]%'
                                when 'S4SESSN-AAAAAA' then etat like 'hote=a %'
                                when 'S3SESSN-AAAAAA' then etat like 'hote=NULL %'
                                else etat = 'ABSENTE' end) from corr));
select banc.verifier('C9. sessions historiques, profils (crédits) et grand livre IDENTIQUES après tous les essais',
  (select count(*) = 0 from banc.empreintes a join (
     select 'playlists' t, md5(string_agg(to_jsonb(x)::text, '|' order by x.session_id)) e from public.playlists x
     union all select 'profiles', md5(string_agg(to_jsonb(p)::text, '|' order by p.id)) from public.profiles p
     union all select 'credit_ledger', md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) from public.credit_ledger l) b
   on a.tableau = b.t where a.etape = 'depart' and a.empreinte is distinct from b.e)
  and (select count(*) = 3 from banc.empreintes where etape = 'depart'));
select banc.verifier('C10. verrous S0 toujours actifs (règles profils + 2 déclencheurs)',
  (select count(*) = 3 from pg_policies where tablename = 'profiles' and policyname like 's0\_%')
  and (select count(*) = 2 from pg_trigger where tgname in ('s0_proteger_profil', 's0_proteger_playlist')));
