/**
 * 💓 LE SIGNE DE VIE DE L'HÔTE — structurel, sur le code réel.
 *
 * Quatre départs produisent un événement navigateur et éteignent le live en moins
 * d'une seconde. Le cinquième, non : la connexion tombe, l'onglet reste ouvert,
 * rien ne se produit — et le live restait public TROIS HEURES. Ce banc garde les
 * trois propriétés qui font que le battement vaut quelque chose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const API = codeSeul(lire('lib', 'embedApi.ts'));
const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));

test('le battement est annoncé à 15 s — la valeur vit à UN seul endroit', () => {
  assert.ok(/export const BATTEMENT_HOTE_MS = 15000;/.test(API));
  assert.ok(PAGE.includes('BATTEMENT_HOTE_MS'), 'la page réutilise la constante, elle ne la recopie pas');
  assert.ok(!/setInterval\([^,]+,\s*15000\)/.test(PAGE), 'aucun 15000 écrit en dur dans la page');
});

test('on ne bat QU’APRÈS avoir annoncé le début — sinon le battement tombe dans le vide', () => {
  // `notifyEmbedSessionStarted` est asynchrone (elle attend le débit du crédit).
  // Sans ce drapeau, le premier battement partait avant que la session existe.
  assert.ok(API.includes('let _liveAnnonce = false;'));
  const bloc = API.slice(API.indexOf('export function notifyEmbedHeartbeat'));
  assert.ok(/if \(!token \|\| !_liveAnnonce/.test(bloc), 'le battement est gardé par le drapeau');
  const fin = API.slice(API.indexOf('export function notifyEmbedSessionEnded'), API.indexOf('BATTEMENT_HOTE_MS'));
  assert.ok(fin.includes('_liveAnnonce = false;'), 'une fin annoncée arrête les battements');
});

test('seul l’HÔTE bat, et seulement en mode intégré', () => {
  const bloc = API.slice(API.indexOf('export function notifyEmbedHeartbeat'));
  assert.ok(bloc.includes('!contexte.isHost'), 'un participant ne bat jamais');
  assert.ok(bloc.includes('!contexte.sessionCode'), 'aucun battement sans session');
  assert.ok(bloc.includes('getStored(TOKEN_KEY)'), 'hors mode intégré, rien ne part');
});

test('le battement ne transporte rien de plus que l’annonce de début', () => {
  const bloc = API.slice(API.indexOf('export function notifyEmbedHeartbeat'));
  const debut = bloc.indexOf('postToParent(');
  const message = bloc.slice(debut, bloc.indexOf('});', debut));
  ['type', 'jti', 'session_code', 'is_host'].forEach((c) => assert.ok(message.includes(c), `champ manquant : ${c}`));
  // Le prompteur, le chat et le texte de l'hôte ne sortent JAMAIS du navigateur.
  // `\b` compte : `contexte.sessionCode` contient « texte » sans être du contenu.
  assert.ok(!/\btexte\b|\bscript\b|prompteur|chatMessage|suggestion/i.test(message),
    `contenu de session dans le message : ${message}`);
});

test('l’intervalle est bien nettoyé — pas de battement fantôme après le départ', () => {
  const i = PAGE.indexOf('const t = setInterval(battre, BATTEMENT_HOTE_MS);');
  assert.ok(i > 0, 'le battement est bien posé sur un intervalle');
  assert.ok(PAGE.slice(i, i + 160).includes('clearInterval(t)'), 'et il est retiré au démontage');
});

test('un spectateur ne monte même pas le battement', () => {
  const i = PAGE.indexOf('const battre = ()');
  const avant = PAGE.slice(Math.max(0, i - 260), i);
  assert.ok(/if \(!isHost\) return;/.test(avant), 'l’effet sort tout de suite pour un non-hôte');
});
