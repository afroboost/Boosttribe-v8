// 🔐 01/10 — Cloisonnement des réseaux sociaux par compte (côté navigateur = 2e protection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memeCompte, sessionEtrangere } from './.build/identiteEmbed.mjs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('entrée Live : on ne continue que sous le compte annoncé par Afroboost', () => {
  assert.equal(memeCompte('coach-b@x.test', 'Coach-B@x.test'), true);
  assert.equal(memeCompte('coach-b@x.test', 'contact.artboost@gmail.com'), false);   // session admin restée ouverte
  assert.equal(memeCompte('coach-b@x.test', null), false);
  assert.equal(memeCompte('', ''), false);
  assert.equal(sessionEtrangere('coach-b@x.test', 'contact.artboost@gmail.com'), true);
  assert.equal(sessionEtrangere('coach-b@x.test', 'coach-b@x.test'), false);
  assert.equal(sessionEtrangere('coach-b@x.test', undefined), false);
});

test('embedApi : session étrangère fermée AVANT, compte vérifié APRÈS, sinon refus (jamais ok:true)', () => {
  const e = src('lib/embedApi.ts');
  const iAvant = e.indexOf('if (sessionEtrangere(login.email, avant)) await supabase.auth.signOut');
  const iOtp = e.indexOf('supabase.auth.verifyOtp({ token_hash');
  const iApres = e.indexOf('if (!memeCompte(login.email, apres))');
  const iOk = e.indexOf('return { ok: true');
  assert.ok(iAvant > 0 && iAvant < iOtp && iOtp < iApres && iApres < iOk);
  assert.match(e.slice(iApres, iOk), /return \{ ok: false, error: 'Connexion à votre compte impossible/);
});

test('tiroir : changement de compte → état oublié puis relu au serveur (clé = identifiant primitif)', () => {
  const b = src('hooks/useBroadcast.ts');
  assert.match(b, /supabase\.auth\.onAuthStateChange\(\(_evt, session\) => \{\s+const id = session\?\.user\?\.id \?\? null;\s+if \(compte !== undefined && id !== compte\) \{\s+dispatch\(\{ type: 'oublier' \}\);/);
  assert.match(b, /data\.subscription\.unsubscribe\(\)/);
  assert.doesNotMatch(b, /localStorage|sessionStorage/);                                  // aucun cache social navigateur
  const l = src('lib/broadcastLogic.ts');
  assert.match(l, /case 'oublier':\s+return BROADCAST_INITIAL;/);
});
