/**
 * Intégration de la refonte UX Live (28/09) dans SessionPage : ce que la page DOIT brancher
 * pour que « vidéo au centre + chat transparent + likes + une barre + un Prompteur » tienne.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));
const HOOK = codeSeul(lire('hooks', 'useLiveReactions.ts'));

test('pendant le Live, la grande carte de chat n est plus montée (sauf vidéo partagée agrandie)', () => {
  assert.ok(PAGE.includes('const chatPanelNode = (sessionId && !isGuestRestricted && (!liveMode || videoEnlarged)) ?'));
});

test('chat, champ commentaire et réactions sont passés AU panneau vidéo', () => {
  for (const m of ['chatOverlayNode={liveChatOverlayNode}', 'commentInputNode={liveCommentInputNode}',
    'reactionsNode={liveReactionsNode}', 'commentairesMasques={commentairesMasques}']) {
    assert.ok(PAGE.includes(m), m);
  }
});

test('une question = un signal CLAIR, jamais « tout message »', () => {
  // 05/10 : le message sortant est construit par lib/liveChat (messageChatSortant), le drapeau y passe tel quel.
  assert.ok(PAGE.includes('question: !!opts?.question'));
  assert.ok(lire('lib', 'liveChat.ts').includes('...(p.question ? { question: true } : {})'));
  assert.ok(PAGE.includes('recevoirMessages(e, groupMessages, socket.userId)'));
  assert.ok(!PAGE.includes('recevoirQuestion(e, {'), 'plus de mise en file de chaque message');
});

test('réactions : écoutées sur le canal existant, jamais en base', () => {
  assert.ok(PAGE.includes("event: EVT_REACTIONS"));
  assert.ok(PAGE.includes("event: EVT_TOTAL"));
  assert.ok(!/from\('session_likes'\)[\s\S]{0,200}EVT_REACTIONS/.test(PAGE));
});

test('la grille ne montre que les personnes à l écran', () => {
  assert.ok(PAGE.includes('videoMesh.remoteCameras.some((c) => c.userId === p.id)'));
});

test('la forme mobile du Prompteur suit le redimensionnement', () => {
  assert.ok(PAGE.includes('const studioMobile = !isDesktop;'));
  assert.ok(!PAGE.includes("window.matchMedia('(max-width: 1023px)').matches"));
});

test('mouvement réduit : un clic local ne crée jamais plus d une bulle', () => {
  assert.ok(/if \(reducedRef\.current\) \{\s*setBulles\(\(prev\) => \(prev\.length \? prev :/.test(HOOK));
});
