/**
 * 🪪 Identité Afroboost au Live — le nom déjà connu n'est plus redemandé,
 *    et l'invité anonyme garde sa modale.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nomAfroboostUtilisable, deciderPseudo, PSEUDO_MAX } from './.build/identiteLive.mjs';
import { lire, codeSeul } from './lireSource.mjs';

test('un vrai nom de profil est utilisable ; le repli « partie locale de l’e-mail » ne l’est pas', () => {
  assert.equal(nomAfroboostUtilisable('Coach Bassi', 'contact.artboost@gmail.com'), 'Coach Bassi');
  // AuthContext remplit full_name avec email.split('@')[0] quand le compte n'a pas de nom :
  // ce n'est pas une identité, c'est une adresse tronquée.
  assert.equal(nomAfroboostUtilisable('contact.artboost', 'contact.artboost@gmail.com'), null);
  assert.equal(nomAfroboostUtilisable('CONTACT.ARTBOOST', 'contact.artboost@gmail.com'), null, 'casse ignorée');
  assert.equal(nomAfroboostUtilisable('', 'a@b.c'), null);
  assert.equal(nomAfroboostUtilisable('  ', 'a@b.c'), null);
  assert.equal(nomAfroboostUtilisable('X', 'a@b.c'), null, 'moins de 2 caractères');
  assert.equal(nomAfroboostUtilisable(null, null), null);
});

test('le nom est borné comme la modale (20 caractères)', () => {
  const long = 'Marie-Christine De La Tour Du Pin';
  assert.equal(nomAfroboostUtilisable(long, 'm@x.ch').length, PSEUDO_MAX);
});

test('HÔTE/ABONNÉ connu : aucun pseudo demandé, le nom Afroboost est utilisé', () => {
  const d = deciderPseudo({ memorise: null, nomProfil: 'Coach Bassi', email: 'contact.artboost@gmail.com' });
  assert.equal(d.demander, false);
  assert.equal(d.pseudo, 'Coach Bassi');
  assert.equal(d.source, 'profil');
});

test('INVITÉ ANONYME : aucun profil → la modale reste (parcours historique conservé)', () => {
  const d = deciderPseudo({ memorise: null, nomProfil: null, email: null });
  assert.equal(d.demander, true);
  assert.equal(d.pseudo, null);
  assert.equal(d.prerempli, '');
});

test('profil sans vrai nom : la modale reste MAIS pré-remplie (un clic, pas une saisie)', () => {
  const d = deciderPseudo({ memorise: null, nomProfil: 'contact.artboost', email: 'contact.artboost@gmail.com' });
  assert.equal(d.demander, true);
  assert.equal(d.prerempli, 'contact.artboost');
});

test('un pseudo SAISI l’emporte sur le nom du profil — sinon « Changer de pseudo » ne servirait à rien', () => {
  const d = deciderPseudo({ memorise: 'DJ Bass', nomProfil: 'Coach Bassi', email: 'contact.artboost@gmail.com' });
  assert.equal(d.pseudo, 'DJ Bass');
  assert.equal(d.source, 'memorise');
  assert.equal(d.demander, false);
});

test('structurel : la page lit le profil et n’ouvre plus la modale sur le seul localStorage', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  assert.ok(page.includes("from '@/lib/identiteLive'"), 'la règle vient du module testé');
  assert.ok(page.includes('deciderPseudo({ memorise: getStoredNickname()'), 'décision centralisée');
  assert.ok(page.includes('profile?.full_name'), 'le nom Afroboost est consulté');
  // L'ancien comportement : `if (stored) … else setShowNicknameModal(true)` sans profil.
  assert.ok(!/const stored = getStoredNickname\(\);\s*\n\s*\n\s*if \(stored\)/.test(page),
    'l’ancienne initialisation « localStorage seul » a disparu');
  assert.ok(page.includes('if (authLoading) return;'),
    'on attend le profil : sinon la modale s’ouvrirait avant que le nom arrive');
});
