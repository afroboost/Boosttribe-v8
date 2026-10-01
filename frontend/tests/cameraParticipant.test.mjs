// 🎥 Participant : « Activer ma caméra » = la demande de scène EXISTANTE (aucun droit de publier donné ici).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const P = src('components/session/LiveVisioPanel.tsx');
const bloc = P.slice(P.indexOf('const actionCameraMoi = '), P.indexOf('// Rendu d\'une vignette cliquable'));

test('visible seulement pour SOI, spectateur, caméra éteinte', () => {
  assert.match(bloc, /if \(p\.id !== myUserId \|\| canManageStage \|\| cameraOn \|\| !onRequestStage\) return null;/);
});

test('clic = onRequestStage existant ; en attente = « En attente de l’hôte »', () => {
  assert.match(bloc, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onRequestStage\(\); \}\}/);
  assert.match(bloc, /stageRequestPending \? \(/);
  assert.match(bloc, /En attente de l’hôte/);
  assert.match(bloc, /data-testid="visio-moi-activer-camera"/);
  assert.doesNotMatch(bloc, /startCamera|promote|canPublish|livekit/i);                 // aucun droit donné ici
});

test('sur SA vignette partout : vue normale (tileFor), grande vue, vignette flottante', () => {
  assert.match(P, /const tileFor = \(p: VisioParticipant, large = false\) => \(p\.id === myUserId && actionCameraMoi\(p\)\)/);
  assert.match(P, /actionCameraMoi\(fsBig\)/);
  assert.match(P, /\{actionCameraMoi\(p\)\}\s*<\/VignetteFlottante>/);
  assert.match(P, /data-vignette-bouton>/);                                              // un clic ne déclenche pas le glisser
});

test('flux existant inchangé : STAGE_ACCEPT démarre la caméra, STAGE_REFUSE dit « Demande refusée », limite 10', () => {
  const s = src('pages/SessionPage.tsx');
  assert.match(s, /event: 'STAGE_ACCEPT' \}[\s\S]{0,400}startCameraRef\.current\?\.\(true\)/);
  assert.match(s, /event: 'STAGE_REFUSE' \}[\s\S]{0,300}Demande refusée/);
  assert.match(s, /if \(res === 'stage_full'\) \{ showToast\('Scène pleine \(10 max\)', 'warning'\); return; \}/);
  // une fois à l'écran, la caméra se coupe par le bouton EXISTANT de la barre
  assert.match(src('components/session/LiveControls.tsx'), /if \(onToggleCamera && \(canManageStage \|\| cameraOn\)\) candidats\.push\('camera'\);/);
});
