-- ============================================================================
-- S0 — AUDIT EN LECTURE SEULE, à lancer (service_role / supabase_admin) AVANT l'étape 2,
-- sur LES DEUX bases. N'ÉCRIT RIEN.
--
-- Pourquoi : jusqu'à S0, chaque utilisateur pouvait réécrire SA ligne `profiles` (crédits,
-- accès offert, rôle, type de paiement coach, e-mail). Le verrou empêche les écritures FUTURES ;
-- il ne nettoie pas une valeur déjà falsifiée. Chaque ligne listée ici doit être JUSTIFIÉE
-- (octroi admin, abonnement Stripe, accès Afroboost 12 h…) avant de décider d'une correction —
-- décision humaine, au cas par cas, jamais automatique.
-- ============================================================================

-- 1) Accès offert sans fin ou « enterprise » (= crédits illimités, Espace Coach)
select p.id, p.comp_access_plan, p.comp_access_until,
       exists (select 1 from public.coach_subscriptions cs where cs.user_id = p.id
                and cs.status in ('active','trialing')) as abonnement_coach_actif,
       p.subscription_status
  from public.profiles p
 where p.comp_access_plan in ('pro','enterprise')
   and (p.comp_access_until is null or p.comp_access_until > now() + interval '13 hours')
 order by p.comp_access_until nulls first;

-- 2) Type de paiement coach « commission » (= vend des billets, Espace Coach)
select p.id, p.coach_payment_type, p.subscription_status
  from public.profiles p
 where p.coach_payment_type = 'commission';

-- 3) Rôle / statut d'abonnement « élevés »
select p.id, p.role, p.subscription_status
  from public.profiles p
 where p.role is distinct from 'user' or p.subscription_status in ('pro','enterprise');

-- 4) E-mail du profil ≠ e-mail du compte (sert à relier un membre Afroboost à son compte)
select p.id, p.email as email_profil, u.email as email_compte
  from public.profiles p join auth.users u on u.id = p.id
 where lower(coalesce(p.email,'')) <> lower(coalesce(u.email,''));

-- 5) Copie de solde ≠ solde réel du grand livre (après l'étape 1 : credits_disponibles)
select p.id, p.credits as copie, public.credits_disponibles(p.id) as reel
  from public.profiles p
 where p.credits is distinct from public.credits_disponibles(p.id);

-- 6) Doublons de session (la migration 1 s'arrête si session_id n'est pas UNIQUE)
select session_id, count(*) from public.playlists group by session_id having count(*) > 1;
