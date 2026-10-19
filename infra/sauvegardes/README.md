# Sauvegardes automatiques — boosttribe.pro et afroboost.com/live

**Statut : PRÊT, NON INSTALLÉ.** Rien n'est activé sur le serveur tant que Bassi n'a pas donné son GO.

## 1. Constat (audit en lecture seule, 19/10/2026)

| Point | Constat |
|---|---|
| Bases concernées | 2 bases Supabase **dans des services Coolify** : `supabase-db-gneo8v4uuw94cpmf5fh2db3a` (boosttribe.pro) et `supabase-db-l12j96qw3srbix6s5h29yoo4` (afroboost.com/live). Image `supabase/postgres:15.8.1.085`, utilisateur `supabase_admin`. |
| Sauvegardes automatiques actuelles | **Aucune** pour ces 2 bases. Coolify n'a qu'UNE sauvegarde planifiée : `studiio-db` (base indépendante), tous les jours à 03:00, dernière exécution réussie le 19/10 03:00. |
| Rétention studiio-db | **illimitée** (réglages à 0) : 85 fichiers accumulés depuis le 28/07, fichiers lisibles par tous les comptes du serveur (`644`). Hors périmètre, à signaler. |
| Destinations hors serveur (S3) | **Aucune** configurée dans Coolify. |
| Alertes | Les notifications Coolify « échec de sauvegarde » sont cochées, mais **aucun canal n'est actif** (e-mail SMTP/Resend, Discord, Telegram… tous désactivés) : un échec ne serait signalé à personne. |
| Disque | 38 Go, 12 Go libres (68 %). Une sauvegarde complète des 2 bases ≈ 1 Mo compressé : 7 + 4 jours ≈ 15 Mo. |
| Cron root | tâches Afroboost/Spordate existantes ; aucune sauvegarde. |

### Pourquoi pas la sauvegarde native de Coolify seule ?
Coolify (v4.0.0) **sait** sauvegarder la base d'un service Supabase (`ServiceDatabase`), mais pour
une base unique il lance `pg_dump --no-acl --no-owner` : les **droits** (GRANT/REVOKE) et les
**propriétaires** ne sont PAS sauvegardés. Or la sécurité S0 repose dessus (ex. `wallet_add`,
`recalc_user_credits` fermés au public ; `credits_disponibles` appartenant à `postgres` sur /live).
Une restauration depuis ce fichier rouvrirait ces fonctions à tout le monde. C'est prouvé au banc
(test T2 : la restauration d'une sauvegarde sans droits est détectée et refusée).
Le mode « tout sauvegarder » de Coolify (`pg_dumpall`) garde les droits mais embarque les mots de
passe des rôles et donne une restauration plus fragile.

## 2. Solution recommandée (la plus simple qui protège vraiment)

Un **script unique** (`sauvegarde_bases.sh`) lancé **1×/jour par cron** sur le serveur :

1. pour **chaque base séparément** : `pg_dump -Fc` complet (droits et propriétaires inclus) +
   rôles **sans mot de passe** + empreintes de contrôle + vérification que le fichier se relit ;
2. `SHA256SUMS`, dossiers `700`, fichiers `600` (root seul) ;
3. rotation **7 quotidiennes + 4 hebdomadaires** (le dimanche ; liens physiques, aucun espace en plus) ;
4. copie **chiffrée** (AES-256 + clé RSA **publique** du Mac — seule la clé privée du Mac l'ouvre) ;
5. envoi de cette copie chiffrée **hors serveur** (commande `ENVOI_CMD`, voir § 3) ;
6. code de sortie ≠ 0 au moindre échec + alerte (`ALERTE_CMD`, voir § 4).

Et **1×/mois** : `test_restauration.sh` restaure chaque base dans un conteneur jetable **sans
réseau** (même image que la production), puis compare les empreintes (données, droits, règles RLS,
verrous S0). Procédure validée à la main le 19/10/2026.

## 3. Destination hors serveur — options et coûts (approximatifs, à confirmer au moment de souscrire)

Volume : ~0,5 Mo par base et par jour (chiffré) → < 50 Mo au total avec la rétention.

| Option | Coût | Pour | Contre |
|---|---|---|---|
| **A. Hetzner Storage Box BX11** (1 To, SFTP/rsync, sous-compte restreint) | ~3–4 €/mois | même fournisseur et même facture, autre machine ; accès SSH dédié ; snapshots possibles | un abonnement de plus ; même fournisseur (pas de diversité) |
| **B. Stockage S3 compatible** (ex. Backblaze B2, Scaleway, Hetzner Object Storage) | B2 : ~0 € à ce volume (10 Go gratuits) ; Hetzner Object Storage : forfait ~5 €/mois | intégré à Coolify ; fournisseur différent possible ; règles de cycle de vie | nouveau fournisseur = **GO** obligatoire ; clés d'accès à protéger |
| **C. Tirage quotidien vers le Mac de Bassi** (launchd + SSH) | gratuit | aucune donnée chez un tiers | le Mac doit être allumé ; il faudrait une **clé SSH dédiée sans phrase secrète, bridée en lecture** (modification des accès SSH = GO) |

**Recommandation : A** (le plus simple, même fournisseur, ~4 €/mois), avec un sous-compte qui ne
voit qu'un dossier. Dans tous les cas, **seule la copie CHIFFRÉE** quitte le serveur.

Exemple `ENVOI_CMD` pour A (à adapter APRÈS création du sous-compte) :
```
ENVOI_CMD='rsync -a -e "ssh -i /root/.ssh/sauvegarde_storagebox -p 23" "$1/" uXXXXX-sub1@uXXXXX.your-storagebox.de:sauvegardes/'
```

## 4. Alertes

Aujourd'hui un échec ne préviendrait personne. Deux options simples :
- **Canal e-mail Coolify** (Notifications → Email, via le compte Resend existant) : utile pour toutes
  les alertes Coolify ; ne couvre pas un script cron.
- **Surveillance « homme mort »** (ex. healthchecks.io, gratuit) : le script envoie un signal à chaque
  succès (`ALERTE_CMD`) ; sans signal pendant 25 h → e-mail. Seul un signal sans aucune donnée part.
  Nouveau service externe = **GO**.

## 5. Installation (À FAIRE APRÈS GO — dans cet ordre)

1. Copier `sauvegarde_bases.sh`, `test_restauration.sh`, `empreintes.sql` dans `/root/sauvegardes-bases/outils/` (droits 700).
2. (optionnel) `/root/.sauvegarde-bases.env` (600) : `ENVOI_CMD=…`, `ALERTE_CMD=…`.
3. Lancer une fois à la main : `/root/sauvegardes-bases/outils/sauvegarde_bases.sh` → doit finir par `TERMINÉ`.
4. Lancer `test_restauration.sh` → doit afficher `RESTAURATION OK — empreintes IDENTIQUES` pour les 2 bases.
5. Ajouter au cron root (03:30, après studiio à 03:00) :
   ```
   30 3 * * * /root/sauvegardes-bases/outils/sauvegarde_bases.sh >> /var/log/sauvegarde-bases.log 2>&1
   0 5 1 * * /root/sauvegardes-bases/outils/test_restauration.sh >> /var/log/sauvegarde-bases.log 2>&1
   ```
6. Le lendemain : vérifier le journal et la présence du jour dans `/root/sauvegardes-bases/quotidien/`.

Retour arrière : retirer les 2 lignes du cron. Aucun service, aucune base, aucun réglage Coolify modifié.

## 6. Restauration complète (en cas d'incident)

⚠️ Toujours essayer d'abord le retour arrière CIBLÉ (ex. `rollback_s0.sql`), qui ne touche pas aux données.
Restaurer une base entière efface tout ce qui a été écrit depuis la sauvegarde :
1. comparer le grand livre de production à la sauvegarde ; **extraire les lignes postérieures** (crédits, débits) ;
2. tester la restauration dans un conteneur jetable (`test_restauration.sh <dossier_du_jour>`) ;
3. sur la base cible : `psql -U supabase_admin -d postgres < <base>-roles.sql` (les rôles existants sont ignorés), puis
   `pg_restore -U supabase_admin -d postgres --clean --if-exists <base>-postgres.dump` ;
   messages attendus sur une image Supabase neuve : ≤ 4, sans effet sur les données (schéma `storage`, clé `auth.users`, fonction GraphQL) ;
4. recalculer les empreintes (`empreintes.sql`) et les comparer à `<base>-empreintes.txt` ;
5. réinsérer les lignes extraites à l'étape 1, puis contrôler les soldes.

Copie chiffrée (hors serveur ou sur le Mac) : déchiffrer avec `~/.afroboost-s0-sauvegarde/cle_privee.pem`
(voir `banc/banc_sauvegardes.sh`, test T5, pour les deux commandes `openssl`).

## 7. Banc local

`bash infra/sauvegardes/banc/banc_sauvegardes.sh` (Postgres 16 Homebrew + faux docker, données factices) :
T1 sauvegarde → restauration identique · T2 sauvegarde sans droits détectée · T3 base injoignable → échec signalé ·
T4 rotation 7 + 4 sur 35 jours · T5 copie chiffrée ouverte par la clé privée du Mac.

## 8. Risques restants

- Tant que l'envoi hors serveur n'est pas activé, une panne du serveur emporte aussi les sauvegardes
  (seule la copie manuelle du 19/10 est sur le Mac).
- La clé privée du Mac est le seul moyen d'ouvrir les copies chiffrées : en garder une copie dans le gestionnaire de mots de passe.
- Le test de restauration démarre un conteneur de ~512 Mo : à lancer hors des heures de Live (le cron prévu : le 1er du mois à 05:00).
- `studiio-db` : rétention illimitée et fichiers lisibles par tous (hors périmètre).
