/**
 * 🛡️ S0 (19/10/2026) — le navigateur suit les décisions d'accès du SERVEUR.
 *  1. les AUTRES participants (nom, photo) se lisent par la vue `profiles_public` ;
 *     si la vue n'existe pas encore (migration non appliquée) → repli sur `profiles` ;
 *  2. plus aucune lecture directe d'autres profils dans `profiles` ;
 *  3. prise d'hôte refusée (402) → paywall, PAS « je suis l'hôte » ;
 *  4. le jeton vidéo transmet la demande d'accès approuvée (participant anonyme, session payante).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lireProfilsPublics } from './.build/profilsPublics.mjs';
import { lire, codeSeul } from './lireSource.mjs';

function fauxClient(reponses) {
  const appels = [];
  return {
    appels,
    from(table) {
      return {
        select(cols) {
          return { in: async (_c, ids) => { appels.push({ table, cols, ids }); return reponses[table]; } };
        },
      };
    },
  };
}

test('1. vue publique d\'abord : nom/photo normalisés, aucune autre colonne', async () => {
  const c = fauxClient({ profiles_public: { data: [{ id: 'a', full_name: 'Alice', avatar_url: null }], error: null } });
  const r = await lireProfilsPublics(c, ['a'], 'id, full_name, avatar_url');
  assert.deepEqual(r, [{ id: 'a', full_name: 'Alice', avatar_url: null }]);
  assert.deepEqual(c.appels.map((a) => a.table), ['profiles_public']);
});

test('1b. migration pas encore appliquée (vue absente) → repli sur profiles', async () => {
  const c = fauxClient({
    profiles_public: { data: null, error: { code: 'PGRST205' } },
    profiles: { data: [{ id: 'b', avatar_url: 'https://x/b.png' }], error: null },
  });
  const r = await lireProfilsPublics(c, ['b'], 'id, avatar_url');
  assert.deepEqual(r, [{ id: 'b', full_name: null, avatar_url: 'https://x/b.png' }]);
  assert.deepEqual(c.appels.map((a) => a.table), ['profiles_public', 'profiles']);
});

test('1c. aucune id → aucun appel ; deux erreurs → liste vide (initiales affichées)', async () => {
  const vide = fauxClient({});
  assert.deepEqual(await lireProfilsPublics(vide, [], 'id, avatar_url'), []);
  assert.equal(vide.appels.length, 0);
  const ko = fauxClient({ profiles_public: { error: { code: 'x' } }, profiles: { error: { code: '42501' } } });
  assert.deepEqual(await lireProfilsPublics(ko, ['z'], 'id, avatar_url'), []);
});

test('2. plus aucune lecture d\'AUTRES profils directement dans `profiles`', () => {
  for (const f of ['pages/SessionPage.tsx', 'components/session/SessionSocial.tsx']) {
    const code = codeSeul(lire(f));
    assert.ok(!/from\('profiles'\)\s*\.select\([^)]*\)\s*\.in\(/.test(code), `${f} lit encore d'autres profils dans profiles`);
    assert.ok(code.includes('lireProfilsPublics('), `${f} doit passer par lireProfilsPublics`);
  }
});

test('3. prise d\'hôte refusée (crédits) → paywall, pas de faux rôle d\'hôte', () => {
  const api = codeSeul(lire('lib/paymentApi.ts'));
  assert.match(api, /insuffisant/i);
  const page = codeSeul(lire('pages/SessionPage.tsx'));
  const i = page.indexOf('const r = await claimHost(sessionId);');
  const bloc = page.slice(i, i + 600);
  assert.ok(bloc.indexOf('r.insufficient') > -1 && bloc.indexOf("setCreditsBlocked('host')") > -1);
  assert.ok(bloc.indexOf('r.insufficient') < bloc.indexOf('setIsHost(true)'), 'le refus doit être traité AVANT de se déclarer hôte');
});

test('4. le jeton vidéo transmet la demande approuvée (même clé que SessionPage)', () => {
  const hook = codeSeul(lire('hooks/useLiveKitStage.ts'));
  assert.match(hook, /request_id: demandeApprouvee\(sessionId\), request_token: preuveDemande\(sessionId\)/);
  assert.match(hook, /bt_ar_preuve_\$\{sessionId\}/);
  assert.match(codeSeul(lire('lib/paymentApi.ts')), /bt_ar_preuve_\$\{sessionId\}/);
  assert.match(hook, /bt_ar_\$\{sessionId\}/);
  assert.match(codeSeul(lire('pages/SessionPage.tsx')), /bt_ar_\$\{sessionId\}/);
});
