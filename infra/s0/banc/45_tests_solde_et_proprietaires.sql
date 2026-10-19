-- Banc S0 — après la migration 1 (base « données réelles ») : solde exact, aucun crédit créé,
-- fonctions de crédit appelées comme le BACKEND (service_role) avec le propriétaire réel.
select banc.verifier('N1. compte SANS profil : solde = 1 (son signup_bonus historique), pas 2',
  public.credits_disponibles('10000000-0000-0000-0000-000000000003') = 1);
select banc.verifier('N2. recharge manuelle sans expiration : 100', public.credits_disponibles('10000000-0000-0000-0000-000000000002') = 100);
select banc.verifier('N3. joueur : 1 + 10 - 1 - 1 - 4 = 5', public.credits_disponibles('10000000-0000-0000-0000-000000000004') = 5);
select banc.verifier('N4. la migration n''a créé AUCUN profil (compte sans profil toujours sans profil)',
  not exists (select 1 from public.profiles where id = '10000000-0000-0000-0000-000000000003'));

-- Comme le backend : service_role appelle les fonctions, qui s'exécutent au nom de leur PROPRIÉTAIRE
-- réel (supabase_admin sur boosttribe.pro, postgres sur /live). Erreurs CAPTURÉES (jamais d'arrêt du banc).
do $$
declare v_solde int; v_a int; v_s int; v_d int; proprio text;
begin
  select pg_get_userbyid(proowner) into proprio from pg_proc where oid = 'public.spend_credits(uuid,integer,text,text,text)'::regprocedure;
  begin
    set local role service_role;
    v_solde := public.add_credits('10000000-0000-0000-0000-000000000003', 1, 'signup_bonus',
                                  'signup:10000000-0000-0000-0000-000000000003', 'bis', null);
    reset role;
    perform banc.verifier('N5. bonus redemandé par le backend → no-op, solde reste 1', v_solde = 1);
  exception when others then
    reset role;
    perform banc.verifier('N5. bonus redemandé par le backend → no-op (ERREUR : ' || sqlerrm || ')', false);
  end;
  perform banc.verifier('N6. aucun doublon ni nouvelle ligne pour le compte sans profil',
    (select count(*) from public.credit_ledger where user_id = '10000000-0000-0000-0000-000000000003') = 1);
  begin
    set local role service_role;
    v_a := public.add_credits('10000000-0000-0000-0000-000000000001', 2, 'purchase', 'banc-o1', 'test', null);
    v_s := public.spend_credits('10000000-0000-0000-0000-000000000001', 1, 'spend_join', 'banc-o2', 'test');
    v_d := public.credits_disponibles('10000000-0000-0000-0000-000000000001');
    raise exception 'annuler_O1';           -- test sans trace : on défait les écritures (résultat gardé en variables)
  exception when others then
    reset role;
    if sqlerrm = 'annuler_O1' then
      perform banc.verifier('O1. service_role : add / spend / credits_disponibles OK (propriétaire réel ' || proprio || ')',
        v_a = 102 and v_s = 101 and v_d = 101);
    else
      perform banc.verifier('O1. service_role : add / spend / credits_disponibles (ERREUR propriétaire ' || proprio || ' : ' || sqlerrm || ')', false);
    end if;
  end;
end $$;
select banc.verifier('O2. test O1 sans trace : grand livre du coach inchangé',
  (select count(*) from public.credit_ledger where ref in ('banc-o1','banc-o2')) = 0);
