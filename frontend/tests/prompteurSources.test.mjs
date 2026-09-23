/**
 * 📝 LE PROMPTEUR DE L'HÔTE — trois sources, un seul écran, aucun écrasement.
 *
 * La règle que ces bancs protègent tient en une phrase : **l'IA propose, l'hôte décide.**
 * En direct, face caméra, rien de ce que produit l'assistant ne doit apparaître — ni
 * disparaître — sans un clic. Un coach est en train de lire son thème à voix haute ;
 * qu'une question du chat arrive à cet instant ne doit RIEN changer à ce qu'il lit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ETAT_INITIAL, ecrire, afficher, effacer, recevoirSuggestion, utiliserSuggestion,
  ignorerSuggestion, recevoirQuestion, ouvrirQuestion, reprendreTexte, peutReprendre,
  libelleAttente, ACTIONS_TEXTE,
} from './.build/prompteurSources.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const Q = (id, texte = 'Comment on respire ?') => ({ id, auteur: 'Awa', texte });

// ── SOURCE 1 : MON TEXTE — le prompteur marche sans IA ──────────────────────────────

test('écrire puis afficher : le texte de l’hôte arrive à l’écran, sans IA', () => {
  const e = afficher(ecrire(ETAT_INITIAL, 'Bienvenue à tous'), 'manuel');
  assert.equal(e.affiche, 'Bienvenue à tous');
  assert.equal(e.sourceAffichee, 'manuel');
});

test('écrire N’AFFICHE PAS — sinon chaque frappe passerait à l’antenne', () => {
  const e = ecrire(ETAT_INITIAL, 'brouillon en cours');
  assert.equal(e.affiche, '');
  assert.equal(e.sourceAffichee, null);
});

test('effacer vide l’écran mais garde le brouillon — on ne perd pas son texte en le retirant', () => {
  const e = effacer(afficher(ecrire(ETAT_INITIAL, 'mon plan'), 'manuel'));
  assert.equal(e.affiche, '');
  assert.equal(e.sourceAffichee, null);
  assert.equal(e.brouillon, 'mon plan');
});

// ── SOURCE 2 : THÈME IA — une proposition n’est jamais un affichage ─────────────────

test('une suggestion NE TOUCHE NI le brouillon NI l’écran : elle attend', () => {
  const base = afficher(ecrire(ETAT_INITIAL, 'Mon thème à moi'), 'theme');
  const e = recevoirSuggestion(base, 'Proposition de l’IA', null);
  assert.equal(e.affiche, 'Mon thème à moi', 'le texte lu en direct doit être intact');
  assert.equal(e.brouillon, 'Mon thème à moi', 'le brouillon de l’hôte doit être intact');
  assert.equal(e.suggestion, 'Proposition de l’IA');
});

test('« Utiliser » met la suggestion dans le brouillon — éditable, et toujours pas à l’écran', () => {
  const e = utiliserSuggestion(recevoirSuggestion(ETAT_INITIAL, 'Texte IA', null));
  assert.equal(e.brouillon, 'Texte IA');
  assert.equal(e.affiche, '', 'il faut encore cliquer « Afficher »');
  assert.equal(e.suggestion, null);
});

test('« Ignorer » fait disparaître la proposition et la question liée, rien d’autre', () => {
  const base = afficher(ecrire(ETAT_INITIAL, 'à l’antenne'), 'manuel');
  const e = ignorerSuggestion(recevoirSuggestion(base, 'IA', Q('q1')));
  assert.equal(e.suggestion, null);
  assert.equal(e.questionActive, null);
  assert.equal(e.affiche, 'à l’antenne');
  assert.equal(e.brouillon, 'à l’antenne');
});

test('utiliser sans suggestion ne détruit pas le brouillon', () => {
  const base = ecrire(ETAT_INITIAL, 'mon texte');
  assert.deepEqual(utiliserSuggestion(base), base);
});

// ── SOURCE 3 : QUESTIONS — elles arrivent, elles attendent ──────────────────────────

test('une question arrivée en direct va dans la file, JAMAIS à l’écran', () => {
  const base = afficher(ecrire(ETAT_INITIAL, 'je lis ceci'), 'theme');
  const e = recevoirQuestion(base, Q('q1'));
  assert.equal(e.affiche, 'je lis ceci');
  assert.equal(e.file.length, 1);
  assert.equal(e.questionActive, null);
});

test('la même question deux fois ne compte qu’une fois', () => {
  let e = recevoirQuestion(ETAT_INITIAL, Q('q1'));
  e = recevoirQuestion(e, Q('q1'));
  assert.equal(e.file.length, 1);
});

test('une question déjà ouverte ne revient pas dans la file', () => {
  let e = ouvrirQuestion(recevoirQuestion(ETAT_INITIAL, Q('q1')), 'q1');
  e = recevoirQuestion(e, Q('q1'));
  assert.equal(e.file.length, 0);
  assert.equal(e.questionActive.id, 'q1');
});

test('la file ne dépasse jamais 10 — on garde les plus récentes', () => {
  let e = ETAT_INITIAL;
  for (let i = 0; i < 14; i += 1) e = recevoirQuestion(e, Q(`q${i}`));
  assert.equal(e.file.length, 10);
  assert.equal(e.file[0].id, 'q4');
  assert.equal(e.file[9].id, 'q13');
});

test('ouvrir une question la sort de la file et la rend active', () => {
  let e = recevoirQuestion(recevoirQuestion(ETAT_INITIAL, Q('q1')), Q('q2'));
  e = ouvrirQuestion(e, 'q2');
  assert.equal(e.questionActive.id, 'q2');
  assert.deepEqual(e.file.map((q) => q.id), ['q1']);
});

test('ouvrir une question inconnue ne change rien', () => {
  const base = recevoirQuestion(ETAT_INITIAL, Q('q1'));
  assert.deepEqual(ouvrirQuestion(base, 'fantome'), base);
});

// ── LE CŒUR : répondre à une question n’efface pas le thème ─────────────────────────

test('afficher une réponse mémorise le thème en cours — « Reprendre mon thème » le rendra', () => {
  let e = afficher(ecrire(ETAT_INITIAL, 'Le thème du jour : la respiration'), 'theme');
  e = afficher(ecrire(e, 'Bonne question Awa, voici ma réponse'), 'question');
  assert.equal(e.affiche, 'Bonne question Awa, voici ma réponse');
  assert.equal(peutReprendre(e), true);

  const repris = reprendreTexte(e);
  assert.equal(repris.affiche, 'Le thème du jour : la respiration', 'EXACTEMENT le texte d’avant');
  assert.equal(repris.brouillon, 'Le thème du jour : la respiration', 'et il est ré-éditable');
  assert.equal(repris.sourceAffichee, 'theme');
  assert.equal(peutReprendre(repris), false, 'une fois repris, le bouton n’a plus lieu d’être');
});

test('deux réponses de suite : c’est TOUJOURS le thème d’origine qu’on reprend', () => {
  let e = afficher(ecrire(ETAT_INITIAL, 'MON THÈME'), 'theme');
  e = afficher(ecrire(e, 'réponse 1'), 'question');
  e = afficher(ecrire(e, 'réponse 2'), 'question');
  assert.equal(reprendreTexte(e).affiche, 'MON THÈME');
});

test('rien à reprendre quand on n’a jamais quitté son thème', () => {
  const e = afficher(ecrire(ETAT_INITIAL, 'thème'), 'theme');
  assert.equal(peutReprendre(e), false);
  assert.deepEqual(reprendreTexte(e), e);
});

test('un écran vide n’est pas un thème à reprendre', () => {
  const e = afficher(ecrire(ETAT_INITIAL, 'une réponse'), 'question');
  assert.equal(peutReprendre(e), false);
});

// ── LE COMPTEUR DISCRET ─────────────────────────────────────────────────────────────

test('le compteur reste muet quand il n’y a rien à signaler', () => {
  assert.equal(libelleAttente(ETAT_INITIAL), '');
});

test('le compteur annonce questions et suggestion, au pluriel près', () => {
  let e = recevoirQuestion(ETAT_INITIAL, Q('q1'));
  assert.equal(libelleAttente(e), '1 question');
  e = recevoirQuestion(e, Q('q2'));
  assert.equal(libelleAttente(e), '2 questions');
  e = recevoirSuggestion(e, 'IA', null);
  assert.equal(libelleAttente(e), '2 questions · 1 suggestion prête');
});

// ── BANCS STRUCTURELS : ce que le code ne doit JAMAIS faire ─────────────────────────

const SRC = codeSeul(lire('lib', 'prompteurSources.ts'));

test('aucune fonction de suggestion n’écrit dans `affiche` — l’IA ne passe pas à l’antenne toute seule', () => {
  const bloc = SRC.slice(SRC.indexOf('export function recevoirSuggestion'), SRC.indexOf('export function recevoirQuestion'));
  assert.ok(!/affiche:/.test(bloc), 'recevoirSuggestion / utiliserSuggestion ne doivent pas toucher `affiche`');
});

test('recevoirQuestion n’écrit ni dans `affiche` ni dans `questionActive`', () => {
  const bloc = SRC.slice(SRC.indexOf('export function recevoirQuestion'), SRC.indexOf('export function ouvrirQuestion'));
  assert.ok(!/affiche:/.test(bloc));
  assert.ok(!/questionActive:/.test(bloc));
});

test('les cinq actions de rédaction promises sont là', () => {
  assert.deepEqual(ACTIONS_TEXTE.map((a) => a.cle), ['theme', 'continuer', 'raccourcir', 'developper', 'naturel']);
  ACTIONS_TEXTE.forEach((a) => assert.ok(a.libelle.length > 2));
});

test('le module reste pur : aucun accès réseau, stockage ou DOM', () => {
  assert.ok(!/fetch\(|localStorage|sessionStorage|document\.|window\./.test(SRC));
});

// ── LE PANNEAU : privé à l’hôte, et « Afficher » n’envoie rien dans le chat ─────────

const PANNEAU = codeSeul(lire('components', 'session', 'AssistantHotePanel.tsx'));

test('le panneau n’envoie JAMAIS tout seul : pas d’auto-send', () => {
  assert.ok(!/setTimeout\([^)]*envoyer/i.test(PANNEAU));
  assert.ok(!/useEffect\([^]*?onEnvoyer/.test(PANNEAU), 'aucun effet ne déclenche un envoi');
});

test('« Afficher » et « Insérer dans le chat » sont deux boutons distincts', () => {
  assert.ok(PANNEAU.includes('prompteur-afficher'));
  assert.ok(PANNEAU.includes('prompteur-inserer-chat'));
});

test('les trois sources ont chacune leur onglet', () => {
  assert.ok(PANNEAU.includes('data-testid={`prompteur-onglet-${cle}`}'), 'les onglets sont repérables');
  ["ONGLET('texte'", "ONGLET('theme'", "ONGLET('questions'"]
    .forEach((appel) => assert.ok(PANNEAU.includes(appel), `onglet manquant : ${appel}`));
});

test('la taille du texte se règle sur place (A- / A+)', () => {
  assert.ok(PANNEAU.includes('prompteur-a-moins'));
  assert.ok(PANNEAU.includes('prompteur-a-plus'));
});

test('« Reprendre mon thème » existe dans le panneau', () => {
  assert.ok(PANNEAU.includes('prompteur-reprendre'));
});

// ── LA PROVENANCE DU BROUILLON — le trou trouvé en navigateur réel ──────────────────
//
// La proposition de réponse atterrit dans « Mon texte » pour être retouchée. Sans
// mémoire de sa PROVENANCE, l'afficher écrasait le thème comme un texte tapé par
// l'hôte : « Reprendre mon thème » n'apparaissait jamais.

test('une réponse prise dans « Questions » reste une réponse une fois dans l’éditeur', () => {
  let e = afficher(ecrire(ETAT_INITIAL, 'MON THÈME'), 'theme');
  e = ouvrirQuestion(recevoirQuestion(e, Q('q1')), 'q1');
  e = utiliserSuggestion(recevoirSuggestion(e, 'Voici ma réponse', e.questionActive));
  assert.equal(e.origineBrouillon, 'question');

  e = afficher(e, e.origineBrouillon);
  assert.equal(e.affiche, 'Voici ma réponse');
  assert.equal(peutReprendre(e), true, '« Reprendre mon thème » DOIT être proposé');
  assert.equal(reprendreTexte(e).affiche, 'MON THÈME');
});

test('retoucher la réponse ne lui fait pas perdre sa nature', () => {
  let e = ouvrirQuestion(recevoirQuestion(afficher(ecrire(ETAT_INITIAL, 'THÈME'), 'theme'), Q('q1')), 'q1');
  e = utiliserSuggestion(recevoirSuggestion(e, 'réponse brute', e.questionActive));
  e = ecrire(e, 'réponse brute, reformulée à ma façon');
  assert.equal(e.origineBrouillon, 'question');
});

test('vider le champ, c’est repartir de SON texte', () => {
  let e = ouvrirQuestion(recevoirQuestion(ETAT_INITIAL, Q('q1')), 'q1');
  e = utiliserSuggestion(recevoirSuggestion(e, 'réponse', e.questionActive));
  e = ecrire(e, '   ');
  assert.equal(e.origineBrouillon, 'manuel');
});

test('une proposition de THÈME n’est pas une réponse — elle n’enterre rien', () => {
  let e = afficher(ecrire(ETAT_INITIAL, 'PREMIER THÈME'), 'theme');
  e = utiliserSuggestion(recevoirSuggestion(e, 'Deuxième formulation', null));
  assert.equal(e.origineBrouillon, 'theme');
  e = afficher(e, e.origineBrouillon);
  assert.equal(peutReprendre(e), false, 'changer de thème n’est pas une parenthèse');
});

test('le panneau affiche selon la PROVENANCE du brouillon, pas selon l’onglet', () => {
  assert.ok(PANNEAU.includes('const source = etat.origineBrouillon;'));
});
