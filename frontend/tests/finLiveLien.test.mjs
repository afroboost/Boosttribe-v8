/**
 * 🔴 V571 — le lien d'invitation appartient au LIVE : seul « Terminer le Live » le rend mort.
 * (Côté Afroboost : la croix n'envoie plus de fin, et l'hôte qui revient reçoit SON code.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const P = codeSeul(lire('pages', 'SessionPage.tsx'));
const API = codeSeul(lire('lib', 'paymentApi.ts'));

test('Terminer (hôte) pose la marque de fin côté serveur, dans la séquence existante', () => {
  const t = P.slice(P.indexOf('const terminerLive = useCallback'), P.indexOf('const quitterLeLive'));
  assert.match(t, /if \(sessionId && isHost\) void terminerLiveServeur\(sessionId\);/);
  assert.ok(t.indexOf('terminerLiveServeur') < t.indexOf('EVENEMENT_LIVE_TERMINE'), 'avant de prévenir les participants');
});

test('aucune marque de fin sur fermeture / rechargement (pagehide, beforeunload, démontage)', () => {
  const appels = P.split('terminerLiveServeur(').length - 1;
  assert.equal(appels, 1, 'un seul appel : celui de terminerLive');
});

test('participant qui ouvre un lien terminé → écran « Le Live est terminé »', () => {
  assert.match(P, /liveEstTermine\(sessionId\)\.then\(\(termine\) => \{ if \(termine && !annule\) \{ setLiveTermine\(true\); setLiveMode\(false\); \} \}\);/);
  assert.match(P, /if \(!sessionId \|\| !privacyChecked \|\| isHost\) return undefined;/);
});

test('API : le doute ne termine jamais un live', () => {
  const f = API.slice(API.indexOf('export async function liveEstTermine'), API.indexOf('export async function setCohosts'));
  assert.match(f, /return data\?\.termine === true;/);
  assert.match(f, /catch \{ return false; \}/);
});

/* ═══ V571b — « Quitter le live » = départ TEMPORAIRE (décision Bassi 05/10) ═══ */
import { sequenceDepartTemporaire, sequenceFinDuLive } from './.build/finDuLive.mjs';

const TOUT = { enregistrementEnCours: true, partageEcranActif: true, cameraActive: true, microActif: true, estHote: true };

test('1. hôte → Quitter : tout est coupé chez lui, il sort, mais RIEN de définitif', () => {
  const s = sequenceDepartTemporaire(TOUT);
  assert.deepEqual(s, ['finaliser-enregistrement', 'couper-camera', 'couper-ecran', 'couper-micro', 'quitter-room', 'annoncer-fin']);
  assert.ok(!s.includes('prevenir-participants'), 'aucun « Le Live est terminé » aux participants (ni marque live_ended_at)');
  assert.ok(!s.includes('retour-ecran'), 'pas d’écran « terminé » chez l’hôte');
});

test('2. hôte → Terminer : séquence définitive inchangée (prévient, marque, écran de fin)', () => {
  const s = sequenceFinDuLive(TOUT);
  assert.ok(s.includes('prevenir-participants') && s.includes('retour-ecran'));
});

test('Quitter (hôte) passe par la séquence temporaire ; Terminer par la définitive', () => {
  const t = P.slice(P.indexOf('const terminerLive = useCallback'), P.indexOf('const quitterLeLive'));
  assert.match(t, /const definitif = motif !== 'host_leave';/);
  assert.match(t, /const etapes = \(definitif \? sequenceFinDuLive : sequenceDepartTemporaire\)\(\{/);
  assert.match(t, /if \(definitif\) livePromo\.arreterSiActive\('fin_live'\);/);
  const q = P.slice(P.indexOf('const quitterLeLive = useCallback'), P.indexOf('const quitterLeLive = useCallback') + 400);
  assert.match(q, /if \(!isHost\) \{ setLiveMode\(false\); return; \}/);          // 3 + 4 : participant / co-hôte inchangés
  assert.match(q, /void terminerLive\('host_leave'\);/);
  assert.doesNotMatch(q, /Terminer le Live pour tout le monde/);
});
