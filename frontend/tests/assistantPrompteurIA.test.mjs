/**
 * 🤖 05/10 — ASSISTANT IA DU PROMPTEUR : question du chat → suggestion pour l'HÔTE seul.
 *
 * Tests COMPORTEMENTAUX (le code tourne, aucun réseau, aucune IA réelle) :
 *   filtre de pertinence · déduplication par message_id · debounce · plafond client ·
 *   délai dépassé · panne IA · « Utiliser » / « Ignorer » · entrée transcription (voix).
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  questionAPreparer, quotaAutoPermis, compterAppelAuto, contextePourQuestion, avecDelai,
  lireDemandees, ecrireDemandees, decisionAuto, creerDebounce,
  DEBOUNCE_MS, DELAI_MIN_MS, MAX_AUTO_PAR_FENETRE, FENETRE_AUTO_MS, AGE_MAX_AUTO_MS, MESSAGES_CONTEXTE_QUESTION,
} from './.build/assistantHote.mjs';
import {
  ETAT_INITIAL, estBruit, ressembleAQuestion, estQuestionPertinente, recevoirMessages, recevoirTranscription,
  recevoirSuggestion, recevoirSuggestionAuto, utiliserSuggestion, ignorerSuggestion, afficher, ecrire, retirerQuestion,
} from './.build/prompteurSources.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const MOI = 'hote';
const msg = (id, text, extra = {}) => ({ id, userId: 'u-' + id, name: 'Awa', text, ts: 1000, ...extra });
const prep = (e, deja = new Set(), o = {}) => questionAPreparer({
  file: e.file, dejaDemandees: deja, suggestionEnAttente: !!e.suggestion, actif: true, enCours: false,
  pertinente: estQuestionPertinente, ...o,
});

/* ═══ 1. FILTRE : aucun appel IA pour bonjour / merci / emoji / réaction / test du son ═══ */
const BRUIT = ['bonjour', 'Bonjour à tous !', 'salut', 'coucou 👋', 'merci', 'Merci coach !!', 'mercii beaucoup',
  'bravo', '🔥🔥🔥', '👏', '❤️❤️', '?', '??', 'ok', 'top', 'Super séance', 'trop bien', 'haha', 'mdr',
  'on m’entend ?', "vous m'entendez ?", 'ça marche ?', 'ça va ?', 'Comment ça va ?', 'bonne soirée',
  ''];
const EXCLAMATIONS = ['Quelle belle séance !', 'Que c’est beau', 'Comme c’est bon de bouger'];
const VRAIES = ['Est-ce que je peux faire Afroboost si je débute ?', 'Comment on respire pendant le cardio',
  'Combien coûte la séance ?', 'Tu fais des cours le samedi matin ?', 'À quelle heure commence le prochain Live ?',
  'Merci ! Est-ce que je peux venir avec ma fille de 12 ans ?', 'Pourquoi on met un casque'];

test('bruit : jamais une question, jamais pertinent (même envoyé avec « ? »)', () => {
  for (const t of BRUIT) {
    assert.equal(ressembleAQuestion(t), false, `ressemble : ${t}`);
    assert.equal(estQuestionPertinente(t), false, `pertinent : ${t}`);
  }
  for (const t of BRUIT.filter(Boolean)) assert.equal(estBruit(t), true, `bruit : ${t}`);
  for (const t of EXCLAMATIONS) assert.equal(estQuestionPertinente(t), false, `exclamation : ${t}`);
  assert.equal(estQuestionPertinente('Tu fais des cours le samedi'), true, 'marquée « ? » sans point d’interrogation');
});

test('vraies questions : reconnues sans bouton « ? », et pertinentes', () => {
  for (const t of VRAIES) {
    assert.equal(ressembleAQuestion(t), true, t);
    assert.equal(estQuestionPertinente(t), true, t);
  }
});

test('un chat de bruit ne produit AUCUNE demande ; une question marquée « ? » mais vide de sens non plus', () => {
  const e = recevoirMessages(ETAT_INITIAL, [
    ...BRUIT.map((t, i) => msg('b' + i, t)),
    msg('m1', 'bonjour', { question: true }),             // marquée : entre dans la file (contrat existant)…
  ], MOI);
  assert.deepEqual(e.file.map((q) => q.id), ['m1']);
  assert.equal(prep(e), null, '… mais ne déclenche aucun appel IA');
});

/* ═══ 2. DÉDUPLICATION par message_id ═══ */
test('même message = UNE seule demande : re-rendu, double réception, reconnexion, rechargement', () => {
  const q = msg('q1', 'Est-ce que je peux venir si je débute ?');
  let e = recevoirMessages(ETAT_INITIAL, [q], MOI);
  const deja = new Set();
  const appels = [];
  const tour = () => { const x = prep(e, deja); if (x) { appels.push(x.id); deja.add(x.id); } };
  tour();
  // re-rendus : la même file relue 5 fois
  for (let i = 0; i < 5; i++) { e = recevoirMessages(e, [q], MOI); tour(); }
  // double réception (le message arrive deux fois, ex. Realtime + rattrapage)
  e = recevoirMessages(e, [q, { ...q }], MOI); tour();
  assert.deepEqual(appels, ['q1']);
  // rechargement : la mémoire persistée (sessionStorage) est relue → toujours rien
  const relue = lireDemandees(ecrireDemandees(deja));
  const apresRechargement = recevoirMessages(ETAT_INITIAL, [q], MOI);
  assert.equal(prep(apresRechargement, relue), null);
  // mémoire illisible ou falsifiée → ensemble vide, jamais d'exception
  assert.equal(lireDemandees('pas du json').size, 0);
  assert.deepEqual([...lireDemandees(JSON.stringify(['a', 3, { x: 1 }, 'b']))], ['a', 'b']);
});

test('une question trop ancienne (relue après coup) ne déclenche rien', () => {
  const e = recevoirMessages(ETAT_INITIAL, [msg('q1', 'Combien coûte la séance ?', { ts: 0 })], MOI);
  assert.equal(prep(e, new Set(), { maintenant: AGE_MAX_AUTO_MS + 1 }), null);
  assert.equal(prep(e, new Set(), { maintenant: AGE_MAX_AUTO_MS - 1 }).id, 'q1');
});

test('rien pendant un appel en vol, une suggestion en attente, ou assistant éteint', () => {
  const e = recevoirMessages(ETAT_INITIAL, [msg('q1', 'Combien coûte la séance ?')], MOI);
  assert.equal(prep(e, new Set(), { enCours: true }), null);
  assert.equal(prep(e, new Set(), { actif: false }), null);
  assert.equal(prep(e, new Set(), { suggestionEnAttente: true }), null);
  assert.equal(prep(e).id, 'q1');
});

/* ═══ 3. DEBOUNCE ═══ */
test('debounce : une rafale de 10 planifications = UNE exécution, après le calme', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const d = creerDebounce(DEBOUNCE_MS);
    let n = 0;
    for (let i = 0; i < 10; i++) { d.planifier(() => { n++; }); mock.timers.tick(DEBOUNCE_MS / 2); }
    assert.equal(n, 0, 'rien tant que ça bouge');
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(n, 1);
    d.planifier(() => { n++; }); d.annuler(); mock.timers.tick(DEBOUNCE_MS * 2);
    assert.equal(n, 1, 'annulé (démontage de la page) = rien');
  } finally { mock.timers.reset(); }
});

/* ═══ 4. LIMITE DE FRÉQUENCE côté client ═══ */
test('plafond client : au plus MAX_AUTO_PAR_FENETRE demandes automatiques par fenêtre', () => {
  let h = [];
  let t = 0;
  let parties = 0;
  for (let i = 0; i < 50; i++) {
    t += DELAI_MIN_MS;
    const d = decisionAuto({ historique: h, maintenant: t, dernierAppelMs: t - DELAI_MIN_MS });
    if (d.action === 'appeler') { parties++; h = compterAppelAuto(h, t); }
    if (t >= FENETRE_AUTO_MS - 1) break;
  }
  assert.equal(parties, MAX_AUTO_PAR_FENETRE);
  assert.equal(quotaAutoPermis(h, t + FENETRE_AUTO_MS), true, 'la fenêtre se libère');
  assert.deepEqual(decisionAuto({ historique: [], maintenant: 10_000, dernierAppelMs: 10_000 - 1000 }),
    { action: 'attendre', ms: DELAI_MIN_MS - 1000 }, 'délai minimum entre deux appels');
});

/* ═══ 5. DÉLAI DÉPASSÉ et PANNE : le Live continue ═══ */
const REPLI = { ok: false, suggestions: [], raison: 'delai_depasse' };
test('IA trop lente : on abandonne au délai, la réponse tardive est ignorée', async () => {
  let resoudre;
  const lente = new Promise((r) => { resoudre = r; });
  const r = await avecDelai(lente, 20, REPLI);
  assert.deepEqual(r, REPLI);
  resoudre({ ok: true, suggestions: ['trop tard'] });          // n'a plus aucun effet
});

test('IA en erreur (exception, rejet) : valeur de repli, jamais de rejet non géré', async () => {
  const erreur = { ...REPLI, raison: 'fournisseur_indisponible' };
  assert.deepEqual(await avecDelai(Promise.reject(new Error('500')), 1000, REPLI, erreur), erreur);
  assert.deepEqual(await avecDelai(Promise.resolve({ ok: true, suggestions: ['ok'] }), 1000, REPLI), { ok: true, suggestions: ['ok'] });
});

test('IA indisponible : le prompteur de l’hôte reste intact (rien n’est écrasé)', () => {
  let e = ecrire(ETAT_INITIAL, 'Mon échauffement du jour');
  e = afficher(e, 'manuel');
  e = recevoirMessages(e, [msg('q1', 'Combien coûte la séance ?')], MOI);
  // panne : aucune suggestion ne parvient → l'état ne change pas
  assert.equal(e.affiche, 'Mon échauffement du jour');
  assert.equal(e.brouillon, 'Mon échauffement du jour');
  assert.equal(e.suggestion, null);
});

/* ═══ 6. SUGGESTION automatique : jamais d'écrasement, UTILISER / IGNORER ═══ */
test('suggestion auto : bloc en attente, brouillon et texte affiché intacts', () => {
  let e = afficher(ecrire(ETAT_INITIAL, 'Mon thème'), 'manuel');
  e = recevoirMessages(e, [msg('q1', 'Combien coûte la séance ?')], MOI);
  const q = e.file[0];
  const s = recevoirSuggestionAuto(e, 'Viens essayer une séance, je te donne les tarifs juste après.', q);
  assert.equal(s.suggestion, 'Viens essayer une séance, je te donne les tarifs juste après.');
  assert.equal(s.questionActive.id, 'q1');
  assert.equal(s.affiche, 'Mon thème');
  assert.equal(s.brouillon, 'Mon thème');
  // UTILISER : la réponse devient exploitable (brouillon), jamais affichée sans « Afficher »
  const u = utiliserSuggestion(s);
  assert.equal(u.brouillon, 'Viens essayer une séance, je te donne les tarifs juste après.');
  assert.equal(u.affiche, 'Mon thème');
  assert.equal(u.suggestion, null);
  // … puis « Afficher » : le thème est mis de côté pour « Reprendre mon thème »
  const aff = afficher(u, 'question');
  assert.equal(aff.repriseTexte, 'Mon thème');
  // IGNORER : la suggestion disparaît
  const i = ignorerSuggestion(s);
  assert.equal(i.suggestion, null);
  assert.equal(i.affiche, 'Mon thème');
});

test('suggestion auto : ne remplace JAMAIS une proposition en attente ; question disparue = jetée', () => {
  let e = recevoirMessages(ETAT_INITIAL, [msg('q1', 'Combien coûte la séance ?'), msg('q2', 'Est-ce que je peux venir ?')], MOI);
  const q1 = e.file[0];
  const q2 = e.file[1];
  const enAttente = recevoirSuggestion(e, 'proposition que l’hôte lit', null);
  assert.equal(recevoirSuggestionAuto(enAttente, 'autre', q1), enAttente);
  const modere = retirerQuestion(e, 'q2');
  assert.equal(recevoirSuggestionAuto(modere, 'réponse', q2), modere);
  assert.equal(recevoirSuggestionAuto(e, '   ', q1), e, 'réponse vide = rien');
});

/* ═══ 7. CONTEXTE MINIMUM ═══ */
test('contexte : la question + les 4 derniers messages, jamais l’historique complet ni les identifiants', () => {
  const histo = Array.from({ length: 40 }, (_, i) => msg('h' + i, 'message ' + i, { email: 'x@y.ch' }));
  const { messages, question } = contextePourQuestion(histo, { id: 'q1', auteur: 'Awa', texte: 'Combien coûte la séance ?' });
  assert.equal(messages.length, MESSAGES_CONTEXTE_QUESTION);
  assert.deepEqual(question, { nom: 'Awa', texte: 'Combien coûte la séance ?' });
  assert.ok(!JSON.stringify({ messages, question }).includes('x@y.ch'));
  assert.ok(!JSON.stringify({ messages, question }).includes('u-h'));
});

/* ═══ 8. VOIX : l'entrée transcription suit le même circuit ═══ */
test('transcription : un segment-question entre dans la file (même dédup), le bruit oral non', () => {
  let e = recevoirTranscription(ETAT_INITIAL, { id: 's1', texte: 'Est-ce que je peux venir avec ma fille ?' });
  assert.equal(e.file[0].id, 'voix-s1');
  assert.equal(recevoirTranscription(e, { id: 's1', texte: 'Est-ce que je peux venir avec ma fille ?' }), e, 'même segment = rien');
  assert.equal(recevoirTranscription(ETAT_INITIAL, { id: 's2', texte: 'merci coach' }), ETAT_INITIAL);
  assert.equal(recevoirTranscription(ETAT_INITIAL, { texte: 'Combien coûte la séance ?' }), ETAT_INITIAL, 'sans id = rien');
  assert.equal(prep(e).id, 'voix-s1', 'puis le même chemin que le chat');
});

/* ═══ 9. BRANCHEMENT : hôte seul, jamais de réponse automatique dans le chat ═══ */
test('page : l’effet automatique est réservé à l’hôte et ne fait que préparer une suggestion', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  const i = page.indexOf('questionAPreparer({');
  const effet = page.slice(page.lastIndexOf('useEffect(', i), page.indexOf('}, [canShare, idsFile', i));
  assert.match(effet, /if \(!canShare \|\| !debounce\) return;/);
  assert.match(effet, /pertinente: estQuestionPertinente/);
  assert.match(effet, /debounce\.planifier\(/);
  assert.match(effet, /decisionAuto\(/);
  assert.match(effet, /demanderReponse\(q, false, true\)/);
  assert.ok(!/sendGroupMessage|envoyerMessage|channel\.send|broadcast/i.test(effet), 'aucun envoi dans le chat');
  // la réponse auto passe par recevoirSuggestionAuto : jamais par-dessus une proposition en attente
  assert.match(page, /auto && question \? recevoirSuggestionAuto\(e, r\.suggestions\[0\], question\)/);
  // le panneau (et donc tout bloc « Suggestion IA ») n'existe que pour l'hôte / co-hôte
  assert.match(page, /const assistantNode: React\.ReactNode = canShare \? \(/);
});
