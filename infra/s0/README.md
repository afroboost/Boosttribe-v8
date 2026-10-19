# S0 — Profils verrouillés + accès au Live décidé par le serveur (19/10/2026)

**Statut : PRÊT, NON APPLIQUÉ.** Aucune base ni aucun serveur de production n'a été modifié.
À appliquer sur les DEUX bases : `api.boosttribe.pro` (boosttribe.pro) et
`supabase-live.afroboost.com` (afroboost.com/live).

## Règles de `public.profiles`

| | AVANT (constaté en production le 19/10) | APRÈS S0 |
|---|---|---|
| Lecture anonyme | **tous les profils** (`profiles_select USING (true)`) : solde, accès offert, e-mail, rôle… | aucune ligne |
| Lecture connectée | tous les profils | **sa propre ligne** seulement |
| Nom / photo des autres (Live) | via `profiles` | via la vue `profiles_public` (id, full_name, avatar_url) |
| Modification par l'utilisateur | toutes les colonnes de sa ligne (`profiles_update USING (auth.uid() = id)`) | **liste blanche** : full_name, avatar_url, has_accepted_terms, terms_accepted, updated_at ; toute autre colonne garde sa valeur |
| Création de son profil | valeurs choisies par le navigateur (rôle, abonnement…) | colonnes sensibles forcées à une valeur sûre (crédits 0, rôle user, sans accès, e-mail = celui du compte) |
| Backend (service_role), fonctions SQL serveur | libres | libres (inchangé) |
| Solde utilisé pour dépenser | `profiles.credits` (modifiable par l'utilisateur) | `credits_disponibles()` = grand livre, crédits **expirés exclus** |

Exception conservée : l'adresse admin `contact.artboost@gmail.com` garde l'auto-correction
`role=admin / subscription_status=enterprise` faite par `AuthContext.tsx` (même adresse fixe que
la RLS des playlists). Le rôle admin du BACKEND reste décidé par `ADMIN_EMAILS` (inchangé).

## Règles de `public.playlists` et `public.access_requests` (ajout S0b/S0c, revue de sécurité)

| | AVANT | APRÈS S0 |
|---|---|---|
| `host_id` d'une session non revendiquée | tout compte pouvait s'y inscrire (`playlists_update` : `host_id IS NULL`) | posé **uniquement par le backend** (`/session/claim-host`, après débit) |
| mode, prix, capacité, co-hôtes, fin du Live, option d'enregistrement | modifiables par tout « hôte » RLS | backend uniquement (c'est déjà le cas du code) |
| pistes, description, média partagé, `is_private`, `access_mode` | hôte / co-hôte | inchangé |
| Approuver une demande d'accès | tout « hôte » RLS — donc un tiers inscrit hôte pouvait approuver SA demande | backend uniquement (`/session/access-request/{id}/decision`, hôte de référence vérifié) |

Côté backend, seules les lignes `playlists` de l'hôte de RÉFÉRENCE (la plus ancienne ligne de la
session) décident de l'accès ; la preuve d'enregistrement compare la session exactement.

## Revue finale (sur 43afe98) — corrections S0d

| Constat | Statut | Correction |
|---|---|---|
| `wallet_add` (portefeuille CHF) et `recalc_user_credits` **exécutables par un anonyme** — CONSTATÉ EN PRODUCTION sur les 2 bases | préexistant, **critique** | `00_urgent_wallet_add.sql` (applicable seul, tout de suite) + rejoué dans 01 |
| Demande d'accès approuvée : numéro séquentiel + statut public → vidéo d'un Live payant | introduit par S0 | preuve signée remise au seul demandeur (`preuve`, localStorage, jamais dans l'URL) |
| Session sans hôte : un tiers pose access_mode / is_private / promo, conservés après la revendication | introduit par S0 | sur une session sans hôte, le navigateur n'écrit que du contenu |
| `created_at` antidatable / `session_id` non unique | conditionnel | created_at jamais écrit par le navigateur ; 01 s'ARRÊTE si `session_id` n'est pas UNIQUE |
| Une preuve d'enregistrement profitait au co-hôte | introduit par S0b | preuve liée à celui qui envoie (`record:{session}:{uid}` exact) |
| Règle INSERT « System can insert profiles » (true) éventuelle | préexistant | toutes les règles INSERT de profiles remplacées par « son propre profil » |
| Valeurs DÉJÀ falsifiées dans `profiles` (avant S0) | préexistant | **non corrigé automatiquement** : `audit_avant_verrou.sql` (lecture seule) à lancer avant l'étape 2 ; `/api/embed/verify` vérifie désormais l'e-mail auprès de GoTrue |
| Accès Afroboost 12 h sans que `session-started` soit appelé | préexistant | **non corrigé** : changerait le parcours Afroboost (décision produit) |
| Identité LiveKit choisie par le client (éjecter l'hôte) | préexistant | **non corrigé** : lot à part (identité liée au compte) |

## Ordre d'application (au GO)

0. **`00_urgent_wallet_add.sql`** sur les 2 bases — indépendant de S0, le plus tôt possible.

1. **`audit_avant_verrou.sql`** (lecture seule) puis **`01_s0_additif.sql`** sur les 2 bases — ajouts purs (solde autoritaire, vue publique). 01 s'arrête seul si `playlists.session_id` n'est pas unique.
2. **Déployer backend + frontend S0** (les 2 apps : boosttribe.pro et afroboost.com/live).
   Le frontend lit `profiles_public` et retombe sur `profiles` si la vue manque : compatible avant/après.
3. **`02_s0_verrou.sql`** sur les 2 bases — le verrou. Les règles d'origine sont sauvegardées
   (`s0_sauvegarde_policies`) avant d'être retirées.
4. Contrôle : avec la clé anonyme, `GET /rest/v1/profiles?select=id&limit=1` doit renvoyer `[]`.

## Rollback

`rollback_s0.sql` : section ÉTAPE 2 (recrée les règles d'origine **à l'identique** depuis la
sauvegarde, retire le verrou), puis, seulement si nécessaire, section ÉTAPE 1. Le backend S0 sait
se passer de `credits_disponibles` (repli sur `profiles.credits`). Backend/frontend : `git revert`.

## Accès au Live (backend)

| Action | Règle serveur après S0 |
|---|---|
| Jeton **spectateur** (`/livekit/token` viewer) | admin, hôte, co-hôte → oui · live terminé → 410 · mode `private` (« Gratuit par lien / QR ») → oui · mode `paid` → billet, ou demande d'accès approuvée (compte ou `request_id`) · mode `open` : entrée libre (`guest`) → oui ; sinon connexion obligatoire, puis accès illimité (dont **Afroboost 12 h**) → oui, sinon **débit `cost_join` idempotent** (référence `session:uid`, la même que `/credits/spend`) |
| **Prise d'hôte** (`/session/claim-host`) et **scène** de l'hôte | admin → oui · illimité (dont Afroboost) → oui · sinon **débit `cost_host` idempotent AVANT** d'écrire `host_id` ; 402 sinon. Co-hôte invité : gratuit (inchangé) |
| **Envoi d'enregistrement** (`/session/record/upload`) | admin / illimité / option gratuite → oui · sinon il faut une preuve au grand livre que `/session/record/start` a été autorisé et débité pour cette session (403 sinon) |
| Sources de publication | emplacement `_s0_sources_publication()` prêt ; S0 = aucune restriction (BT-CREDIT-2 y branchera `screen_share`) |

## Parcours Afroboost — règles E et F

- **E — jamais de rétrogradation.** `/api/embed/verify` garde le MEILLEUR accès : un plan
  `enterprise` actif, ou un accès plus long, n'est pas touché ; sinon accès « pro » 12 h (inchangé).
- **F — aucune autorisation sans verdict d'Afroboost.** La preuve initiale est le jeton SIGNÉ par
  Afroboost (vérifié à `/verify`) ; le débit de la séance se fait au démarrage (`consume`).
  - verdict OK → l'accès 12 h reste ;
  - refus explicite (`no_credit`, 4xx) → `ok:false` (le Live s'arrête comme avant) **et** l'accès
    offert par CE jeton est retiré ;
  - aucun verdict (réseau, 5xx, réponse illisible) → le Live déjà ouvert **continue**
    (`ok:true, en_attente:true` — n'est plus présenté comme un débit réussi) ; BoostTribe
    réessaie pendant la validité du jeton (30 s, 2 min, 5 min) ; toujours rien → l'accès offert
    par CE jeton est retiré : une nouvelle entrée repasse par afroboost.com (nouvelle preuve).
  - « Retiré » = l'état d'avant ce jeton est restauré, et seulement si l'accès n'a pas changé
    entre-temps : un accès antérieur (enterprise, abonnement, autre jeton déjà débité) n'est jamais touché.
  - Limite assumée : l'état d'avant est gardé en mémoire du processus ; un redémarrage du backend
    pendant les ~7 min de réessais empêche le retrait (journalisé `[S0-AFRO] retrait impossible`).

## Bancs

- `infra/s0/banc/banc_s0.sh` — Postgres 16 local jetable : état actuel reproduit, migration ×2
  (idempotence), tests 1-6 + solde, rollback. Résultat : AVANT 12/32 (les failles), COMPAT migration 1 seule 6/6, APRÈS 39/39, ROLLBACK 3/3, RÉAPPLIQUÉ 37/37.
- `backend/tests/test_s0_parcours_afroboost.py` (A-F, écrit AVANT la modification) et
  `backend/tests/test_s0_acces_serveur.py` (7-15 + ce qui doit rester ouvert).
- `frontend/tests/s0Acces.test.mjs`.
