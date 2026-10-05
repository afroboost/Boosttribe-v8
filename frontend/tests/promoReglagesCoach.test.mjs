// ⚙️📣 01/10 — « Promo en attente » bien visible ; réglages Live du coach repris d'un Live à l'autre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

test('nouveau Live : préférences du coach appliquées UNE fois, seulement si le Live est vierge', () => {
  const s = codeSeul(lire('pages/SessionPage.tsx'));
  assert.match(s, /if \(!sessionId \|\| !user\?\.id \|\| !estProprietaireSession \|\| !accessModeResolved\) return;/);
  assert.match(s, /if \(prefsAppliqueesRef\.current === sessionId\) return;/);
  // 05/10 : « un réglage de session prime » est décidé par le SERVEUR (sessions réglées à la main), plus par access_mode vide.
  assert.match(s, /const p = await appliquerPreferencesLive\(sessionId\)/);
  assert.match(s, /\}, \[sessionId, user\?\.id, estProprietaireSession, accessModeResolved\]\);/);   // primitives
  assert.match(s, /void memoriserDroitsInvites\(accessDraft, sessionId\);/);
  const api = codeSeul(lire('lib/preferencesLiveApi.ts'));
  assert.match(api, /'\/live-promo\/appliquer-preferences'/);
  assert.match(api, /'\/coach\/preferences-live'/);
});
