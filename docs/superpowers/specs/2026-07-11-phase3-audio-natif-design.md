# Phase 3 — Audio natif : musique + voix simultanées, mixeur par personne, 3 modes, vidéo, bandeau casque

> Statut : **conception, en attente de validation**. Aucune ligne de code produite avant approbation.
> Date : 2026-07-11. Cible : `afroboost/Boosttribe-v8`, front `frontend/` (React/Vite), natif `frontend/android/` (Capacitor 7).

## 0. Décisions adoptées (CONFIRMÉES par l'utilisateur — feu vert 2026-07-11)

1. **Livraison = par étapes sûres.** Le natif charge le site LIVE (`server.url = https://boosttribe.pro`), donc tout changement web part en prod dès le déploiement Coolify. On livre en 4 étapes indépendantes, chacune rétro-compatible web, non-régression validée à chaque étape.
2. **SIMULTANÉ = hôte ET participants.** Le correctif natif s'applique sur l'appareil de quiconque ouvre son micro. Sur navigateur web, best-effort (sans garantie).
3. **Mixeur = curseurs SÉPARÉS Musique ET Vidéo** (indépendants, PAS adaptatif) + curseurs voix existants + **nouveau curseur « Timer/Bips »**. Chaque source a son volume propre, réglage local par personne. ⇒ nouvel état `videoVolume` distinct de `musicVolume`, qui pilote `mediaVolume` de `SharedMediaPlayer`.
4. **Sélecteur de modes = vrai contrôle segmenté à 3 boutons visibles** (Auto-stop / Pause-parole / Simultané), pas un badge ni un double-clic.

## 1. Contexte — architecture existante (à NE PAS casser)

Quatre graphes audio indépendants, volontairement non croisés :

| Graphe | Fichier | Rôle | Sortie |
|---|---|---|---|
| **Mixeur Web Audio** | `hooks/useAudioMixer.ts` | musique, traitement micro hôte, gains tribu/voix-hôte, **sons du timer** | HP (`master → limiteur → destination`) + tap enregistrement (`musicTapDest`) |
| **Voix PeerJS/WebRTC** | `hooks/usePeerAudio.ts` | voix (micro → MediaStreamDestination du mixeur → appels PeerJS) ; **3ᵉ AudioContext** avec gains par-peer | ses propres HP |
| **Vidéo LiveKit** | `hooks/useLiveKitStage.ts` | caméras + partage écran, **vidéo seule** (jamais l'audio) | — |
| **Média partagé** | `components/session/SharedMediaPlayer.tsx` | vidéo uploadée / YouTube / Vimeo ; audio **dans l'élément HTML/iframe**, jamais dans le mixeur ni WebRTC | élément média, volume = `mixerState.musicVolume` |

**Realtime :** canal Supabase `playback:${sessionId}`, évènements `HOST_COMMAND` (PLAY/PAUSE/SEEK/STATE), `VIDEO_SYNC`, `TIMER`. Point d'application participant = `applyRemoteState()` (SessionPage) — **à ne pas toucher**.

**Ce qui existe déjà et couvre une partie du cahier des charges :**
- **Mixeur par personne (Partie C)** : `AudioMixerPanel` affiche déjà — Musique (adaptatif→Vidéo), Mon Micro (hôte), Volume Tribu (hôte), curseurs par-participant (hôte : `remoteMicSliders` → `setTribeUserVolume`/`setTribeUserMuted` ; participant : Volume Hôte `setHostVoiceVolume` + « Voix des participants » relais `setRemoteMicVolume`). Gains par-userId déjà indexés (`tribeUserVolumeRef`, `tribeUserMutedRef`, `relayVolumesRef`, `hostVoiceVolumeRef`). Boost >100 % supporté (Web Audio GainNode, plafond 250 %).
- **Modes (Partie D)** : 2 modes host-local `micMode: 'voice'|'manual'` (`SessionPage:637`, `localStorage bt_mic_mode`), bascule double-clic + badge dans `MicrophoneControl`. Auto-pause via `micHold` ref-compté → pause/reprise musique + média, synchronisé par `HOST_COMMAND`/`VIDEO_SYNC`.
- **Pause/reprise vidéo (Partie G)** : `sharedMediaPlayerRef.pauseSharedMedia()/resumeSharedMedia()` déjà pilotés par `micHold`.
- **Sons timer** : passent déjà par `getTimerOutput()` (GainNode additif → master + recTap) sur PC/Android ; **locaux par client, synchronisés par timestamp** (`TIMER` START/startedAt) — audibles chez tous, indépendants de la vidéo.
- **Makeup gain micro (Partie E)** : hôte `micGain` 0–250 % ; participant `initialVolume:150` ; AEC/AGC/NS = `false` (anti-ducking) ; limiteur brickwall présent.
- **VAD** : isolé dans `useAudioMixer` (`startVoiceActivity`/`stopVoiceActivity`), micro dans son **propre AudioContext** (anti-ducking), analyser en dérivation (ne touche pas la diffusion).

**Ce qui manque (à créer) :** plugin natif Kotlin `AudioSession` + pont `nativeAudio.ts` (A/B) ; 3ᵉ mode SIMULTANÉ + sa synchro (D) ; curseur « Timer/Bips » + persistance locale (C) ; bandeau casque (F).

## 2. Livraison par étapes (chaque étape = déployable, rétro-compatible, testée)

### Étape 1 — Plugin natif + pont (ZÉRO impact web) — commits `plugin natif` + `pont web`
- **Kotlin** `frontend/android/app/src/main/java/pro/boosttribe/app/audio/AudioSessionPlugin.kt`, enregistré dans `MainActivity`.
- **Wrapper** `frontend/src/lib/nativeAudio.ts` : no-op hors natif (`Capacitor.isNativePlatform()`).
- Câblage minimal dans `SessionPage` : appel `setAudioMode(...)` à l'ouverture/fermeture du micro (hôte ET participant) et à l'init — **no-op sur navigateur** ⇒ comportement web strictement identique.
- Introduit l'import `@capacitor/core` dans le bundle (sûr en navigateur : `isNativePlatform()===false`).

### Étape 2 — 3ᵉ mode SIMULTANÉ + synchro — commit `3 modes`
### Étape 3 — Mixeur : curseur « Timer/Bips » + persistance locale — commit `mixeur`
### Étape 4 — Bandeau casque + vérif volume micro — commits `bandeau` + (ajustements `vidéo`)

Ordre choisi pour que l'étape 1 ne change RIEN au web, puis chaque étape web soit petite et validable isolément.

## 3. Spécifications détaillées

### Partie A — Plugin natif Kotlin `AudioSession`
Méthodes exposées au JS :
- `setMode({ mode: 'music' | 'voice' | 'simultaneous' })`
  - `music`/`simultaneous` → `AudioManager.mode = MODE_NORMAL` (jamais `MODE_IN_COMMUNICATION`), demande de **focus audio** `AudioAttributes` usage `USAGE_MEDIA` + `CONTENT_TYPE_MUSIC`, routage HP/média. But : empêcher la dégradation « communication » ⇒ musique en qualité média micro ouvert.
  - `voice` → réglages voix classiques (mode full-voix optionnel).
  - **Réassert** : WebRTC en WebView peut repositionner le mode après `getUserMedia`. Ré-appliquer `MODE_NORMAL` sur un court timer (ex. 300 ms + 1 s) après l'appel.
- `isHeadsetConnected()` → `bool` : `AudioManager.getDevices(GET_DEVICES_OUTPUTS)` types filaire (`TYPE_WIRED_HEADPHONES/HEADSET`, `TYPE_USB_HEADSET`) OU Bluetooth (`TYPE_BLUETOOTH_A2DP/SCO`), fallback `isWiredHeadsetOn`.
- `activate()` / `deactivate()` → prise/abandon du focus audio.
- `setSpeakerphoneOn(bool)` (optionnel).

**Critère A :** en SIMULTANÉ, micro ouvert, au casque : voix + musique propres en même temps, musique qui ne baisse plus de qualité. **Itératif — validation obligatoire sur l'appareil (Samsung SM-S928B).**

### Partie B — Pont web `nativeAudio.ts`
```ts
import { Capacitor, registerPlugin } from '@capacitor/core';
interface AudioSessionPlugin {
  setMode(o: { mode: 'music'|'voice'|'simultaneous' }): Promise<void>;
  isHeadsetConnected(): Promise<{ connected: boolean }>;
  activate(): Promise<void>; deactivate(): Promise<void>;
  setSpeakerphoneOn(o: { on: boolean }): Promise<void>;
}
const AudioSession = registerPlugin<AudioSessionPlugin>('AudioSession');
export const isNativeAudio = () => Capacitor.isNativePlatform();
export async function setAudioMode(mode){ if(!isNativeAudio()) return; try{ await AudioSession.setMode({mode}); }catch{} }
export async function nativeHeadsetConnected(){ if(!isNativeAudio()) return null; try{ return (await AudioSession.isHeadsetConnected()).connected; }catch{ return null; } }
// activate/deactivate/setSpeakerphoneOn idem, no-op hors natif.
```
Appels côté `SessionPage` : `setAudioMode(nativeModeFor(micMode))` à l'activation micro (hôte + participant), au changement de mode, et `activate()` à l'entrée en session live. Tout est **no-op** en navigateur.

Mapping mode appli → natif : `simultaneous` → `'simultaneous'` ; `voice`/`manual` → `'music'` (musique en qualité média dès qu'un micro est ouvert, même si elle sera mise en pause en VAD/manuel).

### Partie D — Sélecteur 3 modes (contrôle segmenté)
- Étendre `micMode` → `'voice' | 'manual' | 'simultaneous'` (`SessionPage`, `localStorage bt_mic_mode`).
- **Nouveau composant `SessionModeSelector`** : contrôle segmenté à **3 boutons visibles** — `Auto-stop` / `Pause-parole` / `Simultané` — bouton actif surligné. **Hôte** : cliquable (change le mode). **Participant** : lecture seule (affiche le mode courant de l'hôte). Remplace le double-clic/badge ; `MicrophoneControl` est simplifié (micro on/off + mute uniquement, on retire les props `mode`/`onToggleMode` et le badge).
- Comportements :
  - **AUTO-STOP** (`voice`) = VAD existant (parole → pause musique/vidéo, reprise au silence).
  - **PAUSE-PAROLE** (`manual`) = toggle manuel existant.
  - **SIMULTANÉ** (`simultaneous`) = **ne PAS armer le VAD**, **ne PAS mettre la musique/vidéo en pause** (aucun `micHold` déclenché), `setAudioMode('simultaneous')` + boost micro (voir E). Musique + voix cohabitent proprement (natif ; web = best-effort).
- **Synchro** : l'hôte diffuse le mode via un **NOUVEL évènement** sur le canal `playback:${sessionId}` (ex. `SESSION_MODE` `{ mode }`), traité **séparément** de `HOST_COMMAND`/`applyRemoteState` (aucune modification de ces derniers). Les participants : stockent `hostMode`, affichent le badge (lecture seule), et appellent `setAudioMode(...)` sur leur appareil. Re-émission dans le heartbeat existant pour les arrivants tardifs.

### Partie C — Mixeur par personne (surtout de l'ajout)
Déjà en place : curseur Musique/Vidéo (adaptatif), Mon Micro (hôte), Volume Tribu (hôte), par-participant (hôte + participant), Volume Hôte (participant). **Ajouts :**
- **Séparer Musique et Vidéo** (décision 3) : nouvel état `videoVolume` (0–1, défaut 1.0), **indépendant** de `musicVolume`. Comme l'audio de la vidéo vit dans l'élément HTML/iframe (hors Web Audio), `videoVolume` est un simple nombre — pas de GainNode. Il pilote `mediaVolume` de `SharedMediaPlayer` (à la place de `mixerState.musicVolume`). Dans `AudioMixerPanel` : garder le curseur **« Musique »** (toujours), ajouter un curseur **« Vidéo »** affiché quand une vidéo est partagée (`isVideoShared`). Retirer le comportement « le curseur Musique devient Vidéo ».
- **Curseur « Timer/Bips »** : rendre `getTimerOutput()` réglable. Ajouter `timerVolume` à l'état de `useAudioMixer` + `setTimerVolume(v)` (applique `timerOutputRef.gain`). Nouveau `MixerSlider` dans `AudioMixerPanel` (hôte ET participant), 0–100 %, défaut 100 %.
- **Persistance locale par utilisateur** : sauver dans `localStorage` (clés `bt_mixer_*`) au minimum musique, vidéo, tribu, voix-hôte, timer ; restaurer à l'init de la session. Maps par-userId : best-effort si l'userId est stable.
- **NE PAS recâbler le graphe Web Audio** : réutiliser les nœuds de gain existants ; le seul « recâblage » est de brancher `mediaVolume` sur `videoVolume` au lieu de `musicVolume`.

### Partie E — Volume micro (hôte + participant)
- Vérifier/relever le makeup gain sortant : hôte via `useAudioMixer.setMicVolume` / `micGain` ; participant via `useMicrophone` (`initialVolume`). En SIMULTANÉ, garantir un niveau micro suffisant pour passer au-dessus de la musique (ex. plancher `micVolume ≥ 1.6`), **sans saturer** (limiteur brickwall déjà présent). But : fin du « micro trop bas ».

### Partie F — Bandeau discret « casque »
- Nouveau composant `HeadsetHint` (petit bandeau refermable, non bloquant). Affiché **uniquement** quand mode `simultaneous` actif **et** aucun casque détecté :
  - natif : `nativeHeadsetConnected()` (re-check au changement de mode + périodiquement / sur évènement device).
  - web : affiché dès que `simultaneous` est choisi.
- Texte : « 🎧 Pour un son parfait en mode “parler + musique en même temps”, mets un casque. Sur haut-parleur, le micro peut capter la musique (léger écho) — la qualité reste bonne, mais le casque est idéal. »
- Refermable (croix) ; réapparaît si on repasse en SIMULTANÉ sans casque.

### Partie G — Même système pour la vidéo partagée
- AUTO-STOP / PAUSE-PAROLE : pause/reprise déjà câblées (`micHold` → `pauseSharedMedia/resumeSharedMedia`).
- SIMULTANÉ : aucun `micHold` déclenché ⇒ la vidéo n'est pas mise en pause ; son son reste propre pendant la parole ; volume réglable via le curseur **« Vidéo »** dédié (`videoVolume`).
- Sons du timer : déjà mixés via `getTimerOutput()` (→ master), **indépendants de l'élément vidéo** ⇒ audibles et propres pendant le partage vidéo ; jamais coupés. Curseur dédié (Partie C).

## 4. Gestion des erreurs / garde-fous
- `nativeAudio.ts` : tout `try/catch`, no-op silencieux hors natif ⇒ jamais d'exception côté web.
- Nouvel évènement `SESSION_MODE` isolé ⇒ `applyRemoteState`/`HOST_COMMAND` intacts.
- VAD non armé en SIMULTANÉ ⇒ pas de `micHold` ⇒ musique/vidéo non pausées.
- iOS : chemins existants inchangés (musique hors Web Audio, voix hôte hors Web Audio, beeps WAV) — le natif ne concerne qu'Android.
- Import `@capacitor/core` : vérifier que le build web reste vert et le bundle fonctionnel en navigateur (`isNativePlatform()===false`).

## 5. Tests & déploiement (frontière des responsabilités)
**Ce que je fais (Claude) :** implémentation, `CI=false yarn build` vert à chaque étape, vérif non-régression statique (aucun `src/` cassé, types), commits séparés.
**Ce que TU fais :** déploiement Coolify (`z259immwps6qtzp6eyij4coc`, **Force deploy without cache**) — manuel ; ouverture `frontend/android/` dans Android Studio + Run sur l'appareil ; `git push origin main` (compte `sambassi`). Je ne peux ni déployer Coolify, ni tester sur appareil, ni pousser à ta place.

**Tests obligatoires (2 appareils, au CASQUE puis au HAUT-PARLEUR) :**
1. SIMULTANÉ, musique en cours, l'hôte parle → musique HiFi + voix claire des deux côtés.
2. Mixeur : hôte et participant montent/baissent chaque source (musique, voix, vidéo, timer) → effet local immédiat.
3. Volume micro hôte + participant correct.
4. AUTO-STOP et PAUSE-PAROLE comme avant (non-régression).
5. Vidéo partagée : idem sur les 3 modes.
6. Bandeau casque : apparaît en SIMULTANÉ sans casque, disparaît avec casque, refermable.
7. Non-régression : synchro musique (`HOST_COMMAND`), PeerJS/TURN, caméras LiveKit, login, lecture iOS écran verrouillé.

## 6. Critères de succès
- SIMULTANÉ (au casque) : musique HiFi + voix claire en même temps, plus de baisse de qualité.
- Volume micro correct (hôte + participant).
- Mixeur fonctionnel hôte ET participant (chaque source réglable localement), curseur « Timer/Bips » ajouté.
- 3 modes sélectionnables + synchronisés ; vidéo partagée alignée.
- Sons Interval Training mixés, audibles chez tous, de bonne qualité, y compris pendant le partage vidéo.
- Bandeau casque discret et pertinent.
- Zéro régression web/mobile/visio/iOS.

## 7. Points ouverts (mineurs — à caler au test, non bloquants)
1. Persistance mixeur : périmètre exact des maps par-participant (userId stable ?) — best-effort.
2. En SIMULTANÉ, boost micro auto (plancher ~1.6) — valeur à ajuster au test sur appareil.
3. Position UI du sélecteur segmenté et du curseur « Vidéo » dans le panneau — à ajuster visuellement.

**Décisions §0 : toutes CONFIRMÉES (feu vert utilisateur).**
