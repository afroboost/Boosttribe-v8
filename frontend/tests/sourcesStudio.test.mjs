/**
 * 🎛️ Phase 1 Sources + transcription fidèle — bancs STRUCTURELS (lecture des sources).
 *
 * Ce qui ne s'isole pas dans `node --test` (LiveKit, getUserMedia, Web Audio) se LIT dans le code :
 *  - le hook LiveKit applique la règle des sources et ne jette pas sans caméra ;
 *  - la caméra principale reste LiveKit ; les secondaires ne sont JAMAIS publiées ;
 *  - le micro secondaire passe par le mixeur existant (même limiteur, même destination) ;
 *  - le tiroir Sources est fermé par défaut et n'affiche aucun terme technique ;
 *  - la transcription est le texte du moteur : aucune passe LLM, aucun résumé automatique.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lire, codeSeul } from './lireSource.mjs';

const HOOK_LK = codeSeul(lire('hooks', 'useLiveKitStage.ts'));
const HOOK_CAMS = codeSeul(lire('hooks', 'useSecondaryCameras.ts'));
const HOOK_MIC2 = codeSeul(lire('hooks', 'useSecondaryMic.ts'));
const MIXER = codeSeul(lire('hooks', 'useAudioMixer.ts'));
const DRAWER = lire('components', 'session', 'SourcesDrawer.tsx');
const PANEL = codeSeul(lire('components', 'session', 'LiveVisioPanel.tsx'));
const SESSION = codeSeul(lire('pages', 'SessionPage.tsx'));
const MICCTRL = codeSeul(lire('components', 'audio', 'MicrophoneControl.tsx'));
const BACKEND = fs.readFileSync(path.join(process.cwd(), '..', 'backend', 'main.py'), 'utf8');

/* ═══════════════ CAMÉRA PRINCIPALE — règle des sources dans le hook LiveKit ═══════════════ */

test('le hook LiveKit choisit la caméra par la règle pure (externe choisie → appareil → aucune)', () => {
  assert.ok(HOOK_LK.includes("from '@/lib/sourcesLogic'"), 'la logique pure est importée, pas dupliquée');
  assert.ok(HOOK_LK.includes('choisirCameraPrincipale(cams, wanted)'));
  assert.ok(HOOK_LK.includes('decisionDebranchement('), 'le débranchement est décidé par la règle');
  assert.ok(HOOK_LK.includes('cibleBascule(devs,'), 'Avant ↔ Arrière passe par la règle');
});

test('sans caméra : le live continue en audio, avec un avis discret (jamais une exception)', () => {
  assert.ok(HOOK_LK.includes("setCameraNotice('aucune-camera')"));
  assert.ok(HOOK_LK.includes("setCameraNotice('retour-interne')"), 'externe débranchée → retour à l’appareil');
  assert.ok(HOOK_LK.includes("setCameraNotice('camera-perdue')"), 'plus aucune caméra → audio');
  assert.ok(/cameraNotice,\s*\n\s*effacerCameraNotice,/.test(HOOK_LK.slice(HOOK_LK.lastIndexOf('return {'))), 'l’avis est exposé au panneau');
});

test('débranchement : fin de piste ET devicechange déclenchent la bascule automatique', () => {
  assert.ok(HOOK_LK.includes("mst.addEventListener('ended', onEnded"), 'la fin de piste est surveillée');
  assert.ok(HOOK_LK.includes('surveillerFinDePiste(mst)'), 'sur la première publication et sur chaque changement');
  assert.ok(HOOK_LK.includes('if (debranchee) basculeAutoRef.current?.(retour);'), 'devicechange recalcule et bascule');
});

test('la caméra principale reste LiveKit ; switchActiveDevice sans reconnexion inchangé', () => {
  assert.ok(HOOK_LK.includes("room.switchActiveDevice('videoinput', deviceId)"));
  assert.ok(HOOK_LK.includes('room.localParticipant.setCameraEnabled(true'));
  assert.ok(!HOOK_LK.includes('setMicrophoneEnabled'), 'l’audio reste hors LiveKit (PeerJS inchangé)');
});

/* ═══════════════ CAMÉRAS SECONDAIRES — locales, jamais publiées ═══════════════ */

test('les caméras secondaires ne sont JAMAIS publiées et restent Chromium desktop', () => {
  assert.ok(HOOK_CAMS.includes('multiCamPossible(navigator.userAgent'), 'garde ordinateur Chromium');
  assert.ok(HOOK_CAMS.includes('navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false })'), 'un flux indépendant par caméra');
  assert.ok(!HOOK_CAMS.includes('publishTrack') && !HOOK_CAMS.includes('livekit'), 'aucune publication');
  assert.ok(HOOK_CAMS.includes("etat: 'indisponible'"), 'un échec devient un état, pas une exception');
  assert.ok(HOOK_CAMS.includes("t.addEventListener('ended', () => retirer(deviceId)"), 'débranchée → retirée seule');
});

/* ═══════════════ MICRO — mixeur réutilisé ═══════════════ */

test('le micro secondaire se branche sur la chaîne EXISTANTE du mixeur (même limiteur, même destination)', () => {
  assert.ok(MIXER.includes('connectSecondaryMic'), 'fonction dans le mixeur');
  assert.ok(MIXER.includes('g.connect(limiter);'), 'gain propre → limiteur du micro principal');
  assert.ok(MIXER.includes('micLimiterRef.current = micLimiter;'), 'le limiteur existant est mémorisé, pas recréé');
  assert.ok(!MIXER.includes('createMediaStreamDestination();\n        mic2'), 'aucune deuxième destination de diffusion');
  assert.ok(HOOK_MIC2.includes('echoCancellation: false, noiseSuppression: false, autoGainControl: false'), 'mêmes contraintes que le micro principal');
  assert.ok(HOOK_MIC2.includes('connectSecondaryMic(stream, gain)'));
});

test('le micro principal reste le contrôle existant : sélection via son handle, pas un second getUserMedia', () => {
  assert.ok(MICCTRL.includes('selectDevice: (deviceId: string) => setDevice(deviceId)'));
  assert.ok(MICCTRL.includes('onDevicesChange?.(state.devices, state.deviceId)'));
  assert.ok(SESSION.includes('hostMicCtrlRef.current?.selectDevice(id)'));
  assert.ok(SESSION.includes('onDevicesChange={handleMicDevicesChange}'));
});

/* ═══════════════ UI SOURCES — épurée, sans jargon ═══════════════ */

test('tiroir fermé = rien de visible ; ouvert = CAMÉRA puis AUDIO ; aucun terme technique', () => {
  assert.ok(DRAWER.includes('if (!ouvert) return null;'));
  assert.ok(DRAWER.includes('data-testid="sources-camera"') && DRAWER.includes('data-testid="sources-audio"'));
  assert.ok(DRAWER.includes('Ajouter une caméra') && DRAWER.includes('Ajouter un micro'));
  // Texte RENDU = ce qui est entre deux balises sans expression JS ; les props/le code sont exclus.
  const visible = (DRAWER.match(/>([^<>{}();=]*)</g) || []).map((m) => m.slice(1, -1).trim()).filter(Boolean).join(' | ');
  assert.ok(visible.includes('Ajouter une caméra'), 'le texte rendu est bien capturé');
  assert.doesNotMatch(visible, /deviceId|facingMode|\benvironment\b|getUserMedia|\buser\b/i, 'aucun jargon rendu à l’écran');
  assert.ok(DRAWER.includes("from 'lucide-react'"), 'même famille d’icônes SVG');
  assert.doesNotMatch(codeSeul(DRAWER), /[\u{1F300}-\u{1FAFF}]/u, 'aucun emoji dans le code rendu');
  assert.ok(DRAWER.includes('var(--bt-accent)'), 'l’état actif prend la couleur de marque');
  // Dédoublonnage (17/09) : le tiroir consomme les listes pures, jamais `videoDevices` brut ligne par ligne.
  assert.ok(DRAWER.includes('camerasAffichables(videoDevices, { mobile })') && DRAWER.includes('microsAffichables(micDevices)'), 'listes dédupliquées');
  assert.ok(!DRAWER.includes('Branche un micro puis rafraîchis') && !DRAWER.includes('Branche une caméra (USB'), 'plus de bloc « Branche… » ouvert sans candidat');
  assert.ok(DRAWER.includes('peutAjouterMicro') && DRAWER.includes('peutAjouterCamera'), '« Ajouter » n’apparaît que s’il y a un candidat');
});

test('le panneau monte le tiroir et affiche l avis caméra ; la page le renseigne', () => {
  assert.ok(PANEL.includes('<SourcesDrawer'));
  assert.ok(PANEL.includes('data-testid="visio-camera-notice"'));
  assert.ok(SESSION.includes('sources={canShare ? sourcesProps : undefined}'));
  assert.ok(SESSION.includes('cameraNotice={videoMesh.cameraNotice}'));
  assert.ok(SESSION.includes('useSecondaryCameras()') && SESSION.includes('useSecondaryMic('));
});

/* ═══════════════ TRANSCRIPTION FIDÈLE — TRANSCRIPTION ≠ RÉSUMÉ ═══════════════ */

test('le parcours Live Visio n appelle plus la passe LLM : le texte du moteur EST la transcription', () => {
  const idx = BACKEND.indexOf('async def session_record_upload') > 0 ? BACKEND.indexOf('async def session_record_upload') : BACKEND.indexOf('raw = await _openai_transcribe(');
  const route = BACKEND.slice(idx, BACKEND.indexOf('@app.get("/session/recordings")'));
  assert.ok(!route.includes('await _openai_refine('), 'aucune reformulation / résumé automatique');
  assert.ok(route.includes('patch = {"status": "done", "transcript": raw, "summary": ""}'), 'summary vide, transcript = raw');
});

test('le moteur reçoit le vocabulaire Afroboost en contexte et une température 0', () => {
  assert.ok(BACKEND.includes('"temperature": "0"'));
  assert.ok(BACKEND.includes('data["prompt"] = ctx[:900]'));
  for (const mot of ['Afroboost', 'Afroboosteur', 'Bassi', 'cardio', 'afrobeat', 'casque audio', 'Pulse', 'Fondateurs', 'Freedom', 'Flex', 'Neuchâtel', 'Auvernier']) {
    assert.ok(BACKEND.includes(mot), `vocabulaire : ${mot}`);
  }
});

test('nettoyage minimal : une phrase par ligne, une répétition technique ×3 retirée, rien de réécrit', () => {
  assert.ok(BACKEND.includes('def _nettoyer_transcription('));
  assert.ok(BACKEND.includes('if len(propres) >= 2 and propres[-1] == p and propres[-2] == p:'));
});

test('l écran ne promet plus de résumé', () => {
  assert.ok(!SESSION.includes("et un résumé pour l'organisateur"));
  assert.ok(SESSION.includes('texte fidèle de ce qui a été dit'));
});
