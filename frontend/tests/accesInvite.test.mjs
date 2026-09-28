/**
 * Accès invité gratuit (audit 28/09) : « Privée » = entrée gratuite par lien ; les DROITS
 * des invités (écoute / visio) sont un réglage séparé. Correctifs :
 *  A. passer en « Gratuit par lien » sélectionne « Accès visio » par défaut ;
 *  B. un choix manuel (« Écoute uniquement ») est respecté ;
 *  C/D. la modale travaille en BROUILLON : rien n'est écrit avant « Enregistrer »,
 *       « Annuler » n'écrit rien ;
 *  save : mode + access_mode puis RELECTURE — jamais de faux succès ;
 *  E. PromoPage : mode « private » = gratuit même si un ancien lien de paiement existe ;
 *  F. PromoPage lit `mode` (même source que /session/info) — backend testé à part.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { droitsApresChoixEntree, promoPayante, sauvegardeConfirmee } from './.build/accesSession.mjs';
import { lire, codeSeul } from './lireSource.mjs';

test('A. ouverte → privée, sans choix manuel : Accès visio (account) par défaut', () => {
  assert.equal(droitsApresChoixEntree({ ancien: 'open', nouveau: 'private', droits: 'guest', choixManuel: false }), 'account');
  assert.equal(droitsApresChoixEntree({ ancien: 'paid', nouveau: 'private', droits: 'guest', choixManuel: false }), 'account');
});

test('B. un choix manuel est respecté ; rester en privée ne réécrase rien ; autres modes inchangés', () => {
  assert.equal(droitsApresChoixEntree({ ancien: 'open', nouveau: 'private', droits: 'guest', choixManuel: true }), 'guest');
  assert.equal(droitsApresChoixEntree({ ancien: 'private', nouveau: 'private', droits: 'guest', choixManuel: false }), 'guest');
  assert.equal(droitsApresChoixEntree({ ancien: 'private', nouveau: 'open', droits: 'account', choixManuel: false }), 'account');
  assert.equal(droitsApresChoixEntree({ ancien: 'private', nouveau: 'open', droits: 'guest', choixManuel: false }), 'guest');
});

test('E. page promo : mode private = gratuit même avec un lien de paiement ; sinon le lien décide', () => {
  assert.equal(promoPayante({ mode: 'private', paymentLink: 'https://pay.example' }), false);
  assert.equal(promoPayante({ mode: 'open', paymentLink: 'https://pay.example' }), true);
  assert.equal(promoPayante({ mode: 'open', paymentLink: '  ' }), false);
  assert.equal(promoPayante({ mode: undefined, paymentLink: 'https://pay.example' }), true); // ancien backend
});

test('sauvegarde confirmée seulement si la relecture correspond', () => {
  assert.equal(sauvegardeConfirmee({ mode: 'private', acces: 'account' }, { mode: 'private', acces: 'account' }), true);
  assert.equal(sauvegardeConfirmee({ mode: 'private', acces: 'account' }, { mode: 'private', acces: 'guest' }), false);
  assert.equal(sauvegardeConfirmee({ mode: 'private', acces: 'account' }, { mode: 'open', acces: 'account' }), false);
  assert.equal(sauvegardeConfirmee({ mode: 'private', acces: 'account' }, null), false);
});

const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));
const SEL = codeSeul(lire('components', 'session', 'AccessModeSelector.tsx'));
const PROMO = codeSeul(lire('pages', 'PromoPage.tsx'));
const SUPA = codeSeul(lire('lib', 'supabaseClient.ts'));

test('C/D. modale en brouillon : le sélecteur ne sauvegarde plus au clic, Annuler n’écrit rien', () => {
  assert.match(PAGE, /<AccessModeSelector value=\{accessDraft\} onChange=\{choisirDroitsInvites\} \/>/);
  const fn = PAGE.slice(PAGE.indexOf('const choisirDroitsInvites'), PAGE.indexOf('const choisirDroitsInvites') + 400);
  assert.doesNotMatch(fn, /saveAccessMode|configureSession/, 'aucune écriture au clic');
  const iA = PAGE.indexOf('const annulerModeAcces');
  const annuler = PAGE.slice(iA, PAGE.indexOf('}, []);', iA));
  assert.ok(PAGE.includes('const annulerModeAcces'), 'handler Annuler dédié');
  assert.doesNotMatch(annuler, /saveAccessMode|configureSession/, 'Annuler n’écrit rien');
  assert.match(PAGE, /onClick=\{annulerModeAcces\}/, 'le bouton Annuler utilise ce gestionnaire');
});

test('save : mode + access_mode, puis relecture, pas de faux succès', () => {
  const s = PAGE.slice(PAGE.indexOf('const handleSaveMode'), PAGE.indexOf('const handleSaveMode') + 2600);
  assert.match(s, /saveAccessMode\(sessionId, accessDraft/);
  assert.match(s, /lireAccesSession\(sessionId\)/);
  assert.match(s, /sauvegardeConfirmee\(/);
  assert.match(SUPA, /\.update\(upd\)\.eq\('session_id', sessionId\)\.select\('session_id'\)/, 'UPDATE compte les lignes (0 ligne = échec)');
});

test('libellés : Mode d’entrée / Droits des invités, sans promesse de chat', () => {
  assert.match(PAGE, /label: 'Avec crédits', desc: 'Les participants utilisent 1 crédit pour entrer\.'/);
  assert.match(PAGE, /label: 'Gratuit par lien \/ QR', desc: 'Aucun crédit ni compte requis pour les invités\.'/);
  assert.match(SEL, /label: 'Écoute uniquement'/);
  assert.match(SEL, /Audio synchronisé uniquement\. Pas de vidéo, pas de chat, pas de caméra ni micro\./);
  assert.match(SEL, /label: 'Accès visio'/);
  assert.match(SEL, /L’invité voit le Live vidéo et peut demander à monter à l’écran\. Caméra et micro après validation de l’hôte\./);
  const visio = SEL.slice(SEL.indexOf("label: 'Accès visio'"), SEL.indexOf("label: 'Accès visio'") + 260);
  assert.doesNotMatch(visio, /[Cc]hat/, 'aucune promesse de chat gratuit');
});

test('E/F. PromoPage : décide avec promoPayante(mode, lien) — mode lu dans la réponse promo', () => {
  assert.match(PROMO, /promoPayante\(\{ mode: promo\?\.mode, paymentLink: rawPaymentLink \}\)/);
  assert.match(codeSeul(lire('lib', 'paymentApi.ts')), /mode\?: 'open' \| 'paid' \| 'private' \| null;/);
});
