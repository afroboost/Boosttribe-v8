# Sauvegardes automatiques — boosttribe.pro et afroboost.com/live

**Statut : PRÊT, NON INSTALLÉ.** Rien n'est activé sur le serveur tant que Bassi n'a pas donné son GO.

| Fichier | Rôle |
|---|---|
| `sauvegarde_bases.sh` | sauvegarde quotidienne : 2 bases + leurs fichiers (Supabase Storage), chiffrement, rotation, envoi, alertes |
| `test_restauration.sh` | test mensuel : restauration complète dans un conteneur jetable, comparaison stricte |
| `empreintes.sql` | empreintes de contrôle (données + chaque protection d'accès, objet par objet) |
| `protections_s0.sql` | les 51 protections S0 / post-S0 critiques, vérifiées une à une en valeur absolue |
| `erreurs_restauration_connues.txt` | liste blanche documentée des messages bénins d'une restauration Supabase |
| `sauvegarde-bases.conf.exemple` | modèle de configuration (envoi, alertes healthchecks.io / Resend) — aucun secret |
| `logrotate-sauvegarde-bases.exemple` | modèle logrotate du journal |
| `banc/` | banc local (Postgres 16 + faux docker, schémas réels, 52 cas) |

## 1. Constat (audit en lecture seule, 19/10/2026)

| Point | Constat |
|---|---|
| Bases concernées | 2 bases Supabase **dans des services Coolify** : `supabase-db-gneo8v4uuw94cpmf5fh2db3a` (boosttribe.pro) et `supabase-db-l12j96qw3srbix6s5h29yoo4` (afroboost.com/live). Image `supabase/postgres:15.8.1.085`, utilisateur `supabase_admin`. |
| Fichiers | Les sons des sessions (seau `audio-tracks`, public) et les enregistrements (seau `session-recordings`, privé) sont des **fichiers** du service storage de chaque pile, PAS des lignes de la base : un `pg_dump` ne les contient pas (seulement leurs lignes `storage.objects`). |
| Sauvegardes automatiques actuelles | **Aucune** pour ces 2 bases ni leurs fichiers. Coolify n'a qu'UNE sauvegarde planifiée : `studiio-db` (base indépendante), tous les jours à 03:00. |
| Rétention studiio-db | **illimitée** (réglages à 0) : 85 fichiers accumulés depuis le 28/07, lisibles par tous les comptes du serveur (`644`). Hors périmètre, à signaler. |
| Destinations hors serveur (S3) | **Aucune** configurée dans Coolify. |
| Alertes | Les notifications Coolify « échec de sauvegarde » sont cochées, mais **aucun canal n'est actif** : un échec ne serait signalé à personne. |
| Disque | 38 Go, 12 Go libres (68 %). Les 2 bases ≈ 1 Mo compressé. Taille des fichiers : **à mesurer** (§ 5, étape 0). |

### Pourquoi pas la sauvegarde native de Coolify seule ?
Coolify (v4.0.0) sauvegarde la base d'un service Supabase avec `pg_dump --no-acl --no-owner` : les
**droits** (GRANT/REVOKE) et les **propriétaires** ne sont PAS sauvegardés. Or la sécurité S0 repose
dessus (`wallet_add`, `recalc_user_credits` fermés au public ; propriétaire de `credits_disponibles`…).
Une restauration depuis ce fichier rouvrirait ces fonctions à tout le monde (banc, cas R4 : détecté et refusé).

## 2. Solution

`sauvegarde_bases.sh`, **1×/jour par cron** sur le serveur :

1. pour **chaque base** : `pg_dump -Fc` complet (droits et propriétaires inclus) + rôles **sans mot de
   passe** + empreintes relevées avant ET après (on recommence si une écriture tombe entre les deux) +
   vérification que le fichier se relit ;
2. **protections S0** relevées sur la production : s'il en manque une, la sauvegarde est quand même
   enregistrée, chiffrée et envoyée, puis le script **finit en échec et alerte** (une faille en production
   ne doit pas passer inaperçue) ;
3. pour **chaque stockage de fichiers** : archive `tar` du dossier du service storage (lecture seule,
   attributs étendus conservés avec GNU tar) + manifeste `sha256 taille chemin` relevé avant et après ;
   fichiers inchangés depuis la veille → l'archive de la veille est réutilisée (lien physique) ;
4. `SHA256SUMS`, dossiers `700`, fichiers `600` (root seul) ; rotation **7 quotidiennes + 4 hebdomadaires** ;
5. copie **chiffrée** (AES-256, clé transmise par descripteur, jamais exportée + clé RSA-OAEP **publique**
   du Mac — seule la clé privée du Mac l'ouvre), même rotation (7) ;
6. envoi de cette copie chiffrée **hors serveur** (`ENVOI_CMD`) ;
7. code de sortie ≠ 0 au moindre échec ; `ALERTE_CMD` appelée **en échec ET en succès**.

Échecs imposés (code ≠ 0 + alerte) : envoi configuré qui échoue ; envoi configuré mais clé publique
absente ou illisible ; base injoignable ; dossier des fichiers introuvable ; archive incohérente ;
protection S0 manquante en production ; espace disque insuffisant (2 Go + 2× la taille des fichiers).
Sans clé ni envoi : simple avertissement (copie locale seulement), sauf `EXIGER_HORS_SERVEUR=1`.

`test_restauration.sh`, **1×/mois** : pour chaque base, conteneur jetable **sans réseau** (même image que la
production), rôles puis `pg_restore`, et **échec (code ≠ 0)** si :
- une **erreur** de restauration n'est pas dans `erreurs_restauration_connues.txt` (plus aucun `|| true`
  silencieux : chaque message est compté et classé, les connus sont listés dans le journal) ;
- une **empreinte** diffère (ligne à ligne, l'écart est affiché) ;
- une **protection S0 critique** manque (même si elle manquait déjà en production) ;
- les **fichiers** extraits ne correspondent pas au manifeste, ou une ligne `storage.objects` n'a pas son
  fichier (`STOCKAGE_COHERENCE=strict`, défaut) ; une base sans archive de fichiers (`EXIGER_STOCKAGE=1`).
Le succès est signalé explicitement (`RESTAURATION OK …` par base, `TERMINÉ : …`, alerte `succes`).

### Ce que contrôlent les empreintes (`empreintes.sql`)
| Ligne | Contenu |
|---|---|
| `profils`, `grand_livre`, `sessions`, `comptes` | nombre, sommes, md5 des lignes (aucune donnée en clair) |
| `stockage_seaux`, `stockage_objets` | seaux (public/privé) et lignes `storage.objects` (seau/nom/taille, md5) |
| `rel` | chaque table / vue / séquence de `public` (+ `storage.buckets/objects`) : type, **propriétaire**, **RLS**, **RLS forcée**, **droits** (normalisés, triés), définition et options des vues |
| `col` | droits par colonne |
| `fn` | chaque fonction de `public` : propriétaire, **SECURITY DEFINER**, volatilité, **search_path**, **droits**, md5 du corps |
| `regle` | chaque politique RLS de `public` et `storage` : permissive/restrictive, commande, rôles, USING, WITH CHECK |
| `verrou` | chaque déclencheur de `public`, `auth`, `storage` avec son **état** (activé / désactivé / replica) |
| `schema`, `role`, `defaut` | propriétaire + droits des schémas ; attributs des rôles Supabase (sans mot de passe) et appartenances ; droits par défaut |

### Les protections S0 critiques (`protections_s0.sql`, `S0_NIVEAU=complet` par défaut)
- `wallet_add`, `recalc_user_credits`, `add_credits`, `spend_credits`, `credits_disponibles` : aucun EXECUTE
  pour PUBLIC/anon/authenticated, EXECUTE pour service_role, SECURITY DEFINER, search_path figé ;
  `credits_disponibles` du même propriétaire que `spend_credits` ;
- `credit_ledger` : RLS, aucune règle d'écriture pour public/anon/authenticated, déclencheur actif ;
- RLS de `profiles` et `playlists` ; vue `profiles_public` limitée à 3 colonnes et en lecture seule ;
- étape 2 : règles `s0_profiles_*_soi` exactes et aucune autre règle permissive sur `profiles` ; verrous
  `s0_proteger_profil` / `s0_proteger_playlist` actifs et **SECURITY INVOKER** ; `s0_defaut` fermée à anon ;
  `s0_sauvegarde_policies` fermée ; `access_requests_host_update` absente.

`S0_NIVEAU=etape1` n'exige que 00 + 01 ; `aucun` désactive ce contrôle (déconseillé).

### Les protections post-S0 (migrations `infra/post-s0/migrations/03` et `04`, `POST_S0_NIVEAU`)
- **03 (preuve CGU, 2 bases)** : `accepter_cgu(text)` sans EXECUTE pour PUBLIC/anon, avec EXECUTE pour
  authenticated, SECURITY DEFINER, search_path figé, même propriétaire que `profiles` ; colonnes
  `terms_accepted_at` / `terms_version` ; déclencheur `s0_proteger_profil_cgu` actif, BEFORE INSERT OR UPDATE
  par ligne, SECURITY INVOKER, et dont le corps rétablit les deux colonnes pour anon/authenticated (les droits
  de colonne ne peuvent pas exprimer cette protection) ; contrainte `profiles_cgu_preuve_coherente` validée ;
  `s0c_cgu_preuve_sauvegarde` (laissée par le rollback 03) fermée si elle existe.
- **04 (session sans hôte, /live)** : `playlists_update` = seule règle UPDATE, sans `host_id IS NULL`, de la
  forme posée par 04 (ou de la forme d'origine de boosttribe.pro, qui n'a jamais eu la faille) ;
  `ps0_04_sauvegarde_policy` en RLS et fermée à anon/authenticated si elle existe.

**Niveau** (`POST_S0_NIVEAU`, un seul pour les 2 bases, défaut `aucun`) — approche retenue : la plus simple,
une variable comme `S0_NIVEAU` :

| valeur | 03 | 04 | quand |
|---|---|---|---|
| `aucun` | contrôlée **si un objet 03 existe** (sinon `SANS_OBJET`) | contrôlée **si `ps0_04_sauvegarde_policy` existe** | aujourd'hui (03/04 préparées, non appliquées) |
| `03` | **exigée** : absente = `MANQUANTE` | conditionnelle | après 03 sur les 2 bases |
| `03_04` | exigée | **exigée** : `host_id IS NULL` revenu = `MANQUANTE` (boosttribe.pro : déjà conforme) | après 03 + 04 |

Pourquoi un niveau : en `aucun`, une restauration qui a perdu 03/04 **en entier** (objets disparus) ressemble à
une base où elles n'ont jamais été appliquées → `SANS_OBJET`. Seul le niveau explicite le voit en valeur
absolue. **Après chaque application de 03 / 04 en production, passer `POST_S0_NIVEAU` au niveau atteint**
dans `/root/.sauvegarde-bases.env`. Valeur inconnue = ligne `MANQUANTE` (`niveau.post_s0.valide`).
Manuellement : `psql -At -v niveau=complet -v post_s0=03_04 < protections_s0.sql` (sans `post_s0` : `aucun`).

## 3. Destination hors serveur — options et coûts (approximatifs, à confirmer au moment de souscrire)

| Option | Coût | Pour | Contre |
|---|---|---|---|
| **A. Hetzner Storage Box BX11** (1 To, SFTP/rsync, sous-compte restreint) | ~3–4 €/mois | même fournisseur, autre machine ; accès SSH dédié ; snapshots | un abonnement de plus ; pas de diversité de fournisseur |
| **B. Stockage S3 compatible** (Backblaze B2, Scaleway, Hetzner Object Storage) | B2 : ~0 € à faible volume ; Hetzner OS : ~5 €/mois | fournisseur différent possible ; cycle de vie | nouveau fournisseur = **GO** ; clés à protéger |
| **C. Tirage quotidien vers le Mac de Bassi** (launchd + SSH) | gratuit | aucune donnée chez un tiers | Mac allumé ; clé SSH dédiée bridée (modification des accès SSH = GO) |

**Recommandation : A**, sous-compte limité à un dossier. Dans tous les cas, **seule la copie CHIFFRÉE**
quitte le serveur. Exemple dans `sauvegarde-bases.conf.exemple` (`ENVOI_CMD`, arguments `$1` dossier,
`$2` préfixe du jour). Si les fichiers audio pèsent lourd, prévoir le volume (la copie chiffrée du jour
contient les archives de fichiers).

## 4. Alertes

`ALERTE_CMD` est appelée par les deux scripts, **à chaque passage** : `$1` = `succes`|`echec`,
`$2` = message (sans secret), `$3` = `sauvegarde`|`restauration`. Délai maximal `ALERTE_DELAI_S` (30 s).
Une alerte qui ne part pas est journalisée (`alerte … NON envoyée`) sans masquer le résultat.

Exemples prêts à l'emploi (testés avec un faux `curl`, JSON valide) dans `sauvegarde-bases.conf.exemple` :
- **healthchecks.io** (« homme mort », gratuit) : ping de succès, `/fail` en échec, un contrôle par script
  (sauvegarde : période 1 j ; restauration : 31 j). Sans ping → e-mail de healthchecks.io.
- **API Resend** (compte existant) : e-mail en cas d'échec seulement (clé API dédiée « envoi seul »).

Les deux sont des services externes : **GO** obligatoire. Rien n'est activé par défaut.

## 5. Installation (À FAIRE APRÈS GO — dans cet ordre)

0. **Repérer les dossiers de fichiers** (lecture seule) :
   ```
   docker ps --format '{{.Names}}' | grep -E 'supabase-storage-(gneo8v4uuw94cpmf5fh2db3a|l12j96qw3srbix6s5h29yoo4)'
   docker inspect -f '{{range .Mounts}}{{.Destination}} <- {{.Source}}{{"\n"}}{{end}}' supabase-storage-gneo8v4uuw94cpmf5fh2db3a
   docker exec supabase-storage-gneo8v4uuw94cpmf5fh2db3a printenv STORAGE_BACKEND FILE_STORAGE_BACKEND_PATH
   du -sh <dossier Source monté sur /var/lib/storage>
   ```
   Attendu : `STORAGE_BACKEND=file`, `FILE_STORAGE_BACKEND_PATH=/var/lib/storage`, et une source du type
   `/data/coolify/services/<uuid>/volumes/storage` (fichiers sous `stub/stub/<seau>/<nom>/<version>`).
   Si les noms de conteneurs diffèrent, poser `STOCKAGES` dans le fichier de configuration (conteneur ou
   chemin absolu). Si `STORAGE_BACKEND=s3`, les fichiers ne sont PAS sur ce serveur : en parler avant
   d'installer. Vérifier que `du` laisse de la place (2 Go + 2× la taille des fichiers, plus 7 copies chiffrées).
1. Copier `sauvegarde_bases.sh`, `test_restauration.sh`, `empreintes.sql`, `protections_s0.sql`,
   `erreurs_restauration_connues.txt` dans `/root/sauvegardes-bases/outils/` (droits 700 / 600).
2. `cp sauvegarde-bases.conf.exemple /root/.sauvegarde-bases.env && chmod 600 /root/.sauvegarde-bases.env`,
   puis décommenter / remplir ce qui a reçu un GO (`ENVOI_CMD`, `ALERTE_CMD`…).
3. Lancer une fois à la main : `/root/sauvegardes-bases/outils/sauvegarde_bases.sh` → doit finir par `TERMINÉ`
   (et `protections` sans `MANQUANTE` : `grep MANQUANTE /root/sauvegardes-bases/quotidien/*/*-protections.txt`).
4. Lancer `test_restauration.sh` → `RESTAURATION OK — empreintes IDENTIQUES …` pour les 2 bases.
   ⚠ 1er test réel : relire les « messages connus » listés. S'il apparaît un message **inconnu** (échec),
   l'examiner ; ne l'ajouter à `erreurs_restauration_connues.txt` qu'une fois compris ET si les empreintes
   sont identiques. Si une empreinte diffère pour une raison propre à l'image Supabase (et non à la
   sauvegarde), le noter et ajuster le périmètre d'`empreintes.sql` dans une version dédiée — jamais en
   désactivant le test.
5. Journal : `install -m 600 /dev/null /var/log/sauvegarde-bases.log` puis
   `cp logrotate-sauvegarde-bases.exemple /etc/logrotate.d/sauvegarde-bases` (contrôle : `logrotate -d …`).
6. Cron root (03:30, après studiio à 03:00) :
   ```
   30 3 * * * /root/sauvegardes-bases/outils/sauvegarde_bases.sh >> /var/log/sauvegarde-bases.log 2>&1
   0 5 1 * * /root/sauvegardes-bases/outils/test_restauration.sh >> /var/log/sauvegarde-bases.log 2>&1
   ```
7. Le lendemain : journal, présence du jour dans `/root/sauvegardes-bases/quotidien/`, alerte de succès reçue.

Lancement manuel : identique à l'étape 3 (les deux scripts n'ont besoin d'aucun argument ;
`test_restauration.sh <dossier_du_jour>` teste un jour précis). Retour arrière : retirer les 2 lignes du cron
(et le fichier logrotate). Aucun service, aucune base, aucun réglage Coolify modifié.

## 6. Restauration complète (en cas d'incident)

⚠️ Toujours essayer d'abord le retour arrière CIBLÉ (ex. `rollback_s0.sql`), qui ne touche pas aux données.
Restaurer une base entière efface tout ce qui a été écrit depuis la sauvegarde :
1. comparer le grand livre de production à la sauvegarde ; **extraire les lignes postérieures** (crédits, débits) ;
2. tester la restauration dans un conteneur jetable (`test_restauration.sh <dossier_du_jour>`) ;
3. sur la base cible : `psql -U supabase_admin -d postgres < <base>-roles.sql` (rôles existants refusés, sans effet), puis
   `pg_restore -U supabase_admin -d postgres --clean --if-exists <base>-postgres.dump` ; seuls les messages de
   `erreurs_restauration_connues.txt` sont attendus ;
4. recalculer les empreintes (`psql -At -v niveau=complet < empreintes.sql`) et les comparer à `<base>-empreintes.txt` ;
   contrôler `protections_s0.sql` (aucune ligne `MANQUANTE`) ;
5. réinsérer les lignes extraites à l'étape 1, puis contrôler les soldes.

Fichiers : service storage ARRÊTÉ, extraire `<base>-stockage.tar` dans un dossier neuf
(`tar -xf … --xattrs --xattrs-include='*' --numeric-owner -C <dossier>`), comparer à `<base>-stockage.manifeste`,
puis remplacer le dossier monté (garder l'ancien de côté) et redémarrer le service.

Copie chiffrée (hors serveur ou sur le Mac) : déchiffrer avec `~/.afroboost-s0-sauvegarde/cle_privee.pem`
(voir `banc/banc_sauvegardes.sh`, cas T2, pour les deux commandes `openssl`).

## 7. Banc local

`bash infra/sauvegardes/banc/banc_sauvegardes.sh` — Postgres 16 Homebrew + faux docker (Docker n'est pas
installé sur le Mac ; sur le serveur, le test utilise la vraie image Supabase). Sources = **schémas réels**
des 2 bases (banc S0, variantes bt et live) + migrations S0 00/01/02 + compléments factices (storage,
données, fichiers audio factices). Tout est créé par `mktemp` (sous `$TMPDIR`) et supprimé à la fin, faux
conteneurs compris (`BANC_GARDER=1` pour garder les journaux). Clé RSA de banc (jamais celle du Mac).
Résultat au 19/10/2026 : **52 OK / 0 échec** —
N1-N3 nominal ; P0 témoin + **P1-P23 une protection retirée par cas → échec** ; Q1-Q2 production déjà
trouée → alerte + échec ; R1-R5 erreurs de restauration ; E1-E10 envoi, clé, alertes ; F1-F5 fichiers ;
T1-T3 rotation 35 jours, copie chiffrée, restauration depuis la copie.

## 8. Risques restants

- Tant que l'envoi hors serveur n'est pas activé, une panne du serveur emporte aussi les sauvegardes
  (seule la copie manuelle du 19/10 est sur le Mac, sans les fichiers audio).
- La clé privée du Mac est le seul moyen d'ouvrir les copies chiffrées : en garder une copie dans le gestionnaire de mots de passe.
- **Validé au banc, pas encore sur l'image Supabase réelle** : la liste blanche des erreurs et le périmètre des
  empreintes (rôles, schémas `storage`/`auth`) doivent être confirmés au 1er test serveur (§ 5, étape 4) ; un
  écart propre à l'image donnera un échec franc (jamais un faux succès).
- Fichiers : chemin du volume à confirmer (§ 5, étape 0) ; les attributs étendus (type MIME des objets) ne
  sont pas dans le manifeste ; la copie chiffrée du jour contient les archives de fichiers (volume à prévoir).
- Le test de restauration démarre un conteneur de ~512 Mo et extrait les fichiers : hors des heures de Live.
- `studiio-db` : rétention illimitée et fichiers lisibles par tous (hors périmètre).
