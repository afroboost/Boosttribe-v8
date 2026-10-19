# S0 — Résultats de l'audit des données avant verrou (19/10/2026)

Lecture seule stricte (`default_transaction_read_only=on`, vérifié `on`), via le terminal Coolify des conteneurs
`supabase-db-gneo8…` (boosttribe.pro) et `supabase-db-l12j96…` (afroboost.com/live). Script : `audit_donnees_19-10.sql`.
Identifiants tronqués (8 car.), aucun e-mail. **0 donnée modifiée.**

## boosttribe.pro
| Contrôle | Résultat |
|---|---|
| Comptes / profils | 16 comptes, **5 profils** (11 comptes sans ligne `profiles`) |
| Crédits | 0 négatif ; 4 profils > 20 (max 100), tous expliqués par le grand livre ; **0 écart** solde ↔ grand livre |
| Rôles | 5 × `user` (aucun admin en base) ; subscription_status free:4 none:1 ; coach_payment_type subscription:5 (aucun « commission ») |
| comp_access | 2 × pro, **0 actif**, 0 sans fin, 0 enterprise |
| E-mail profil ≠ compte | 0 |
| Grand livre | offered 5 (somme 401), launch_bonus 1, signup_bonus 10, spend_host 18, spend_join 18, spend_record 2 ; 0 doublon ; 0 solde négatif ; 0 crédit expiré |
| Gros mouvements | 4 × +100 « offered » (29/06, 30/06, 01/07, 15/10) — dont 1 ref `manual_topup…` SANS expiration (recharge manuelle) |
| Lignes sans profil | 5 × signup_bonus +1 (comptes existants sans ligne profiles) |
| Sessions | 160, 17 sans hôte (aucune avec réglage d'accès), 0 hôte inconnu, 0 doublon ; modes open/guest 11, open/account 144, private 5 |
| Hôtes sans débit d'animation | admin (93 sessions, gratuit par règle) + 2 comptes ordinaires (1 et 3 sessions, juin-juillet) |
| Co-hôtes | 1 co-hôte stocké sous un identifiant de connexion (25 car., pas un compte) |
| Demandes d'accès | 7 approuvées, 2 refusées ; 0 approuvée sans date de décision ; 0 auto-approuvée |
| Billets / enregistrements / portefeuilles | 0 / 0 / 0 |
| Abonnements coach | 1 « active » (octroi admin) dont la période est **échue** depuis le 28/07 |

## afroboost.com/live
| Contrôle | Résultat |
|---|---|
| Comptes / profils | 3 comptes, 2 profils |
| Crédits | max 1, 0 négatif, 0 écart |
| Rôles | 2 × `user`, free, subscription |
| comp_access | 2 × pro (admin : fin 15/10 16:21 ; 1 compte : fin 03/10 00:24) — **tous deux expirés**, durées compatibles avec l'accès Afroboost 12 h |
| Grand livre | 4 lignes : 3 signup_bonus, 1 spend_join ; 0 doublon ; numéro 4 absent (séquence) ; 1 ligne sans profil (compte sans ligne profiles) |
| Sessions | 252, 0 sans hôte, 0 doublon, 0 co-hôte ; open/account 199, private/account 46, open/guest 4, private/guest 3 ; 1 terminée |
| Hôtes | admin (225) + 1 compte (27 sessions, 16/09→02/10, accès « pro » Afroboost) — aucun débit d'animation (illimité) |
| Demandes / billets / enregistrements / portefeuilles | 0 / 0 / 1 / 0 |
| Schéma | `tickets` sans `provider`/`tx_ref`/`paid_*` (présentes sur boosttribe.pro) ; `playlists.cohosts` est **jsonb** (le banc S0 le simulait en text[]) |

## Décision : B — anomalies explicables, aucune falsification détectée
