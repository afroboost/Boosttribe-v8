/**
 * Observabilité (28/09, fin de live inexpliquée à 12:06) : chaque `bt:session-ended`
 * émis par l'iframe porte un MOTIF, pour qu'Afroboost puisse dire qui a terminé et pourquoi.
 * Instrumentation seulement : aucune étape de la fin du live ne change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const EMBED = codeSeul(lire('lib', 'embedApi.ts'));
const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));

test('le message de fin transporte un motif', () => {
  assert.ok(/export type MotifFin = 'host_terminate' \| 'host_leave' \| 'page_unmount' \| 'consume_refused'/.test(EMBED));
  assert.ok(EMBED.includes("postToParent({ type: 'bt:session-ended', jti, session_code: String(contexte.sessionCode || ''), is_host: !!contexte.isHost, reason: contexte.reason || 'unknown' })"));
  assert.ok(EMBED.includes("postToParent({ type: 'bt:session-ended', jti, ...detail, reason: 'consume_refused' })"));
});

test('Terminer = host_terminate, Quitter hôte = host_leave, démontage = page_unmount', () => {
  assert.ok(PAGE.includes("onTerminerLive={() => { void terminerLive('host_terminate'); }}"));
  assert.ok(PAGE.includes("void terminerLive('host_leave');"));
  assert.ok(PAGE.includes("else if (etape === 'annoncer-fin') annoncerFinRef.current(motif);"));
  assert.ok(PAGE.includes("notifyEmbedSessionEnded({ sessionCode: sessionId || '', isHost: true, reason: motif });"));
  assert.ok(PAGE.includes("isHost: !!embedContexteRef.current.isHost, reason: 'page_unmount' })"));
});

test('les étapes de la fin du live sont inchangées (même séquence pure)', () => {
  assert.ok(PAGE.includes('const etapes = (definitif ? sequenceFinDuLive : sequenceDepartTemporaire)({'));
  for (const e of ["'finaliser-enregistrement'", "'prevenir-participants'", "'couper-camera'", "'quitter-room'", "'annoncer-fin'", "'retour-ecran'"]) {
    assert.ok(PAGE.includes(e), e);
  }
});
