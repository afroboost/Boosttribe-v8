# Multistream Afroboost — ce que permettent VRAIMENT les plateformes (vérifié le 17/09/2026)

> Sources officielles uniquement (Meta for Developers, YouTube Help / Google Developers, Instagram, TikTok).
> Rien n'est supposé : chaque ligne renvoie à une page consultée le 17/09/2026. Les points « non documenté »
> le sont explicitement.

## Tableau de synthèse

| | Facebook (Page) | YouTube | Instagram | TikTok |
|---|---|---|---|---|
| **1. Ingest** | RTMPS (RTMP en cours de dépréciation) | RTMP / RTMPS (+ HLS, DASH) | RTMPS via **Live Producer** (instagram.com) | RTMP via **LIVE Studio** / **LIVE Producer** (livecenter.tiktok.com) |
| **2. API pour créer le direct** | **OUI** — Live Video API `POST /{page-id}/live_videos?status=LIVE_NOW` → `secure_stream_url` | **OUI** — `liveStreams.insert` → `cdn.ingestionInfo.{ingestionAddress, rtmpsIngestionAddress, streamName}` ; `liveBroadcasts.insert` + `bind` + `transition` | **NON** — « There are no plans to build one at this time » ; `GET /{ig-user-id}/live_media` = lecture seule (« Creating: This operation is not supported ») | **NON** — TikTok for Developers ne liste aucune Live API (Login Kit, Content Posting, Display, Research, Share, Data Portability, Green Screen, Commercial Content) |
| **3. Auth** | Jeton de Page + `pages_manage_posts` + `pages_read_engagement` (profil : `publish_video`) + **App Review « Live Video API »** | OAuth Google, scope `https://www.googleapis.com/auth/youtube` ou `youtube.force-ssl` ; « authorized by the Google Account that owns the broadcasting YouTube channel » | Session instagram.com de l'hôte (aucun jeton d'app) | Session TikTok de l'hôte (aucun jeton d'app) |
| **4. Éligibilité** | Compte ≥ **60 jours**, Page/profil pro ≥ **100 abonnés** (règle depuis le 10/06/2024) | Chaîne **vérifiée**, **aucune restriction live dans les 90 derniers jours**, ≥ 16 ans ; première diffusion : attente jusqu'à 24 h ; mobile : ≥ 50 abonnés (encodeur : pas de seuil documenté) | « Limited access at this time » (Live Producer) ; compte pro/créateur recommandé — non documenté précisément | ≥ **18 ans**, ≥ **1 000 abonnés** pour aller LIVE (varie selon région) ; clé de flux = accès LIVE Studio ou via un réseau créateur |
| **5. Diffusion depuis une app tierce** | OUI (encodeur tiers via l'API) | OUI (encodeur tiers, « streaming software ») | OUI mais uniquement en « Custom RTMP » avec la clé copiée depuis Live Producer | OUI mais uniquement avec la clé copiée depuis LIVE Studio / LIVE Producer |
| **6. URL + clé récupérables par API** | **OUI** (`secure_stream_url`, `stream_url`, `stream_secondary_urls`, `dash_ingest_url`) | **OUI** (`ingestionAddress` + `streamName`, `backupIngestionAddress`, `rtmpsIngestionAddress`) | **NON** — saisie manuelle | **NON** — saisie manuelle |
| **7. Expiration** | Non documentée ; « stream timeout … after 4 seconds of no data » ; direct ≤ 8 h | Non documentée pour la clé ; limite « 10 active streams per channel, 3 active streams per stream key » | **La clé change à chaque live** (« not static, will refresh each time you use Live Producer ») | **Nouvelle clé à chaque live** |
| **8. Fin du live par API** | **OUI** `POST /{live-video-id}?end_live_video=true` (→ VOD) | **OUI** `liveBroadcasts.transition` `broadcastStatus=complete` (ou `enableAutoStop`) | NON — « End the broadcast on Live Producer first before ending the stream » | NON — fin dans TikTok |
| **9. Restrictions** | H.264 L4.2, AAC-LC ≤ 256 kbps, ≤ 1080p60 (4 500-9 000 kbps), keyframe 2 s (max 4), **16:9 attendu** (« if you are too far from this ratio we may not be able support your stream »), ≤ 8 h | Résolutions 240p→2160p (`cdn.resolution`), 30/60 fps, quota API, vertical possible via « second stream key » | 720p@30 recommandé (720×1280, 2 250-6 000 kbps), 60 fps accepté, **9:16** (un flux 16:9 est recadré/zoomé) | Vertical 9:16 attendu (LIVE mobile), non documenté côté API |

## Conséquences pour Afroboost (architecture retenue par l'agent 2)

- **Facebook & YouTube** : mode `api` possible (création + fin du direct par API, clé jamais vue par l'hôte) **ET** mode `manual`
  (l'hôte colle URL + clé depuis Facebook Live Producer / YouTube Studio). Le mode `api` exige : app Meta avec revue
  « Live Video API », client OAuth Google avec scope `youtube` — actions Bassi (voir plus bas). D'ici là : `manual`.
- **Instagram & TikTok** : **saisie manuelle uniquement**, à chaque live (clé renouvelée). L'UI doit le dire honnêtement
  (« Colle la clé donnée par Instagram Live Producer / TikTok LIVE Studio »), jamais un faux bouton « Connecter ».
- **Format** : Facebook attend du 16:9, Instagram/TikTok du 9:16, YouTube accepte les deux. Un seul programStream
  16:9 (Phase 3) est recadré côté Instagram (zoom central) — acceptable pour un premier lot ; un second programme
  vertical est une évolution possible (« second stream key » YouTube, sortie 9:16 dédiée).
- **Garde compte** : en mode `api`, seuls `AFROBOOST_FB_PAGE_ID` / `AFROBOOST_YT_CHANNEL_ID` (figés côté serveur)
  sont acceptés → aucune diffusion possible vers un compte Spordateur. En mode `manual`, la clé appartient à la
  session que l'hôte a ouverte lui-même sur la plateforme.

## Comptes et jetons existants (inspection lecture seule, 17/09/2026)

- **BoostTribe** (`backend/main.py`) : aucun connecteur social, aucun jeton ; chiffrement Fernet existant
  (`APP_ENCRYPTION_KEY`) pour la clé Stripe — réutilisé pour les clés de flux.
- **Afroboost** (`api/server.py`) : aucun connecteur social (audit V533).
- **Studiio** (`origin/main`) : table `social_accounts (user_id, platform, account_id, account_name, access_token,
  refresh_token, expires_at, connected)` — jetons **en clair** ; OAuth : Meta via `config_id` (Facebook Login for
  Business), TikTok `user.info.basic,video.upload`, YouTube `youtube.upload` + `youtube` ; l'utilisateur
  `b03679f0…` porte Instagram **afroboosteur** / Facebook **Afroboost** / TikTok, l'admin `e0575f46…` porte
  Instagram **spordateur**. **Scopes manquants pour un live** : Meta → `pages_manage_posts` +
  `pages_read_engagement` + revue « Live Video API » (à vérifier dans la configuration `config_id`) ; TikTok → aucun
  scope live n'existe ; YouTube → `youtube` est déjà demandé (suffisant), mais le jeton appartient à l'app Studiio.
- **Décision** : **option B** — secrets propres à BoostTribe, chiffrés, jamais partagés avec Studiio ni le client
  (les jetons Studiio sont en clair, dans un autre produit, avec des scopes d'upload).

## Table à créer (Supabase BoostTribe) — SQL

```sql
create table if not exists social_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('instagram','facebook','youtube','tiktok')),
  mode text not null check (mode in ('oauth','api','manual')),
  rtmp_url text,                         -- null en mode oauth (l'ingest est créé au démarrage du direct)
  stream_key_enc text,                   -- Fernet (SOCIAL_SECRETS_KEY, sinon APP_ENCRYPTION_KEY), jamais en clair ; null en mode oauth
  key_hint text,                         -- 4 derniers caractères de la clé (indice UI « clé enregistrée »), jamais la clé
  oauth_token_enc text,                  -- jeton de Page Facebook / refresh token Google, chiffré (mode oauth)
  account_label text,
  account_id text,
  external_id text,                      -- id du live côté plateforme (mode api)
  expires_at timestamptz,
  status text not null default 'connected',
  updated_at timestamptz default now(),
  unique (user_id, platform)
);
alter table social_destinations enable row level security;  -- accès service-role uniquement (backend)

-- Table déjà créée avant le 21/09 ? Migration :
alter table social_destinations alter column stream_key_enc drop not null;
alter table social_destinations alter column rtmp_url drop not null;
alter table social_destinations drop constraint if exists social_destinations_mode_check;
alter table social_destinations add constraint social_destinations_mode_check check (mode in ('oauth','api','manual'));
alter table social_destinations add column if not exists key_hint text;
alter table social_destinations add column if not exists oauth_token_enc text;
```

## Variables d'environnement (NOMS — valeurs à poser par Bassi dans Coolify `boosttribe` backend)

> Le tiroir « Diffuser en direct » lit `GET /social/destinations/status` : chaque plateforme affiche
> **« Configuration requise »** avec les **NOMS** des variables ci-dessous qui manquent (jamais leurs valeurs).
> Tant qu'elles ne sont pas posées, aucun bouton « Connecter » / « Configurer » n'est proposé : pas de bouton mort.

| Variable | Rôle | Effet si absente |
|---|---|---|
| `SOCIAL_SECRETS_KEY` | clé Fernet dédiée (base64 urlsafe 32 octets : `python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`) qui chiffre clés de diffusion et jetons OAuth ; à défaut le module retombe sur `APP_ENCRYPTION_KEY` (Stripe) | sans AUCUNE des deux : les 4 plateformes sont en « Configuration requise » ; un POST Instagram/TikTok répond 409 `config_required` — **jamais** de stockage en clair |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | app Meta (revue « Live Video API », permissions `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`) | Facebook = « Configuration requise » |
| `AFROBOOST_FB_PAGE_ID` | identifiant de la Page Facebook Afroboost — la SEULE Page acceptée au retour OAuth (une Page Spordateur → `refused`, rien n'est stocké) | Facebook = « Configuration requise » |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | client OAuth Google (YouTube Data API v3 activée, scope `https://www.googleapis.com/auth/youtube`) | YouTube = « Configuration requise » |
| `AFROBOOST_YT_CHANNEL_ID` | identifiant de la chaîne YouTube Afroboost — la SEULE chaîne acceptée au retour OAuth | YouTube = « Configuration requise » |
| `SOCIAL_OAUTH_REDIRECT_BASE` | URL publique du backend Live, ex. `https://api-live.afroboost.com` ; les URI de redirection à déclarer chez Meta et Google sont `<base>/social/oauth/facebook/callback` et `<base>/social/oauth/youtube/callback` | Facebook ET YouTube = « Configuration requise » |
| `SOCIAL_ALLOWED_EMAILS` | liste blanche (virgules) des comptes autorisés à lire/écrire une destination ; défaut = `ADMIN_EMAILS` (le compte Afroboost) | défaut sûr : seul le compte Afroboost passe, toute autre identité (Spordateur) reçoit 403 |
| `SOCIAL_LIVE_MODE` | `mock` (défaut, aucun appel sortant) → `real` pour appeler Facebook / YouTube | mock : ingest factice, rien ne sort du serveur |
| `MULTISTREAM_MODE` | `mock` (défaut) → `egress` pour l'Egress LiveKit | mock : MoteurMock, aucun import livekit |
| `SOCIAL_LIVE_GO` | doit valoir exactement `GO_BASSI_TEST_LIVE_SOCIAL` — troisième verrou du direct réel | hors mock sans GO : `/live/broadcast/start` répond **423 Locked**, moteur jamais appelé |
| `AFROBOOST_FB_PAGE_TOKEN` / `AFROBOOST_YT_ACCESS_TOKEN` | (héritage) jetons posés à la main pour la route `prepare` — remplacés par le parcours OAuth | rien : le parcours OAuth stocke ses propres jetons chiffrés |
| `APP_ENCRYPTION_KEY` | déjà en place (Stripe) — chiffrement de repli | voir `SOCIAL_SECRETS_KEY` |

### Parcours OAuth réel (21/09) — `GET /social/oauth/{facebook|youtube}/start` → `callback`
1. Le tiroir demande (avec le jeton Supabase) `GET /social/oauth/<p>/start?return_to=<page courante>` ; le serveur
   répond `{url}` (Facebook `dialog/oauth` ou Google `o/oauth2/v2/auth`, `state` = jeton Fernet horodaté 10 min) — ou
   **409** `{code: config_required, missing: [...]}`.
2. Le navigateur est redirigé ; au retour, `GET /social/oauth/<p>/callback?code=&state=` échange le code **côté
   serveur**, lit les Pages (`/me/accounts`) ou la chaîne (`channels?mine=true`), exige `AFROBOOST_FB_PAGE_ID` /
   `AFROBOOST_YT_CHANNEL_ID`, stocke le jeton de Page / refresh token **chiffré**, puis redirige vers
   `return_to#social=<p>:<connected|refused|cancelled|error|config_required>` (origine limitée à `CORS_ORIGINS`).
3. Au démarrage d'un direct (verrou levé), `resoudre_destination` crée l'ingest via l'API avec ce jeton.

## Actions Bassi avant un vrai live social

1. **Facebook** : app Meta (ou celle de Studiio) → demander la fonctionnalité **Live Video API** (App Review) avec
   `pages_manage_posts` + `pages_read_engagement` ; générer un jeton de Page longue durée pour la Page **Afroboost** ;
   poser `AFROBOOST_FB_PAGE_ID` + `AFROBOOST_FB_PAGE_TOKEN`. Vérifier : Page ≥ 100 abonnés, compte ≥ 60 jours.
2. **YouTube** : Google Cloud → YouTube Data API v3 activée, client OAuth, consentement avec scope
   `https://www.googleapis.com/auth/youtube` sur la chaîne **Afroboost** ; poser `AFROBOOST_YT_CHANNEL_ID` +
   `AFROBOOST_YT_ACCESS_TOKEN` (avec `refresh_token` : rafraîchissement à ajouter au lot suivant). Chaîne vérifiée,
   0 restriction live sur 90 jours.
3. **Instagram** : compte pro Afroboost (afroboosteur) → instagram.com → Ajouter → Live → copier URL + clé au moment du live.
4. **TikTok** : accès LIVE Studio (≥ 1 000 abonnés ou réseau créateur) → copier URL + clé au moment du live.
5. Puis `SOCIAL_LIVE_MODE=real`, `MULTISTREAM_MODE=egress`, `SOCIAL_LIVE_GO=GO_BASSI_TEST_LIVE_SOCIAL` et
   **GO BASSI — TEST LIVE SOCIAL** (plateforme, compte, durée, visibilité, contenu). Sans les trois variables,
   `/live/broadcast/start` refuse (423) : le bouton « Démarrer (simulation) » du tiroir ne fait rien sortir.

## Sources (consultées le 17/09/2026)

- Facebook Live Video API — présentation, permissions, RTMPS, éligibilité 60 j / 100 abonnés :
  https://developers.facebook.com/docs/live-video-api/
- Facebook — démarrage (`POST /me/live_videos?status=LIVE_NOW`, `secure_stream_url`, `end_live_video`, v25.0) :
  https://developers.facebook.com/docs/live-video-api/getting-started
- Facebook — diffuser (créer → streamer → terminer ; timeout 4 s) :
  https://developers.facebook.com/docs/live-video-api/guides/streaming/
- Facebook — spécifications (1080p60, 4 500-9 000 kbps, AAC 256 kbps, keyframe 2 s, ≤ 8 h, 16:9) :
  https://developers.facebook.com/docs/live-video-api/getting-started/specs/
- Facebook — Page live_videos (statuts, champs renvoyés, v26.0) :
  https://developers.facebook.com/docs/graph-api/reference/page/live_videos/
- YouTube Live Streaming API — démarrage (liveBroadcast / liveStream / bind / transition) :
  https://developers.google.com/youtube/v3/live/getting-started
- YouTube — `liveStreams.insert` (scopes `youtube` / `youtube.force-ssl`, `ingestionInfo`, RTMP/DASH/HLS) :
  https://developers.google.com/youtube/v3/live/docs/liveStreams/insert
- YouTube Help — conditions (chaîne vérifiée, 90 jours, 16 ans, 10 flux / 3 par clé, clé verticale) :
  https://support.google.com/youtube/answer/2474026?hl=en&co=GENIE.Platform%3DDesktop
- YouTube Help — restrictions live (mobile 50 abonnés, 24 h) : https://support.google.com/youtube/answer/2853834?hl=en
- Instagram Live Producer (clé non statique, 720p@30, 9:16, « no plans to build one at this time ») :
  https://about.instagram.com/blog/tips-and-tricks/instagram-live-producer
- Instagram Graph API `live_media` (lecture seule) :
  https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/live_media/
- TikTok for Developers — produits (aucune Live API) : https://developers.tiktok.com/doc/getting-started-faq
- TikTok Help — LIVE (18 ans, 1 000 abonnés) : https://support.tiktok.com/en/live-gifts-wallet/tiktok-live
