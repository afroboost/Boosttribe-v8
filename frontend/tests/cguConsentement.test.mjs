/**
 * Post-S0 (19/10/2026) — CGU : consentement PROUVÉ (date + version posées par le serveur).
 *
 * Défauts corrigés : case d'inscription jamais enregistrée, aucune case pour Google, aucune
 * preuve datée/versionnée, faux succès d'acceptTerms (UPDATE sur ligne absente), texte de marque
 * codé en dur. La partie SQL est prouvée au banc : infra/post-s0/banc_profils.sh.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CGU_VERSION, CGU_EN_ATTENTE_TTL_MS, cguAJour, preuveDisponible, metadonneesInscription, consentementInscription,
  serialiserEnAttente, enAttenteValide, fonctionCguAbsente, verdictRelecture, texteRejoindre, MESSAGE_ECHEC_CGU,
} from './.build/cguConsentement.mjs';
import { lire, codeSeul } from './lireSource.mjs';

/* ───────────── 1. Règles pures ───────────── */

test('CGU_VERSION : une date AAAA-MM-JJ (format exigé par accepter_cgu côté serveur)', () => {
  assert.match(CGU_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(CGU_VERSION)));
});

test('cguAJour : avec la migration 03, il faut true + date serveur + MÊME version', () => {
  const v = CGU_VERSION;
  assert.equal(cguAJour({ terms_accepted: true, terms_accepted_at: '2026-10-19T10:00:00Z', terms_version: v }, v), true);
  assert.equal(cguAJour({ terms_accepted: true, terms_accepted_at: null, terms_version: v }, v), false, 'sans date');
  assert.equal(cguAJour({ terms_accepted: true, terms_accepted_at: '2026-10-19T10:00:00Z', terms_version: null }, v), false,
    'ancien front : version non précisée → redemandée une fois');
  assert.equal(cguAJour({ terms_accepted: true, terms_accepted_at: '2026-01-01T10:00:00Z', terms_version: '2026-01-01' }, v), false,
    'ancienne version → redemandée');
  assert.equal(cguAJour({ terms_accepted: false, terms_accepted_at: null, terms_version: null }, v), false, 'ancien compte');
});

test('cguAJour : sans la migration 03 (colonnes absentes), repli sur terms_accepted === true seul', () => {
  assert.equal(preuveDisponible({ terms_accepted: true }), false);
  assert.equal(cguAJour({ terms_accepted: true }), true);
  assert.equal(cguAJour({ terms_accepted: false }), false);
  assert.equal(cguAJour({ terms_accepted: null }), false);
  assert.equal(cguAJour({ terms_accepted: 'true' }), false, 'jamais une chaîne');
  assert.equal(cguAJour({}), false, 'profil local : jamais supposé');
  assert.equal(cguAJour(null), false);
  assert.equal(cguAJour(undefined), false);
});

test('inscription e-mail : le consentement part dans les métadonnées du compte', () => {
  const m = metadonneesInscription(' Awa ', 'awa@exemple.invalid', CGU_VERSION, new Date('2026-10-19T08:00:00Z'));
  assert.deepEqual(m, { full_name: 'Awa', cgu_acceptees: true, cgu_version: CGU_VERSION, cgu_acceptees_le_client: '2026-10-19T08:00:00.000Z' });
  assert.equal(metadonneesInscription('', 'bob@exemple.invalid').full_name, 'bob', 'nom par défaut = partie locale (comme avant)');
  assert.equal(consentementInscription(m, CGU_VERSION), true);
  assert.equal(consentementInscription({ ...m, cgu_version: '2025-01-01' }, CGU_VERSION), false, 'autre version');
  assert.equal(consentementInscription({ full_name: 'x' }, CGU_VERSION), false, 'ancien compte : rien');
  assert.equal(consentementInscription({ cgu_acceptees: 'true', cgu_version: CGU_VERSION }, CGU_VERSION), false);
  assert.equal(consentementInscription(null), false);
});

test('Google : consentement en attente — même version, récent, jamais dans le futur, illisible = non', () => {
  const t0 = 1_800_000_000_000;
  const brut = serialiserEnAttente(CGU_VERSION, t0);
  assert.equal(enAttenteValide(brut, CGU_VERSION, t0 + 60_000), true);
  assert.equal(enAttenteValide(brut, CGU_VERSION, t0 + CGU_EN_ATTENTE_TTL_MS + 1), false, 'expiré');
  assert.equal(enAttenteValide(brut, CGU_VERSION, t0 - 1), false, 'horodatage futur');
  assert.equal(enAttenteValide(brut, '2099-01-01', t0), false, 'autre version');
  assert.equal(enAttenteValide('{"v":"' + CGU_VERSION + '"}', CGU_VERSION, t0), false, 'sans heure');
  assert.equal(enAttenteValide('pas du json', CGU_VERSION, t0), false);
  assert.equal(enAttenteValide(null, CGU_VERSION, t0), false);
  assert.ok(CGU_EN_ATTENTE_TTL_MS <= 30 * 60 * 1000, 'fenêtre courte (appareil partagé)');
});

test('repli : seule l’absence de la fonction accepter_cgu déclenche l’écriture directe', () => {
  assert.equal(fonctionCguAbsente({ code: 'PGRST202', message: 'Could not find the function public.accepter_cgu(p_version)' }), true);
  assert.equal(fonctionCguAbsente({ code: '42883', message: 'function public.accepter_cgu(text) does not exist' }), true);
  assert.equal(fonctionCguAbsente({ code: '42501', message: 'accepter_cgu : connexion requise' }), false, 'refus ≠ absence');
  assert.equal(fonctionCguAbsente({ code: '22023', message: 'accepter_cgu : version invalide' }), false);
  assert.equal(fonctionCguAbsente({ message: 'Failed to fetch' }), false, 'réseau ≠ absence');
  assert.equal(fonctionCguAbsente(null), false);
});

test('verdict après RELECTURE : jamais de faux succès', () => {
  assert.deepEqual(verdictRelecture({ terms_accepted: true, terms_accepted_at: 'x', terms_version: CGU_VERSION }), { ok: true });
  assert.deepEqual(verdictRelecture(null), { ok: false, erreur: MESSAGE_ECHEC_CGU }, 'ligne absente');
  assert.deepEqual(verdictRelecture({ terms_accepted: false, terms_accepted_at: null, terms_version: null }),
    { ok: false, erreur: MESSAGE_ECHEC_CGU });
  assert.match(MESSAGE_ECHEC_CGU, /n'a pas pu être enregistrée/);
});

test('texte d’inscription : suit la marque', () => {
  const brands = JSON.parse(lire('config', 'brands.json'));
  assert.equal(texteRejoindre(brands.boosttribe.communityName), 'Rejoignez la communauté Boosttribe');
  assert.equal(texteRejoindre(brands.afroboost.communityName), 'Rejoignez la communauté Afroboost');
});

/* ───────────── 2. Branchements (code exécuté, commentaires retirés) ───────────── */

const AUTH = codeSeul(lire('context', 'AuthContext.tsx'));
const LOGIN = codeSeul(lire('pages', 'LoginPage.tsx'));
const PRICING = codeSeul(lire('pages', 'PricingPage.tsx'));
const WALLET = codeSeul(lire('pages', 'WalletPage.tsx'));

function bloc(code, debut) {
  const i = code.indexOf(debut);
  assert.ok(i >= 0, `introuvable : ${debut}`);
  const ouv = code.indexOf('{', code.indexOf('=>', i));
  let n = 0;
  for (let j = ouv; j < code.length; j++) {
    if (code[j] === '{') n++;
    else if (code[j] === '}' && --n === 0) return code.slice(i, j + 1);
  }
  throw new Error(`fin introuvable : ${debut}`);
}

test('inscription e-mail : signUp envoie le consentement (options.data), plus seulement full_name', () => {
  const f = bloc(AUTH, 'const signUpWithEmail');
  assert.match(f, /data:\s*metadonneesInscription\(fullName, email, CGU_VERSION\)/);
});

test('acceptTerms : fonction serveur, repli seulement si absente, ligne créée si absente, RELECTURE', () => {
  const f = bloc(AUTH, 'const acceptTerms');
  assert.match(f, /\.rpc\('accepter_cgu', \{ p_version: CGU_VERSION \}\)/);
  assert.match(f, /if \(!fonctionCguAbsente\(errRpc\)\)/);
  assert.match(f, /\.select\('id'\)/, 'le repli sait si une ligne a été modifiée');
  const iRelue = f.indexOf("const { data: relue");
  assert.ok(iRelue > f.indexOf('.rpc('), 'relecture APRÈS écriture');
  assert.match(f.slice(iRelue), /return verdict;/);
  assert.doesNotMatch(f, /return true/, 'aucun succès sans relecture');
  assert.doesNotMatch(f, /terms_accepted_at|terms_version/, 'le navigateur n’écrit jamais la preuve');
});

test('consentement d’avant session (e-mail / Google) enregistré une fois, dépendances primitives', () => {
  assert.match(AUTH, /consentementInscription\(user\?\.user_metadata, CGU_VERSION\) \|\| enAttenteValide\(enAttente, CGU_VERSION\)/);
  assert.match(AUTH, /\}, \[userId, profilId, cguOk, isAdmin\]\);/);
  assert.match(AUTH, /if \(cguAutoRef\.current === userId\) return;/);
});

test('profil absent : la ligne est créée à l’acceptation (serveur, ou createProfile en repli)', () => {
  const f = bloc(AUTH, 'const acceptTerms');
  assert.match(f, /if \(!maj \|\| maj\.length === 0\)[\s\S]*createProfile\(user\.id, user\.email \|\| '', user\.user_metadata, true\)/,
    '0 ligne → création, jamais un faux succès');
  assert.match(f, /if \(!creee\) return \{ ok: false, erreur: MESSAGE_ECHEC_CGU \};/);
  const c = bloc(AUTH, 'const createProfile');
  const charge = c.slice(c.indexOf('const newProfile'), c.indexOf('try {'));
  assert.doesNotMatch(charge, /role:|subscription_status:|credits|comp_access/, 'aucune colonne sensible envoyée');
  assert.doesNotMatch(c, /createLocalProfile/, 'un échec de création est un échec (pas un profil local « réussi »)');
});

test('Google : case CGU exigée à l’inscription, consentement mémorisé avant la redirection', () => {
  const g = bloc(LOGIN, 'const handleGoogleLogin');
  assert.match(g, /if \(mode === 'signup' && !acceptedTerms\)/);
  assert.match(g, /signInWithGoogle\(mode === 'signup' && acceptedTerms\)/);
  assert.match(LOGIN, /disabled=\{mode === 'signup' && !acceptedTerms\}/);
  const s = bloc(AUTH, 'const signInWithGoogle');
  assert.match(s, /localStorage\.setItem\(CLE_CGU_EN_ATTENTE, serialiserEnAttente\(CGU_VERSION\)\)/);
  assert.ok(s.indexOf('setItem(CLE_CGU_EN_ATTENTE') < s.indexOf('signInWithOAuth'), 'avant la redirection');
});

test('achats : aucun paiement si l’acceptation n’est pas confirmée', () => {
  assert.equal((PRICING.match(/if \(termsChecked && !hasAcceptedTerms && !\(await handleAcceptTerms\(\)\)\) return;/g) || []).length, 2,
    'achat + abonnement');
  assert.match(PRICING, /if \(!\(await handleAcceptTerms\(\)\)\) return;/, 'fenêtre CGU');
  assert.match(bloc(PRICING, 'const handleAcceptTerms'), /if \(!r\.ok\) \{ showToast\(r\.erreur, 'error'\); return false; \}/);
  assert.match(bloc(WALLET, 'const handleSubscribe'), /if \(!hasAcceptedTerms\)[\s\S]*navigate\('\/pricing'\)/);
});

test('LoginPage : plus aucun nom de marque codé en dur', () => {
  assert.doesNotMatch(LOGIN, /communauté Boosttribe/);
  assert.match(LOGIN, /texteRejoindre\(BRAND\.communityName\)/);
});
