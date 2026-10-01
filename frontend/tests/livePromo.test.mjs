// 📣 Promo participant pendant le Live (V1) — règles d'écran + garde-fous de structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decalageHorloge, secondesRestantes, lienDecouvrir, libelleOffre, actionsHote, peutPayer, enAttenteHote, offresValides } from './.build/livePromo.mjs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const T0 = Date.parse('2026-09-30T18:00:00Z');

test('même échéance pour tous : le temps restant vient de ends_at (serveur), corrigé de l’horloge', () => {
  const ends = '2026-09-30T18:00:30Z';
  // téléphone en retard de 5 s sur le serveur
  const dec = decalageHorloge('2026-09-30T18:00:00Z', T0 - 5000);
  assert.equal(dec, 5000);
  assert.equal(secondesRestantes(ends, dec, T0 - 5000), 30);
  // rechargement / nouvel arrivant 12 s plus tard : 18 s, jamais 30
  assert.equal(secondesRestantes(ends, dec, T0 - 5000 + 12000), 18);
  assert.equal(secondesRestantes(ends, dec, T0 + 60000), 0);          // fin : 0, la bannière disparaît
  assert.equal(secondesRestantes('illisible', 0, T0), 0);
});

test('Découvrir : http(s) seulement ; sans lien -> null (aucun bouton) ; schémas dangereux refusés', () => {
  assert.equal(lienDecouvrir('https://ma-boutique.ch/x'), 'https://ma-boutique.ch/x');
  for (const v of ['', null, undefined, 'javascript:alert(1)', 'data:text/html,x', 'ftp://x.ch', 'https://x.ch/"><script>'])
    assert.equal(lienDecouvrir(v), null);
});

test('tarifs, statuts, actions de l’hôte', () => {
  assert.equal(libelleOffre({ id: 'a', duree_s: 30, prix: 10 }), '30 s — 10 CHF');
  assert.deepEqual(actionsHote('requested'), ['refuser', 'accepter']);
  assert.deepEqual(actionsHote('ready'), ['diffuser']);
  assert.deepEqual(actionsHote('broadcasting'), ['arreter']);
  assert.deepEqual(actionsHote('rejected'), []);
  assert.equal(peutPayer('requested'), false);      // jamais payer avant l'acceptation
  assert.equal(peutPayer('accepted'), true);
  assert.equal(enAttenteHote([{ status: 'requested' }, { status: 'ready' }, { status: 'requested' }]), 2);
  assert.equal(offresValides([{ id: '', duree_s: 0, prix: 5 }]), 'Durée entre 5 s et 3600 s');
  assert.equal(offresValides([{ id: '', duree_s: 30, prix: -1 }]), 'Prix entre 0.5 et 10000 CHF');
  assert.equal(offresValides([{ id: '', duree_s: 30, prix: 10 }]), '');
});

test('bannière : Découvrir conditionnel, nouvel onglet sécurisé, aucun HTML brut', () => {
  const b = src('components/session/LivePromoBanner.tsx');
  assert.match(b, /\{lien \? \(\s*<a href=\{lien\} target="_blank" rel="noopener noreferrer"/);
  for (const f of ['LivePromoBanner', 'LivePromoParticipantModal', 'LivePromoHostModal', 'LivePromoTarifs'])
    assert.doesNotMatch(src(`components/session/${f}.tsx`), /dangerouslySetInnerHTML|<iframe/);
});

test('« Faire ma promo » est un item du menu ⋮, jamais une icône de la colonne', () => {
  const c = src('components/session/LiveControls.tsx');
  assert.match(c, /id: 'promo-participant',\s+label: 'Faire ma promo'/);
  assert.doesNotMatch(src('lib/liveControls.ts'), /promo/i);        // PRIORITE / ORDRE des commandes inchangés
});

test('la promo a SON canal ; la séquence de fin du Live est inchangée', () => {
  const h = src('hooks/useLivePromo.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // code seul, sans commentaires
  assert.match(h, /supabase\.channel\(`live-promo:\$\{sessionId\}`\)/);
  assert.doesNotMatch(h, /playback:|heartbeat|live-status|EVENEMENT_LIVE_TERMINE/);
  const s = src('pages/SessionPage.tsx');
  const fin = s.slice(s.indexOf('const terminerLive = useCallback'), s.indexOf('const quitterLeLive'));
  assert.match(fin, /livePromo\.arreterSiActive\('fin_live'\);\s+const etapes = sequenceFinDuLive\(/);
  assert.equal((fin.match(/livePromo/g) || []).length, 2);         // l'appel + la dépendance, rien d'autre
});

test('la bannière vit dans la pile du Live, au-dessus du chat (jamais sous la barre)', () => {
  const p = src('components/session/LiveVisioPanel.tsx');
  const pile = p.slice(p.indexOf('data-testid="visio-calques-bas"'));
  assert.ok(pile.indexOf('visio-calque-promo') > 0 && pile.indexOf('visio-calque-promo') < pile.indexOf('visio-calque-haut'));
});

test('hotfix super-admin : section visible si le serveur dit eligible ; mode test sans argent explicite', () => {
  const t = src('components/session/LivePromoTarifs.tsx');
  assert.match(t, /if \(!etat \|\| !etat\.eligible\) return null;/);               // la visibilité vient du SERVEUR
  assert.doesNotMatch(t, /artboost|@gmail|isAdmin/);                                // aucun e-mail / rôle deviné côté écran
  assert.match(t, /etat\.paiement_reel === false \?/);
  const h = src('components/session/LivePromoHostModal.tsx');
  assert.match(h, /!paiementReel && s === 'accepted' \? \['tester'\]/);
  const p = src('components/session/LivePromoParticipantModal.tsx');
  assert.match(p, /\{paiementReel && peutPayer\(enCours\.status\) \?/);            // jamais « Payer » en Live de test
});

test('« Faire ma promo » : propriété de CETTE session, jamais le rôle global (coach / admin)', () => {
  const s = src('pages/SessionPage.tsx');
  assert.match(s, /const estProprietaireSession = sessionHostId \? \(!!user\?\.id && user\.id === sessionHostId\) : isHost;/);
  const ligne = s.slice(s.indexOf('const estProprietaireSession'), s.indexOf('const [promoParticipantOuvert'));
  assert.doesNotMatch(ligne.replace(/\/\/.*$/gm, ''), /isAdmin|isCoach|role/);                 // aucun rôle global
  assert.match(s, /useLivePromo\(sessionId \|\| undefined, liveMode, estProprietaireSession, user\?\.id\)/);
  // simulation de la règle sur les 4 cas du test manuel
  const prop = (hostId, userId, isHostGlobal) => (hostId ? (!!userId && userId === hostId) : isHostGlobal);
  const visible = (hostId, userId, isHostGlobal, enabled, n) => !prop(hostId, userId, isHostGlobal) && !!userId && enabled && n > 0;
  assert.equal(visible('A', 'B', false, true, 1), true);      // membre ordinaire
  assert.equal(visible('A', 'B', true, true, 1), true);       // coach / super-admin (isHost global vrai) chez un AUTRE hôte
  assert.equal(visible('A', 'A', true, true, 1), false);      // hôte réel
  assert.equal(visible('A', 'B', false, false, 1), false);    // promo désactivée
  assert.equal(visible('A', 'B', false, true, 0), false);     // aucun tarif actif : pas de parcours cassé
});

test('tarifs : enregistrement AUTOMATIQUE (plus de piège du second bouton), sans boucle', () => {
  const t = src('components/session/LivePromoTarifs.tsx');
  assert.match(t, /const signature = etat && etat\.eligible \? JSON\.stringify/);
  assert.match(t, /\}, \[signature, sessionId\]\);/);                                           // dépendances primitives
  assert.match(t, /if \(!signature \|\| signature === charge\.current \|\| !etat\) return undefined;/);
  assert.match(t, /adopter\(r\.offres\)/);                                                       // identifiants du serveur
});
