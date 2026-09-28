/**
 * Live — 3 défauts visuels (28/09) : en-tête sur la barre en plein écran de repli,
 * Play évincé de la colonne en panneau compact, (rectangle clair : voir plus bas).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { repartirCommandes, ESPACE_COLONNE, zoneLibrePleinEcran } from './.build/liveControls.mjs';
import { lire, codeSeul } from './lireSource.mjs';

// ── Play toujours dans la colonne (cas prod : panneau compact 284 px + partage + caméra + média)
const HOTE = ['terminer', 'camera', 'micro', 'lecture', 'partage', 'record', 'prompteur', 'demandes', 'diffusion'];

test('colonne 284 px : Terminer, Caméra, Micro, Play restent ; le reste descend dans ⋮', () => {
  const r = repartirCommandes(HOTE, 284, {}, ESPACE_COLONNE);
  assert.ok(r.barre.includes('lecture'), `Play évincé : ${r.barre}`);
  for (const c of ['terminer', 'camera', 'micro']) assert.ok(r.barre.includes(c), c);
  assert.deepEqual([...r.barre, ...r.menu].sort(), [...HOTE].sort(), 'aucune fonction perdue');
});

test('enregistrement / partage EN COURS : prioritaires, mais JAMAIS devant Play', () => {
  const r = repartirCommandes(HOTE, 284, {}, ESPACE_COLONNE, ['record', 'partage']);
  assert.ok(r.barre.includes('lecture'));
  const r2 = repartirCommandes(HOTE, 340, {}, ESPACE_COLONNE, ['record']); // 5 places
  assert.ok(r2.barre.includes('lecture') && r2.barre.includes('record'), String(r2.barre));
});

test('sans média, Play ne prend aucune place : le partage monte dans la colonne', () => {
  const r = repartirCommandes(HOTE.filter((c) => c !== 'lecture'), 284, {}, ESPACE_COLONNE);
  assert.ok(r.barre.includes('partage'), String(r.barre));
});

// ── En-tête : en plein écran de REPLI (API refusée), la scène commence SOUS l'en-tête
test('zoneLibrePleinEcran : repli sous l’en-tête, natif = tout l’écran', () => {
  assert.deepEqual(zoneLibrePleinEcran({ viewportH: 575, enteteBas: 65, natif: false }), { haut: 65, hauteur: 510 });
  assert.deepEqual(zoneLibrePleinEcran({ viewportH: 575, enteteBas: 65, natif: true }), { haut: 0, hauteur: 575 });
  assert.deepEqual(zoneLibrePleinEcran({ viewportH: 575, enteteBas: 0, natif: false }), { haut: 0, hauteur: 575 });
  assert.deepEqual(zoneLibrePleinEcran({ viewportH: 575, enteteBas: 9999, natif: false }), { haut: 575, hauteur: 0 });
});

const PANNEAU = codeSeul(lire('components', 'session', 'LiveVisioPanel.tsx'));
const HOOK = codeSeul(lire('hooks', 'useFullscreen.ts'));
const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));

test('le repli CSS ne couvre plus l’en-tête : top = bas réel de l’en-tête (pas un z-index)', () => {
  assert.match(HOOK, /natif/, 'useFullscreen expose natif');
  assert.match(PAGE, /<header[^>]*data-bt-entete/, 'l’en-tête de la page est repérable');
  assert.match(PANNEAU, /zoneLibrePleinEcran\(/);
  assert.match(PANNEAU, /\[data-bt-entete\]/);
  assert.doesNotMatch(PANNEAU, /'fixed inset-0 z-\[100\]/, 'plus de inset-0 aveugle en repli');
});

test('LiveControls transmet les commandes ACTIVES à la répartition', () => {
  const LC = codeSeul(lire('components', 'session', 'LiveControls.tsx'));
  assert.match(LC, /repartirCommandes\([\s\S]{0,260}actives/);
});

// ── Rectangle clair bas-gauche (prouvé par bascule au banc) : le « voile » dégradé de
//    LiveChatOverlay était une boîte 22rem × 38 % à bords FRANCS, rendue même sans message.
//    La lisibilité vient du textShadow + du fond arrondi de chaque bulle.
test('le chat du Live n’a plus de voile rectangulaire (aucun fond hors des bulles)', () => {
  const OVERLAY = codeSeul(lire('components', 'session', 'LiveChatOverlay.tsx'));
  assert.doesNotMatch(OVERLAY, /bg-gradient-to-|from-black\//, 'voile dégradé');
  assert.doesNotMatch(OVERLAY, /absolute inset-0[^"']*bg-/, 'boîte de fond pleine taille');
});

// ── 4) Messages du chat : UNE pile centrée — messages juste au-dessus du champ, même axe.
//    Avant : chat ancré à gauche (chatLargeurMax, rangée justify-between) + champ centré.
test('chat : même conteneur centré que le champ (inputLargeurMax), juste au-dessus', () => {
  assert.match(PANNEAU, /data-testid="visio-calque-chat"[^>]*|visio-calque-chat/);
  const bloc = PANNEAU.slice(PANNEAU.indexOf('data-testid="visio-calques-bas"'));
  const iChat = bloc.indexOf('data-testid="visio-calque-chat"');
  const iInput = bloc.indexOf('data-testid="visio-calque-input"');
  const iThumbs = bloc.indexOf('data-testid="visio-fs-thumbs"');
  assert.ok(iChat > 0 && iInput > iChat, 'chat avant le champ');
  assert.ok(iThumbs < 0 || iThumbs < iChat, 'aucune vignette entre les messages et le champ');
  const chatTag = bloc.slice(bloc.lastIndexOf('<div', iChat), iChat);
  assert.match(chatTag, /maxWidth: zone\.inputLargeurMax/, 'même largeur que le champ');
  assert.match(chatTag, /self-center|mx-auto/, 'centré comme le champ');
  assert.doesNotMatch(chatTag, /bg-|backdrop-/, 'aucun fond de bloc (pas de rectangle)');
});
