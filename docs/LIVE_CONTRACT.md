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
| Faire la promo | participant connecté : item → fenêtre → `POST /live-promo/requests` ; invité sans compte : item → « Se connecter » ; hôte : jamais (il a « Promotions live ») ; promo fermée : absent | harnais (C) + `liveContract` (C/S) + `test_live_promo*.py` (C) |
| Promotions live (hôte) | entrée hôte cliquée ; réglages repris au prochain Live | harnais (C) + `test_preferences_live.py` (C) |
| Chat | message saisi → bulle affichée ; anti-flood | harnais (C) + `liveChat`, `liveChatUi` |
| Commentaires | masquer / afficher | harnais (C) |
| Questions | « ? » → la question (et elle seule) entre dans la file du prompteur de l'hôte | harnais (C) + `prompteurUnique` (C) |
| Prompteur | texte affiché ; Lecture (décompte 3-2-1) ; entrée hôte | harnais (C) + `prompteurUnique`, `prompteurSources` |
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
