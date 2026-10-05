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
  assert.equal(libelleOffre({ id: 'a', duree_s: 30, prix: 10 }), '30 secondes — 10 CHF');
  assert.equal(libelleOffre({ id: 'g', duree_s: 30, prix: 0, type: 'free' }), '30 secondes — Gratuit');   // 01/10
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
  // V571b : la promo s'arrête sur « Terminer » (définitif), pas sur « Quitter » (temporaire).
  assert.match(fin, /if \(definitif\) livePromo\.arreterSiActive\('fin_live'\);\s+const etapes = \(definitif \? sequenceFinDuLive : sequenceDepartTemporaire\)\(/);
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
  assert.match(p, /\{paiementReel && !enCours\.gratuit && peutPayer\(enCours\.status\) \?/);            // jamais « Payer » en Live de test
});

test('« Faire ma promo » : propriété de CETTE session, jamais le rôle global (coach / admin)', () => {
  const s = src('pages/SessionPage.tsx');
  assert.match(s, /const estProprietaireSession = estHoteServeur \?\? \(sessionHostId \? \(!!user\?\.id && user\.id === sessionHostId\) : isHost\);/);   // 01/10 : serveur d'abord
  const ligne = s.slice(s.indexOf('const estProprietaireSession'), s.indexOf('const [promoParticipantOuvert'));
  assert.doesNotMatch(ligne.replace(/\/\/.*$/gm, ''), /isAdmin|isCoach|role/);                 // aucun rôle global
  assert.match(s, /useLivePromo\(sessionId \|\| undefined, liveMode, estProprietaireSession, user\?\.id \|\| \(inviteIdentifie \? 'invite' : undefined\)\)/);
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

test('01/10 — cas réel : config de la session Live à enabled:false côté participant → l’hôte le VOIT, et rien ne se perd', () => {
  const t = src('components/session/LivePromoTarifs.tsx');
  // Fermer la fenêtre OU quitter la page avant l'envoi n'annule plus : la modification en attente part (keepalive).
  assert.match(t, /const envoyerEnAttente = \(\) => \{\s+const d = dernier\.current;\s+if \(d\.etat && d\.signature && d\.signature !== charge\.current && !offresValides\(d\.etat\.offres\)\) \{/);
  assert.match(t, /return \(\) => \{ window\.removeEventListener\('pagehide', envoyerEnAttente\); envoyerEnAttente\(\); \};/);
  // Après chaque enregistrement : relecture de la config PUBLIQUE (celle du participant), affichée.
  assert.match(t, /promoConfig\(sessionId\)\.then\(\(c\) => \{ promoJournal\(sessionId, 'relecture-publique'[^\n]*setVuParticipants\(/);
  assert.match(t, /data-testid="live-promo-vu-participants"/);
  assert.equal((t.match(/relirePublic\(\)/g) || []).length >= 3, true);
});

test('cas réel de visibilité (coach global non-hôte, super-admin non-hôte) : déjà VRAI dès que la config est activée', () => {
  const prop = (hostId, userId, isHostGlobal) => (hostId ? (!!userId && userId === hostId) : isHostGlobal);
  const visible = (cfg, hostId, userId, isHostGlobal) => !prop(hostId, userId, isHostGlobal) && !!userId && cfg.enabled && cfg.offres.length > 0;
  const actif = { enabled: true, offres: [{ id: 'o', duree_s: 30, prix: 10 }] };
  const prod = { enabled: false, offres: [] };                                  // réponse RÉELLE des 2 sessions Live
  assert.equal(visible(actif, 'hoteA', 'coachB', true), true);                  // coach global non-hôte
  assert.equal(visible(actif, 'hoteA', 'admin', true), true);                   // super-admin non-hôte
  assert.equal(visible(actif, 'hoteA', 'membre', false), true);                 // membre
  assert.equal(visible(actif, 'hoteA', 'hoteA', true), false);                  // vrai hôte
  assert.equal(visible(prod, 'hoteA', 'coachB', true), false);                  // ⇒ la cause : la config de la session
});

test('01/10 — visibilité « Faire ma promo » : hôte de CETTE session dit par le serveur, jamais le rôle global', () => {
  const s = src('pages/SessionPage.tsx');
  assert.match(s, /const estProprietaireSession = estHoteServeur \?\? \(sessionHostId \? \(!!user\?\.id && user\.id === sessionHostId\) : isHost\);/);
  assert.match(s, /useEffect\(\(\) => \{ setEstHoteServeur\(typeof estHoteConfig === 'boolean' \? estHoteConfig : null\); \}, \[estHoteConfig\]\);/);
  // 05/10 : la règle vit dans actionPromoParticipant (testée dans liveContract) — l'hôte reste exclu par estProprietaireSession.
  assert.match(s, /actionPromoParticipant\(\{ estProprietaire: estProprietaireSession, connecte: !!user, inviteIdentifie, config: livePromo\.config \}\)/);
  const api = src('lib/livePromoApi.ts');
  assert.match(api, /`\/live-promo\/config\/\$\{encodeURIComponent\(sid\)\}`, \{\}, 'si-connecte'\)/);
  // Modèle de la règle (mêmes entrées que SessionPage) — isHost vaut VRAI pour un admin partout.
  const prop = (estHoteServeur, hostId, userId, isHost) => estHoteServeur ?? (hostId ? userId === hostId : isHost);
  const visible = (cfg, ...a) => !prop(...a) && cfg.enabled && cfg.offres.length > 0;
  const actif = { enabled: true, offres: [{ id: 'o', duree_s: 30, prix: 10 }] };
  assert.equal(visible(actif, true, 'A', 'A', true), false);                 // A : vrai hôte
  assert.equal(visible(actif, false, 'A', 'membre', false), true);           // B : membre
  assert.equal(visible(actif, false, 'A', 'coachB', false), true);           // C : coach global non-hôte
  assert.equal(visible(actif, false, null, 'admin', true), true);            // D : super-admin, host_id illisible
  assert.equal(visible({ enabled: false, offres: [] }, false, 'A', 'membre', false), false); // E : désactivée
});

test('01/10 — tarifs : jamais de faux succès, envoi au départ en keepalive, aucun renvoi d’un tarif déjà enregistré', () => {
  const t = src('components/session/LivePromoTarifs.tsx');
  // succès seulement après confirmation serveur ; plus rien « en attente » ensuite (sinon renvoi sans id → nouvel id)
  assert.match(t, /adopter\(r\.offres\); dernier\.current = \{ etat: null, signature: '' \}; setMessage\('Enregistré automatiquement'\)/);
  assert.match(t, /const texte = refusSaisie \? `Non enregistré : \$\{refusSaisie\}` : enAttente && !message\.startsWith\('Enregistrement du tarif impossible'\) \? 'Enregistrement en cours…' : message;/);
  assert.match(t, /setMessage\(`Enregistrement du tarif impossible : \$\{\(e as Error\)\.message\}`\)/);
  // départ de la page : pagehide + démontage, keepalive
  assert.match(t, /window\.addEventListener\('pagehide', envoyerEnAttente\);/);
  assert.match(t, /promoEnregistrerConfig\(sessionId, d\.etat\.enabled, d\.etat\.offres, true, rid\)/);
  // ajout / suppression : envoi immédiat
  assert.equal((t.match(/immediatRef\.current = true;/g) || []).length, 3);   // ajout, suppression, gratuit/payant
  assert.match(t, /const delai = immediatRef\.current \? 0 : 700;/);
  assert.match(t, /\}, delai\);/);
  const api = src('lib/livePromoApi.ts');
  assert.match(api, /\.\.\.\(auDepart \? \{ keepalive: true \} : \{\}\)/);
});


test('01/10 — promo GRATUITE : type explicite, prix payant inchangé, aucun « Payer », historique « Gratuite »', async () => {
  const { offresValides, libelleMontant, estGratuite } = await import('./.build/livePromo.mjs');
  assert.equal(offresValides([{ id: '', duree_s: 30, prix: 0, type: 'free' }]), '');                  // gratuit : aucun prix exigé
  assert.equal(offresValides([{ id: '', duree_s: 30, prix: 0, type: 'paid' }]), 'Prix entre 0.5 et 10000 CHF');
  assert.equal(offresValides([{ id: '', duree_s: 30, prix: 0 }]), 'Prix entre 0.5 et 10000 CHF');    // défaut = payant
  assert.equal(libelleMontant({ gratuit: true, price_chf: 0 }), 'Gratuite');
  assert.equal(libelleMontant({ gratuit: false, price_chf: 10 }), '10 CHF');
  assert.equal(estGratuite({ type: 'free' }), true); assert.equal(estGratuite({}), false);
  const t = src('components/session/LivePromoTarifs.tsx');
  assert.match(t, /data-testid=\{t === 'free' \? 'live-promo-type-gratuit' : 'live-promo-type-payant'\}/);
  assert.match(t, /o\.type === 'free' \? \(\s*<span[^>]*data-testid="live-promo-prix-gratuit">Gratuit<\/span>/);
  assert.match(t, /\{ id: '', duree_s: 30, prix: 10, actif: true, type: etat\.paiement_reel === false \? 'free' : 'paid' \}/);  // payant par défaut (gratuit si le payant est impossible)
  assert.match(t, /disabled=\{t === 'paid' && etat\.paiement_reel === false\}/);
  assert.match(t, /data-testid="live-promo-mode-coach"/);
  const h = src('components/session/LivePromoHostModal.tsx');
  assert.equal((h.match(/libelleMontant\(p, devise\)/g) || []).length, 2);
});
