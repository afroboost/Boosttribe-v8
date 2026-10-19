-- Post-S0 : à exécuter dans la base CIBLE d'une restauration, AVANT pg_restore (jamais en production).
--
-- Pourquoi : une image Supabase neuve porte des droits par défaut (pg_default_acl) qui accordent
-- EXECUTE / ALL à anon et authenticated sur tout objet créé dans public (et storage, graphql…).
-- pg_dump n'écrit les droits d'un objet que PAR RAPPORT au défaut intégré de PostgreSQL : il ne dit
-- jamais « retirer anon ». Restaurer tel quel redonnait donc à anon / authenticated l'accès à
-- wallet_add, spend_credits, add_credits… — exactement les failles fermées par S0 (constaté au premier
-- test de restauration réel, 19/10/2026).
--
-- Effet : retire tous les droits par défaut PROPRES À UN SCHÉMA (ceux de l'image). Les objets recréés
-- par pg_restore reçoivent alors le défaut intégré, puis exactement les GRANT/REVOKE de la sauvegarde ;
-- les droits par défaut de la production sont rétablis en fin de pg_restore (entrées DEFAULT ACL du dump).
\set ON_ERROR_STOP on
do $$
declare
  r record;
begin
  for r in
    select d.defaclrole::regrole::text as role, n.nspname as schema,
           case d.defaclobjtype when 'r' then 'TABLES' when 'S' then 'SEQUENCES' when 'f' then 'FUNCTIONS'
                                when 'T' then 'TYPES' when 'n' then 'SCHEMAS' end as objets,
           case when a.grantee = 0 then 'PUBLIC' else quote_ident(a.grantee::regrole::text) end as beneficiaire
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
      cross join lateral aclexplode(d.defaclacl) a
     where d.defaclnamespace <> 0
  loop
    execute format('alter default privileges for role %I in schema %I revoke all on %s from %s',
                   r.role, r.schema, r.objets, r.beneficiaire);
  end loop;
  if exists (select 1 from pg_default_acl where defaclnamespace <> 0) then
    raise exception 'droits par défaut de schéma encore présents après neutralisation';
  end if;
end $$;
