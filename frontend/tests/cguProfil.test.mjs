/**
 * Post-S0 (19/10/2026) — CGU : le navigateur écrit et lit la VRAIE colonne `terms_accepted`.
 *
 * `has_accepted_terms` n'existe dans aucune des deux bases (boosttribe.pro, afroboost.com/live) :
 * l'écrire faisait échouer la requête (colonne inconnue) — l'acceptation n'était jamais enregistrée,
 * et la lecture renvoyait toujours « non accepté ». Le nom reste uniquement comme valeur d'AFFICHAGE,
 * déduite de `terms_accepted === true` (aucun compte n'est réputé avoir accepté sans preuve).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const code = codeSeul(lire('context', 'AuthContext.tsx'));

/** Corps d'une fonction à partir de sa déclaration, jusqu'à l'accolade fermante correspondante. */
function corps(debut) {
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

test('acceptation des CGU : écrit terms_accepted = true, jamais has_accepted_terms', () => {
  const f = corps('const acceptTerms');
  const maj = f.slice(f.indexOf('.update('), f.indexOf('.eq('));
  assert.match(maj, /terms_accepted:\s*true/);
  assert.doesNotMatch(maj, /has_accepted_terms/);
  assert.match(f, /\.eq\('id',\s*user\.id\)/, 'uniquement SA ligne');
});

test('création de profil : la charge ne nomme aucune colonne inexistante', () => {
  const f = corps('const createProfile');
  const charge = f.slice(f.indexOf('const newProfile'), f.indexOf('try {'));
  assert.match(charge, /terms_accepted:\s*false/);
  assert.doesNotMatch(charge, /has_accepted_terms/);
});

test('lecture : seul un true explicite en base vaut acceptation', () => {
  assert.match(code, /const avecCgu = \(row: UserProfile\): UserProfile => \(\{ \.\.\.row, has_accepted_terms: row\?\.terms_accepted === true \}\)/);
  const f = corps('const fetchProfile');
  assert.match(f, /return avecCgu\(data as UserProfile\)/);
  assert.match(f, /return avecCgu\(\{ \.\.\.data, role: 'admin'/);
});

test('aucune écriture vers la base ne contient has_accepted_terms', () => {
  for (const m of code.matchAll(/\.(update|insert|upsert)\(([\s\S]*?)\)/g)) {
    assert.doesNotMatch(m[2], /has_accepted_terms/, `écriture fautive : .${m[1]}(${m[2].slice(0, 80)}…)`);
  }
});
