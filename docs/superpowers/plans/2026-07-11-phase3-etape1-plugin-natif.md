# Phase 3 — Étape 1 : Plugin natif AudioSession + pont web (ZÉRO impact web)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer un plugin Capacitor natif Android `AudioSession` (Kotlin) qui force `AudioManager.MODE_NORMAL` + focus média quand un micro est ouvert, et un pont web `nativeAudio.ts` no-op hors natif, câblé aux points d'ouverture micro (hôte + participant) — sans changer le comportement web.

**Architecture:** Le plugin Kotlin vit dans `frontend/android/`, enregistré dans `MainActivity`. Le wrapper TS `frontend/src/lib/nativeAudio.ts` appelle le plugin uniquement si `Capacitor.isNativePlatform()`, sinon no-op. `SessionPage` appelle `setAudioMode('music')` à l'activation micro hôte et à la prise de parole participant. En navigateur : tous les appels sont des no-op ⇒ comportement identique.

**Tech Stack:** Capacitor 7, Kotlin (Android), TypeScript/React (Vite). Android : AGP 8.7.2, compileSdk 35, minSdk 23, Java 21.

## Global Constraints

- **ZÉRO régression web/mobile/visio/iOS.** Ne pas casser : synchro musique (`HOST_COMMAND`/`applyRemoteState`, `#bt-music-audio`), PeerJS/TURN, LiveKit, VAD/auto-pause, lecture iOS écran verrouillé, login (`server.url`).
- **Le natif est ADDITIF.** Le web reste rétro-compatible : hors Capacitor, tout appel natif est un no-op.
- **Aucun test runner JS dans le repo** (scripts : `dev`/`start`/`build`/`preview`). Ne PAS en ajouter (hors périmètre). Gate web = `cd frontend && CI=false yarn build` VERT. Gate natif = build Android Studio + test appareil (actions de l'utilisateur ; l'agent ne peut ni builder l'APK ni tester le device ici).
- **Vite sort dans `build/`** (pas `dist/`). Ne pas redéployer le site dans ces commits (déploiement Coolify = action manuelle utilisateur, `z259immwps6qtzp6eyij4coc`, Force deploy without cache).
- **Ne pas déclencher de dialogues natifs** ; `try/catch` silencieux partout côté pont.
- appId natif = `pro.boosttribe.app`. Nom du plugin JS = `"AudioSession"` (doit être identique côté Kotlin `@CapacitorPlugin(name = "AudioSession")` et côté TS `registerPlugin('AudioSession')`).

---

## File Structure

**Créés :**
- `frontend/android/app/src/main/java/pro/boosttribe/app/audio/AudioSessionPlugin.kt` — plugin natif (setMode / activate / deactivate / setSpeakerphoneOn / isHeadsetConnected).
- `frontend/src/lib/nativeAudio.ts` — pont web, no-op hors natif.

**Modifiés :**
- `frontend/android/build.gradle` — classpath du plugin Gradle Kotlin.
- `frontend/android/app/build.gradle` — `apply plugin: 'kotlin-android'`.
- `frontend/android/app/src/main/java/pro/boosttribe/app/MainActivity.java` — `registerPlugin(AudioSessionPlugin.class)`.
- `frontend/src/pages/SessionPage.tsx` — appels `setAudioMode('music')` / `deactivate()` à l'ouverture/fermeture micro (hôte + participant).

---

## Task 1 : Activer Kotlin dans le projet Gradle Android

**Files:**
- Modify: `frontend/android/build.gradle:9-11` (buildscript dependencies)
- Modify: `frontend/android/app/build.gradle:1` (apply plugins)

**Interfaces:**
- Consumes: rien.
- Produces: toolchain Kotlin disponible pour Task 2 (compilation des `.kt`).

- [ ] **Step 1 : Ajouter le classpath Kotlin dans le build.gradle racine**

Dans `frontend/android/build.gradle`, bloc `buildscript { dependencies { ... } }`, ajouter la ligne classpath Kotlin (version figée pour éviter la dépendance à l'ordre de `apply from: variables.gradle`) :

```gradle
    dependencies {
        classpath 'com.android.tools.build:gradle:8.7.2'
        classpath 'com.google.gms:google-services:4.4.2'
        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25'

        // NOTE: Do not place your application dependencies here; they belong
        // in the individual module build.gradle files
    }
```

- [ ] **Step 2 : Appliquer le plugin kotlin-android dans app/build.gradle**

Dans `frontend/android/app/build.gradle`, tout en haut, ajouter `apply plugin: 'kotlin-android'` juste après la ligne existante :

```gradle
apply plugin: 'com.android.application'
apply plugin: 'kotlin-android'
```

(Le plugin Kotlin 1.9 ajoute automatiquement `kotlin-stdlib` — pas de dépendance stdlib explicite à ajouter. `jvmTarget` hérite des `compileOptions` fournies par `capacitor.build.gradle`.)

- [ ] **Step 3 : Vérifier (agent) que rien de web n'a bougé**

Run: `cd /Users/afroboost/Boosttribe-v8 && git status --short frontend/src && echo "(vide = OK)"`
Expected: aucune sortie (aucun fichier `src/` touché).

- [ ] **Step 4 : Commit**

```bash
cd /Users/afroboost/Boosttribe-v8
git add frontend/android/build.gradle frontend/android/app/build.gradle
git commit -m "chore(android): active le toolchain Kotlin (natif uniquement, zéro impact web)"
```

> **Validation build (action utilisateur, non bloquante pour la suite du code) :** ouvrir `frontend/android/` dans Android Studio → Gradle Sync doit réussir. L'agent ne peut pas builder (pas de SDK Android ici).

---

## Task 2 : Plugin natif `AudioSessionPlugin.kt` + enregistrement

**Files:**
- Create: `frontend/android/app/src/main/java/pro/boosttribe/app/audio/AudioSessionPlugin.kt`
- Modify: `frontend/android/app/src/main/java/pro/boosttribe/app/MainActivity.java` (entièrement remplacé)

**Interfaces:**
- Consumes: toolchain Kotlin (Task 1).
- Produces: plugin JS nommé `"AudioSession"` avec méthodes `setMode({mode})`, `activate()`, `deactivate()`, `setSpeakerphoneOn({on})`, `isHeadsetConnected() → {connected: boolean}`. Consommé par Task 3.

- [ ] **Step 1 : Créer le plugin Kotlin**

Créer `frontend/android/app/src/main/java/pro/boosttribe/app/audio/AudioSessionPlugin.kt` :

```kotlin
package pro.boosttribe.app.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Plugin natif : empêche Android de forcer le mode "communication" quand un micro WebRTC est ouvert.
 * En mode média (MODE_NORMAL + focus USAGE_MEDIA/CONTENT_TYPE_MUSIC), la musique reste en qualité HiFi
 * même micro ouvert → on peut parler par-dessus la musique proprement (au casque).
 */
@CapacitorPlugin(name = "AudioSession")
class AudioSessionPlugin : Plugin() {

    private val audioManager: AudioManager
        get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var focusRequest: AudioFocusRequest? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    @PluginMethod
    fun setMode(call: PluginCall) {
        when (call.getString("mode") ?: "music") {
            "voice" -> applyVoiceMode()
            else -> {
                applyMediaMode()
                // WebRTC (WebView) repositionne parfois le mode APRÈS getUserMedia → réassert MODE_NORMAL.
                mainHandler.postDelayed({ forceNormalMode() }, 300)
                mainHandler.postDelayed({ forceNormalMode() }, 1000)
            }
        }
        call.resolve()
    }

    private fun applyMediaMode() {
        val am = audioManager
        requestMediaFocus(am)
        am.mode = AudioManager.MODE_NORMAL
        am.isSpeakerphoneOn = false // route média/HP (jamais le mode communication)
    }

    private fun applyVoiceMode() {
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    }

    private fun forceNormalMode() {
        val am = audioManager
        if (am.mode != AudioManager.MODE_NORMAL) am.mode = AudioManager.MODE_NORMAL
    }

    private fun requestMediaFocus(am: AudioManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setWillPauseWhenDucked(false)
                .build()
            focusRequest = req
            am.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
    }

    @PluginMethod
    fun activate(call: PluginCall) {
        val am = audioManager
        requestMediaFocus(am)
        am.mode = AudioManager.MODE_NORMAL
        call.resolve()
    }

    @PluginMethod
    fun deactivate(call: PluginCall) {
        val am = audioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { am.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(null)
        }
        focusRequest = null
        call.resolve()
    }

    @PluginMethod
    fun setSpeakerphoneOn(call: PluginCall) {
        audioManager.isSpeakerphoneOn = call.getBoolean("on", false) ?: false
        call.resolve()
    }

    @PluginMethod
    fun isHeadsetConnected(call: PluginCall) {
        val ret = JSObject()
        ret.put("connected", headsetConnected())
        call.resolve(ret)
    }

    private fun headsetConnected(): Boolean {
        val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        for (d in devices) {
            when (d.type) {
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_USB_HEADSET,
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> return true
            }
        }
        return false
    }
}
```

- [ ] **Step 2 : Enregistrer le plugin dans MainActivity**

Remplacer intégralement `frontend/android/app/src/main/java/pro/boosttribe/app/MainActivity.java` par :

```java
package pro.boosttribe.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import pro.boosttribe.app.audio.AudioSessionPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AudioSessionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

- [ ] **Step 3 : Vérifier (agent) qu'aucun fichier web n'a bougé**

Run: `cd /Users/afroboost/Boosttribe-v8 && git status --short frontend/src && echo "(vide = OK)"`
Expected: aucune sortie.

- [ ] **Step 4 : Commit**

```bash
cd /Users/afroboost/Boosttribe-v8
git add frontend/android/app/src/main/java/pro/boosttribe/app/audio/AudioSessionPlugin.kt \
        frontend/android/app/src/main/java/pro/boosttribe/app/MainActivity.java
git commit -m "feat(android): plugin natif AudioSession (MODE_NORMAL + focus média, détection casque)"
```

> **Validation build (action utilisateur) :** Android Studio → Build. Le `.kt` doit compiler et `MainActivity` enregistrer le plugin. (Pas de SDK ici pour builder.)

---

## Task 3 : Pont web `nativeAudio.ts` (no-op hors natif)

**Files:**
- Create: `frontend/src/lib/nativeAudio.ts`

**Interfaces:**
- Consumes: plugin `"AudioSession"` (Task 2) via `@capacitor/core`.
- Produces (signatures exactes, importées par Task 4) :
  - `isNativeAudio(): boolean`
  - `type NativeAudioMode = 'music' | 'voice' | 'simultaneous'`
  - `setAudioMode(mode: NativeAudioMode): Promise<void>`
  - `activateAudioSession(): Promise<void>`
  - `deactivateAudioSession(): Promise<void>`
  - `nativeHeadsetConnected(): Promise<boolean | null>` (null = inconnu/web)
  - `setSpeakerphone(on: boolean): Promise<void>`

- [ ] **Step 1 : Créer le wrapper**

Créer `frontend/src/lib/nativeAudio.ts` :

```ts
import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Pont vers le plugin natif Android `AudioSession` (Phase 3).
 * HORS Capacitor (navigateur web), TOUT est un no-op → comportement web strictement identique.
 */
export type NativeAudioMode = 'music' | 'voice' | 'simultaneous';

interface AudioSessionPlugin {
  setMode(options: { mode: NativeAudioMode }): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  setSpeakerphoneOn(options: { on: boolean }): Promise<void>;
  isHeadsetConnected(): Promise<{ connected: boolean }>;
}

const AudioSession = registerPlugin<AudioSessionPlugin>('AudioSession');

export function isNativeAudio(): boolean {
  return Capacitor.isNativePlatform();
}

export async function setAudioMode(mode: NativeAudioMode): Promise<void> {
  if (!isNativeAudio()) return;
  try { await AudioSession.setMode({ mode }); } catch { /* no-op */ }
}

export async function activateAudioSession(): Promise<void> {
  if (!isNativeAudio()) return;
  try { await AudioSession.activate(); } catch { /* no-op */ }
}

export async function deactivateAudioSession(): Promise<void> {
  if (!isNativeAudio()) return;
  try { await AudioSession.deactivate(); } catch { /* no-op */ }
}

export async function nativeHeadsetConnected(): Promise<boolean | null> {
  if (!isNativeAudio()) return null;
  try { return (await AudioSession.isHeadsetConnected()).connected; } catch { return null; }
}

export async function setSpeakerphone(on: boolean): Promise<void> {
  if (!isNativeAudio()) return;
  try { await AudioSession.setSpeakerphoneOn({ on }); } catch { /* no-op */ }
}
```

- [ ] **Step 2 : Vérifier le build web (gate de non-régression)**

Run: `cd /Users/afroboost/Boosttribe-v8/frontend && CI=false yarn build 2>&1 | tail -8`
Expected: `✓ built in ...` (build vert). Confirme que l'import `@capacitor/core` se bundle sans erreur et que `build/` est produit.

- [ ] **Step 3 : Commit**

```bash
cd /Users/afroboost/Boosttribe-v8
git add frontend/src/lib/nativeAudio.ts
git commit -m "feat(audio): pont web nativeAudio (no-op hors natif) vers le plugin AudioSession"
```

---

## Task 4 : Câbler `setAudioMode` à l'ouverture micro (hôte + participant)

**Files:**
- Modify: `frontend/src/pages/SessionPage.tsx` (import + effet micro hôte ~1105-1124 + `handleToggleTalk` ~1155-1169)

**Interfaces:**
- Consumes: `setAudioMode`, `deactivateAudioSession` de `@/lib/nativeAudio` (Task 3).
- Produces: rien (feuille de l'arbre d'appel).

- [ ] **Step 1 : Importer le pont**

Ajouter en haut de `frontend/src/pages/SessionPage.tsx`, avec les autres imports `@/lib/...` :

```ts
import { setAudioMode, deactivateAudioSession } from '@/lib/nativeAudio';
```

- [ ] **Step 2 : Appel à l'activation/désactivation du micro HÔTE**

Dans l'effet `useEffect` du micro hôte (branche `if (hostMicStream) { ... } else { ... }`), ajouter l'appel natif. La branche active, juste après `broadcastAudio(micBroadcastStream);` :

```ts
      broadcastAudio(micBroadcastStream); // mémorise le flux, diffuse aux participants connectés
      // 📱 Natif Android : force le mode média (MODE_NORMAL) → la musique reste HiFi micro ouvert. No-op web.
      setAudioMode('music');
      // 🎙️ Micro diffusé en continu. En mode VOIX, la VAD décide de l'auto-pause ; en MANUEL, l'hôte pilote.
      if (micMode === 'voice') startVoiceActivity(handleSpeechStart, handleSpeechEnd);
```

Et dans la branche `else` (micro coupé), juste après `setManualMusicPaused(false);` :

```ts
      setManualMusicPaused(false);
      deactivateAudioSession(); // 📱 abandonne le focus audio natif. No-op web.
```

- [ ] **Step 3 : Appel à la prise/rendu de parole PARTICIPANT**

Dans `handleToggleTalk`, dans la branche « prendre la parole » (après `setIsTalking(true); showToast('Vous avez la parole', 'success');`) :

```ts
      const ok = await participantMic.startCapture();
      if (ok) {
        setIsTalking(true);
        showToast('Vous avez la parole', 'success');
        setAudioMode('music'); // 📱 Natif : parler par-dessus la musique sans dégradation. No-op web.
      }
```

Et dans la branche « rendre la parole » (après `resumeMixerContextSoon();`) :

```ts
      resumeMixerContextSoon(); // 🎵 réveille son contexte musique local (la synchro hôte gère play/pause)
      deactivateAudioSession();  // 📱 abandonne le focus audio natif. No-op web.
```

- [ ] **Step 4 : Vérifier le build web (gate de non-régression)**

Run: `cd /Users/afroboost/Boosttribe-v8/frontend && CI=false yarn build 2>&1 | tail -8`
Expected: `✓ built in ...` (build vert).

- [ ] **Step 5 : Vérifier (agent) que le diff `src/` se limite au strict nécessaire**

Run: `cd /Users/afroboost/Boosttribe-v8 && git diff --stat frontend/src`
Expected: seul `frontend/src/pages/SessionPage.tsx` modifié (import + 4 petits ajouts), et `frontend/src/lib/nativeAudio.ts` déjà committé en Task 3.

- [ ] **Step 6 : Commit**

```bash
cd /Users/afroboost/Boosttribe-v8
git add frontend/src/pages/SessionPage.tsx
git commit -m "feat(audio): applique le mode audio natif à l'ouverture micro (hôte + participant), no-op web"
```

---

## Validation finale de l'Étape 1 (actions utilisateur)

1. **Web (non-régression)** : déployer `build/` sur Coolify `z259immwps6qtzp6eyij4coc` (**Force deploy without cache**). Vérifier en navigateur que TOUT marche comme avant (musique, voix, VAD, visio, login). Aucun changement de comportement attendu.
2. **Natif** : ouvrir `frontend/android/` dans Android Studio → `npx cap sync android` (depuis `frontend/`) → Run sur le Samsung SM-S928B.
3. **Test appareil (le cœur de l'étape)** : rejoindre une session, lancer la musique, ouvrir le micro (hôte) **au casque**. Attendu : la musique **ne baisse plus de qualité** micro ouvert ; on peut parler par-dessus proprement. Refaire côté participant qui prend la parole. Comparer AVANT/APRÈS.
4. Si le mode se fait re-repositionner par WebRTC (musique qui redégrade après ~1 s), augmenter/ajouter des réasserts dans `setMode` (timers) — itératif.

**Une fois l'Étape 1 validée sur appareil**, on écrit le plan de l'**Étape 2** (sélecteur segmenté 3 modes + mode SIMULTANÉ + synchro).

---

## Self-Review (couverture spec Étape 1)

- Partie A (plugin natif : setMode/isHeadsetConnected/activate/deactivate/setSpeakerphoneOn, réassert post-getUserMedia) → Task 2. ✅
- Partie B (pont no-op hors natif, appels à l'ouverture/fermeture micro) → Tasks 3-4. ✅
- Contrainte « zéro impact web » → appels no-op via `isNativeAudio()`, gate `yarn build`, vérif `git status src/`. ✅
- `isHeadsetConnected` produit ici est **consommé à l'Étape 4** (bandeau casque) — défini dès maintenant pour éviter un aller-retour. ✅
- Parties C/D/E/F/G → hors Étape 1 (plans dédiés ultérieurs). Documenté.
- Pas de placeholder ; code complet à chaque étape ; chemins exacts ; noms de méthodes cohérents Kotlin↔TS (`AudioSession`, `setMode`, `isHeadsetConnected`, `activate`, `deactivate`, `setSpeakerphoneOn`).
