# Contrat de non-régression du Live

Le Live (boosttribe.pro **et** afroboost.com/live, même code : ce dépôt) est en production avec de vrais
participants. Chaque fonction ci-dessous est **protégée** : elle a un test qui la fait vraiment tourner.

## La règle

```bash
cd frontend
yarn test:live-contract          # AVANT de toucher au Live, puis APRÈS chaque modification
yarn test:live-contract --prod   # APRÈS un déploiement (fumée LECTURE SEULE sur la production)
```

- **AVANT** toute modification du Live : lancer le contrat (il doit être vert — sinon le signaler d'abord).
- **APRÈS** : contrat + tests concernés + build.
- **AUCUN push / déploiement** si une seule ligne est en ÉCHEC. Une fonction protégée qui régresse = on corrige, on ne livre pas.
- Une nouvelle fonction protégée = une ligne ici **et** une vérification dans `frontend/tests/contrat/` ou `frontend/tests/liveContract.test.mjs`.
- Changer volontairement une règle protégée (décision de Bassi) : modifier le test **et** cette page, et le dire dans le rapport.

## Ce que fait la commande (≈ 2 min)

| Étape | Outil | Où |
|---|---|---|
| Suite front complète | `node --test` | `frontend/tests/*.test.mjs` |
| Harnais navigateur : vrais composants **cliqués**, caméra + embellissement **mesurés** en 1080p, 1440p, 4K | Playwright + Chromium (2 caméras factices, vrai GPU, CSS Tailwind réelle) | `frontend/tests/contrat/harnais.tsx` |
| Banc LiveKit **local** : l'hôte publie (4K, simulcast, beauté ON), un spectateur reçoit | `livekit-server` local + 2 pages Chromium | `frontend/tests/contrat/contrat.mjs` |
| Serveur du Live | `pytest` | `backend/tests/` (préférences + parcours, promo, invité, fin) |
| Build de production | `vite build` (dossier temporaire) | — |
| `--prod` : pages publiques sans écran noir, sans 500, sans erreur JS (GET uniquement, aucune écriture) | Playwright | boosttribe.pro, afroboost.com/live |

Outils introuvables = contrat **rouge** (jamais un « skip » silencieux) :
- Playwright : `frontend/node_modules`, `PLAYWRIGHT_DIR`, ou `~/.claude/skills/gstack`.
- LiveKit : `LIVEKIT_SERVER`, ou `~/.cache/livekit/livekit-server` (`brew fetch livekit`, puis extraire `bin/livekit-server` du bottle).

Le harnais ne joint **jamais** la production : réseau des appels promo intercepté, LiveKit local, jeton factice.

## Fonctions protégées

Légende — **C** : comportemental (le code tourne : clic, mesure, appel réel) ; **S** : lecture de source (branchement).

| Fonction | Garantie | Preuve |
|---|---|---|
| Ouverture du Live | le build passe ; pages publiques sans écran noir ni 500 | build (C) + `--prod` (C, après déploiement) |
| Invitation / QR | le QR de la session se **décode** en lien `…/promo/<CODE>` ; le lien reste valable d'un Live à l'autre | harnais (C, BarcodeDetector) + `finLiveLien` (S) |
| Bon retour invité | identité côté serveur, aucune coordonnée en clair dans le navigateur | `test_live_invite.py` (C), `bonRetour`, `liveContract` (C) |
| Quitter = temporaire | item présent pour tous ; l'hôte qui quitte ne renvoie pas les participants | harnais (C) + `finDuLive`, `liveContract` (C) |
| Terminer = définitif | hôte seul, confirmation « Terminer le Live pour tout le monde ? », distinct de Quitter | harnais (C) + `finDuLive` (C) |
| Avec crédits / Gratuit par lien-QR **mémorisés** | le dernier mode ENREGISTRÉ revient au prochain Live (navigateur fermé, reconnexion, panne de `profiles`) | `test_preferences_live_parcours.py` (C) |
| Écoute uniquement / Accès visio **mémorisés** | idem pour les droits des invités ; sélecteur cliqué | parcours (C) + harnais (C) |
| Réglage à la main jamais écrasé | refresh, Quitter puis retour, autre navigateur : un Live réglé à la main garde SON réglage | parcours (C) |
| Fermer l'overlay sans enregistrer | ne change aucune préférence | parcours (C) |
| Préférences : sécurité | identité = jeton serveur ; seul l'hôte ENREGISTRÉ d'un Live l'applique (un Live sans hôte n'est jamais « pris ») ; on ne marque que ses propres Lives ; stockage relu en liste blanche ; prix mémorisé revalidé (limites de `/session/configure`) | `test_preferences_live_securite.py` (C) |
| Menu ⋮ | s'ouvre ; items selon le rôle | harnais (C) |
| Faire la promo | participant connecté : item → fenêtre → `POST /live-promo/requests` ; invité **identifié** (05/10) : item → fenêtre directe (voir G–J) ; invité NON identifié : item → « Se connecter » ; hôte : jamais (il a « Promotions live ») ; promo fermée : absent | harnais (C) + `liveContract` (C/S) + `test_live_promo*.py` (C) |
| Promotions live (hôte) | entrée hôte cliquée ; réglages repris au prochain Live | harnais (C) + `test_preferences_live.py` (C) |
| Chat | message saisi → bulle affichée ; anti-flood | harnais (C) + `liveChat`, `liveChatUi` |
| **A** Invité identifié — chat | invité SANS compte (pseudo + e-mail/WhatsApp à l'entrée, Live Afroboost) : champ actif, le message PART (`droitChatLive` = Pro **ou** invité identifié ; jamais un compte plateforme exigé) | harnais 2 pages (C) + `inviteChatPromo` (C/S) |
| **B** Invité identifié — reçu chez l'hôte | le message de l'invité arrive chez l'hôte (même règle à la réception : `accepterMessageChatRecu`) ; l'invité reçoit aussi les messages des autres | harnais 2 pages (C) + `inviteChatPromo` (C) |
| **C** Question invité → UNE suggestion | « Est-ce que je peux participer si je débute ? » → UNE demande d'IA, même après double réception du même `message_id` | harnais 2 pages (C) + `inviteChatPromo` (C) |
| **D** IA chez l'hôte seul | aucune suggestion, aucun panneau IA, aucune réponse automatique chez l'invité | harnais 2 pages (C) |
| **E** / **F** Utiliser / Ignorer | dans le vrai panneau de l'hôte, sur la question de l'invité : Utiliser → « Mon texte » (rien n'est envoyé au chat) ; Ignorer → supprimée, texte intact | harnais 2 pages (C, clics) |
| **G** Invité identifié — « Faire la promo » | ⋮ → Faire la promo → fenêtre DIRECTE (jamais « Se connecter ») ; la demande part avec la session invité EXISTANTE (`X-Live-Guest`, jeton court obtenu avec le cookie `afb_live_guest`), sans compte | harnais (C, réseau intercepté) + `inviteChatPromo` (C) |
| **H** Demande promo invité reçue chez l'hôte | serveur : jeton de session invité vérifié → demande enregistrée sous SON pseudo → listée chez l'hôte ; un compte garde son chemin (prioritaire) | `test_live_promo_invite.py` (C) |
| **I** Aucune 2e saisie | ni écran de connexion, ni champ pseudo / e-mail / WhatsApp dans la fenêtre promo ; le navigateur n'envoie que le code du Live | harnais (C) + `inviteChatPromo` (C) |
| **J** Session invité expirée protégée | cookie expiré / révoqué → 401 → aucune demande envoyée, message clair, réidentification proposée (SEUL cas) ; serveur : jeton expiré, falsifié, autre audience, autre Live → refus ; aucune usurpation (identité = `sub` signé, jamais un e-mail du front) ; le jeton invité n'ouvre aucune route d'hôte | harnais (C) + `test_live_promo_invite.py` (C) + Afroboost `tests/test_live_guest_jeton_promo.py` (C) |
| **K** « Échanger en visio » (IA) | mode de l'assistant qui dépend d'une transcription vocale INEXISTANTE → choix désactivé, « Transcription vocale bientôt disponible », l'IA ne bascule plus seule en « visio » (`VISIO_IA_DISPONIBLE = false`) ; la visio de l'invité (caméra/micro) n'est pas concernée | harnais (C, clic) + `inviteChatPromo`, `assistantHote` (C) |
| Commentaires | masquer / afficher | harnais (C) |
| Questions | « ? » (ou une vraie question, 05/10) → la question (et elle seule, jamais « Super séance, merci ! ») entre dans la file du prompteur de l'hôte | harnais (C) + `prompteurUnique` (C) |
| Prompteur | texte affiché ; Lecture (décompte 3-2-1) ; entrée hôte | harnais (C) + `prompteurUnique`, `prompteurSources` |
| Assistant IA — question → suggestion | une question PERTINENTE du chat (bouton « ? » ou vraie question) → bloc « Suggestion IA » dans le prompteur de l'**hôte** seul ; **Utiliser** → réponse dans « Mon texte » (écran inchangé) ; **Ignorer** → supprimée ; jamais par-dessus une proposition en attente ; l'IA n'écrit JAMAIS dans le chat | harnais (C, clics) + `assistantPrompteurIA` (C) + `liveContract` (C/S) |
| Assistant IA — coût | bonjour / merci / emoji / réaction / test du son = **aucun** appel ; même `message_id` = **un seul** appel (re-rendu, double réception, rechargement : mémoire de session ; serveur : réponse resservie, appel en vol refusé) ; debounce 1,5 s ; 6 s entre deux appels + 10 / 5 min (client) ; 2 s + 20 / 5 min par hôte et par Live (serveur) ; contexte = la question + 4 messages | `assistantPrompteurIA` (C) + `test_souffleur_hote.py` (C) |
| Assistant IA — sécurité et panne | identité = jeton serveur (le corps ne compte pas) ; sans jeton / invité sans compte 401, participant 403, aucun appel ; IA lente (12 s serveur, 15 s client), en erreur ou absente → `ok:false`, jamais un 500, le Live continue | `test_souffleur_hote.py` (C) + `assistantPrompteurIA` (C) |
| Caméra 1080p / 1440p / 4K | capturée à la hauteur annoncée ; 4K **publiée** 3840×2160 et **reçue** 3840×2160 en plein écran 4K | harnais + banc LiveKit (C) |
| Sélecteur / changement de caméra | entrées hôte cliquées ; 2 caméras : même piste publiée (même trackSid), nouvelle caméra à SA résolution, débits recalculés (8 → 5 Mbit/s en 4K → 1440p), spectateur jamais noir | harnais + banc LiveKit (C) |
| Beauté OFF | aucun processeur : piste brute, pleine résolution | harnais (C, vrai hook + vrai bouton) |
| Beauté ON | sortie = résolution de la source (1080p, 1440p, 4K ; jamais 720×406), couleur conservée, non noire ; publiée | harnais + banc LiveKit (C) |
| Look vidéo — sélection | « Look vidéo » : hôte seul (menu ⋮), jamais chez un participant ; 6 looks (Original, Noir & blanc, Cinéma chaud, Cinéma froid, Teal & Orange, Contraste doux) cliqués | harnais (C) |
| Look vidéo — rendu | le VRAI shader sur une mire : Original = identité (écart 0), Noir & blanc = R=G=B, les autres = formule de référence `appliquerLook` à ≤ 2/255 | harnais (C, pixel par pixel) + `liveContract` (C) |
| Look vidéo — publié et reçu | l'hôte clique le vrai sélecteur : Noir & blanc **reçu** R=G=B par le spectateur ; Teal & Orange reçu en couleur ; Original + beauté OFF = processeur retiré (piste brute) | banc LiveKit (C) |
| Look vidéo — pleine résolution, fluidité | chaque look en 1080p / 1440p / 4K, beauté OFF et ON : sortie = résolution de la source (jamais de palier), ≥ 90 % des i/s de la source et ≥ 15 i/s ; coût GPU 4K synchronisé ≤ 33 ms ; 4K **publiée** avec look | harnais + banc LiveKit (C) |
| Look vidéo — sans coupure | changer de look = même piste (même trackSid), aucune image noire (chaque image mesurée) ; survit à beauté ON→OFF et au changement de caméra | harnais + banc LiveKit (C) |
| Simulcast | 3 couches q/h/f ; couche 4K à 8 Mbit/s (aucun plafond) | banc LiveKit (C) |
| adaptiveStream | vignette → petite couche reçue ; plein écran → couche haute | banc LiveKit (C) |
| Dynacast | couches que personne ne regarde coupées chez l'hôte | banc LiveKit (C) |
| Mobile | jamais forcé en 4K (720p LiveKit) | `liveContract`, `cameraNative` (C) |
| Audio | AEC + NS + AGC **réellement actifs** sur la piste du micro ; gains à 1 | harnais (C, `getSettings()`) + `voixLive` |
| Mute / unmute | bouton de la barre → gestionnaire ; vrai micro : on → off (piste libérée) | harnais (C) |
| Caméra coupée / rallumée | le spectateur voit `muted` puis `unmuted`, l'image revient | banc LiveKit (C) |
| Reconnexion | coupure complète simulée chez le spectateur → reconnecté, image revenue | banc LiveKit (C) |
| Aucun écran noir | chaque image mesurée : luminance et variation > seuil (locale, publiée, reçue) | harnais + banc (C) |
| Aucun 500 | pages publiques (`--prod`) ; préférences : un échec de stockage est journalisé, jamais un faux succès | `--prod` (C) + `pytest` (C) |

## Architecture à connaître avant de toucher

- **Pipeline vidéo publié** : caméra → `BeauteProcessor` (WebGL, `lib/beaute/rendu.ts`) = embellissement **puis** look (`lib/looksVideo.ts`), une seule passe, pleine résolution → piste LiveKit. Original + beauté coupée = **aucun** traitement (piste brute). Look seul : toujours à la résolution de la source, aucun palier ; s'il ne suit pas → coupure vers la piste brute pleine résolution + avis visible. Les paliers 3840 → 1920 → 1280 ne concernent que l'embellissement, et sont désormais signalés à l'hôte (`palier`).
- **Look vidéo** : réglage mémorisé sur l'appareil de l'hôte (`localStorage` `bt_look`, comme `bt_beaute`), pas encore dans `/coach/preferences-live`. Future LUT `.cube` : interface `Lut3D` / `ParametresLook.lut` documentée en tête de `lib/looksVideo.ts` (import non construit).
- **Room** : `OPTIONS_ROOM_LIVE` (`lib/qualiteVideo.ts`) — la même constante sert au hook et au contrat. Changement de caméra : `restartTrack` puis `ajusterDebitsCouches`.
- **Préférences du coach** (serveur) : `profiles.live_preferences` = emplacement principal, écriture **relue** ; si `profiles` refuse (colonne ou ligne absente), secours `app_metadata.live_preferences` (API admin, serveur seul). Lecture : le plus récent (`maj`) gagne. `sessions_reglees` = Lives réglés à la main (30 derniers), jamais écrasés. À l'ouverture d'un Live, l'hôte appelle `POST /coach/preferences-live/appliquer` : le **serveur** décide.
- **Assistant IA du prompteur** : `prompteurSources.ts` (filtre `estBruit` / `ressembleAQuestion` / `estQuestionPertinente`, `recevoirSuggestionAuto`) → `assistantHote.ts` (`questionAPreparer`, `decisionAuto`, `creerDebounce`, `avecDelai`) → effet de `SessionPage` (hôte seul) → `POST /live/assistant/suggestions` (OpenAI `OPENAI_SOUFFLEUR_MODEL`, défaut `gpt-4o-mini` ; clé = base chiffrée ou `OPENAI_API_KEY`).
- **Invité identifié (05/10)** : `inviteLiveIdentifie` (lib/liveChat) = Live Afroboost, pas hôte, pas de compte, pseudo saisi, écran d'identité refermé. Chat : `droitChatLive` (envoi ET réception). Promo : la page enregistre `creerFournisseurJetonInvite(sessionId)` (lib/inviteLive) → `POST afroboost.com/api/live-guest/jeton` (cookie HttpOnly `afb_live_guest`, corps = code du Live seul) → jeton HS256 10 min (secret partagé `AFRO_BT_SHARED_SECRET`, `aud=boosttribe-live-guest`, `sub` = id de l'invité, pseudo, session_code ; jamais d'e-mail/WhatsApp) → en-tête `X-Live-Guest` sur les SEULES routes participant (`requests`, `mine`, `media`, `pay`) → `_lp_participant` (backend) ; `participant_id` = uuid5 stable de l'invité. Un compte connecté prime toujours.
- **Transcription orale en direct** : n'existe pas (seul l'ENREGISTREMENT est transcrit après coup, `gpt-4o-transcribe`). `recevoirTranscription` (prompteurSources) est l'entrée prête : un segment TEXTE → même filtre, même file, même déduplication, même suggestion. Brancher un moteur speech-to-text = décision de Bassi (coût).
