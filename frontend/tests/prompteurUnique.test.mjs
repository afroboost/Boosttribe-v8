/**
 * 📝 UN SEUL PROMPTEUR — un panneau, quatre onglets, et des questions qui en sont vraiment.
 *
 * Trois garanties, chacune née d'un défaut constaté :
 *   1. LE BRUIT. Tout message du chat d'un autre participant entrait dans la file des
 *      questions. Désormais, seul un message MARQUÉ `question: true` (le spectateur a
 *      choisi « Poser une question ») en devient une.
 *   2. LA CONSERVATION. Le coach lit son thème, une question arrive, il la traite, il
 *      revient : son thème, son texte et sa position de lecture sont là où il les a laissés.
 *   3. L'IA PROPOSE, L'HÔTE DÉCIDE. Aucun envoi, aucune réponse, aucune voix, aucun
 *      remplacement automatique : une suggestion n'entre dans « Mon texte » qu'après un clic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ETAT_INITIAL, ecrire, afficher, recevoirSuggestion, utiliserSuggestion, ignorerSuggestion,
  recevoirQuestion, ouvrirQuestion, reprendreTexte, peutReprendre,
  messageVersQuestion, recevoirMessages, retirerQuestion, selectionnerQuestion, afficherQuestion,
  heureQuestion, etatInitialDepuisScript, LONGUEUR_MAX_QUESTION, ONGLETS_PROMPTEUR,
} from './.build/prompteurSources.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const MOI = 'hote-1';
const msg = (o = {}) => ({ id: 'm1', name: 'Awa', text: 'Comment on respire ?', userId: 'u-awa', ts: 1758000000000, question: true, ...o });

/* ═══════════ 1. messageVersQuestion — seul un message MARQUÉ devient une question ═══════════ */

test('un message marqué question devient une question, avec son heure', () => {
  const q = messageVersQuestion(msg(), MOI);
  assert.deepEqual(q, { id: 'm1', auteur: 'Awa', texte: 'Comment on respire ?', ts: 1758000000000 });
});

test('un message ordinaire du chat n’est PAS une question — fini le bruit', () => {
  assert.equal(messageVersQuestion(msg({ question: undefined }), MOI), null);
  assert.equal(messageVersQuestion(msg({ question: false }), MOI), null);
  // Une chaîne « true » n'est pas le signal : seul le booléen l'est.
  assert.equal(messageVersQuestion(msg({ question: 'true' }), MOI), null);
});

test('mes propres messages ne sont jamais des questions', () => {
  assert.equal(messageVersQuestion(msg({ userId: MOI }), MOI), null);
});

test('un texte vide ou blanc n’est pas une question', () => {
  assert.equal(messageVersQuestion(msg({ text: '' }), MOI), null);
  assert.equal(messageVersQuestion(msg({ text: '   \n ' }), MOI), null);
  assert.equal(messageVersQuestion(msg({ text: undefined }), MOI), null);
  assert.equal(messageVersQuestion(null, MOI), null);
});

test('le texte est borné et nettoyé ; l’auteur a un repli', () => {
  const long = 'x'.repeat(LONGUEUR_MAX_QUESTION + 200);
  const q = messageVersQuestion(msg({ text: `  ${long}  `, name: '' }), MOI);
  assert.equal(q.texte.length, LONGUEUR_MAX_QUESTION);
  assert.equal(q.auteur, 'Participant');
  assert.ok(LONGUEUR_MAX_QUESTION >= 300 && LONGUEUR_MAX_QUESTION <= 600);
});

test('sans id, un identifiant STABLE est fabriqué (même message → même id)', () => {
  const a = messageVersQuestion(msg({ id: undefined }), MOI);
  const b = messageVersQuestion(msg({ id: undefined }), MOI);
  assert.ok(a.id && a.id === b.id);
});

test('seuls auteur, texte, heure et id sortent — rien d’autre du message', () => {
  const q = messageVersQuestion(msg({ photoUrl: 'https://cdn/p.jpg', email: 'a@b.c' }), MOI);
  assert.deepEqual(Object.keys(q).sort(), ['auteur', 'id', 'texte', 'ts']);
});

/* ═══════════ 2. recevoirMessages — toute la rafale, sans doublon, sans retour ═══════════ */

test('une rafale de messages : TOUTES les questions entrent, pas seulement la dernière', () => {
  const e = recevoirMessages(ETAT_INITIAL, [
    msg({ id: 'a' }), msg({ id: 'b', question: false }), msg({ id: 'c' }), msg({ id: 'd', userId: MOI }),
  ], MOI);
  assert.deepEqual(e.file.map((q) => q.id), ['a', 'c']);
});

test('rien de nouveau → le MÊME objet est rendu (aucune boucle de rendu)', () => {
  const e1 = recevoirMessages(ETAT_INITIAL, [msg({ id: 'a' })], MOI);
  assert.equal(recevoirMessages(e1, [msg({ id: 'a' })], MOI), e1);
  assert.equal(recevoirMessages(ETAT_INITIAL, [msg({ question: false })], MOI), ETAT_INITIAL);
  assert.equal(recevoirMessages(ETAT_INITIAL, null, MOI), ETAT_INITIAL);
});

test('une question traitée ne revient pas quand la liste des messages est relue', () => {
  let e = recevoirMessages(ETAT_INITIAL, [msg({ id: 'a' })], MOI);
  e = ouvrirQuestion(e, 'a');
  e = ignorerSuggestion(recevoirSuggestion(e, 'réponse', e.questionActive));
  e = retirerQuestion(e, 'a');
  const relu = recevoirMessages(e, [msg({ id: 'a' })], MOI);
  assert.equal(relu.file.length, 0, 'déjà vue : elle ne revient pas');
});

test('recevoirQuestion dédoublonne par id', () => {
  let e = recevoirQuestion(ETAT_INITIAL, { id: 'q', auteur: 'A', texte: 't' });
  e = recevoirQuestion(e, { id: 'q', auteur: 'A', texte: 't' });
  assert.equal(e.file.length, 1);
});

/* ═══════════ 3. retirerQuestion — le message a été supprimé du chat ═══════════ */

test('retirer une question de la file', () => {
  const e = retirerQuestion(recevoirMessages(ETAT_INITIAL, [msg({ id: 'a' }), msg({ id: 'b' })], MOI), 'a');
  assert.deepEqual(e.file.map((q) => q.id), ['b']);
});

test('retirer la question sélectionnée efface aussi la réponse qui la visait — pas le thème', () => {
  let e = afficher(ecrire(ETAT_INITIAL, 'MON THÈME'), 'theme');
  e = selectionnerQuestion(recevoirMessages(e, [msg({ id: 'a' })], MOI), 'a');
  e = recevoirSuggestion(e, 'réponse à a', e.questionActive);
  e = retirerQuestion(e, 'a');
  assert.equal(e.questionActive, null);
  assert.equal(e.suggestion, null);
  assert.equal(e.affiche, 'MON THÈME');
  assert.equal(e.brouillon, 'MON THÈME');
});

test('retirer une question inconnue rend le même état', () => {
  const e = recevoirMessages(ETAT_INITIAL, [msg({ id: 'a' })], MOI);
  assert.equal(retirerQuestion(e, 'zzz'), e);
});

/* ═══════════ 4. sélectionner, afficher la question, préparer — sans rien écraser ═══════════ */

test('sélectionner une question : elle devient active, l’ancienne retourne dans la file', () => {
  let e = recevoirMessages(ETAT_INITIAL, [msg({ id: 'a' }), msg({ id: 'b' })], MOI);
  e = selectionnerQuestion(e, 'a');
  assert.equal(e.questionActive.id, 'a');
  e = selectionnerQuestion(e, 'b');
  assert.equal(e.questionActive.id, 'b');
  assert.deepEqual(e.file.map((q) => q.id), ['a'], 'a n’est pas perdue');
});

test('sélectionner ne touche ni « Mon texte » ni l’écran ni une suggestion de THÈME', () => {
  let e = afficher(ecrire(ETAT_INITIAL, 'thème affiché'), 'theme');
  e = ecrire(e, 'mon brouillon');
  e = recevoirSuggestion(e, 'proposition de thème', null);
  e = selectionnerQuestion(recevoirMessages(e, [msg({ id: 'a' })], MOI), 'a');
  assert.equal(e.brouillon, 'mon brouillon');
  assert.equal(e.affiche, 'thème affiché');
  assert.equal(e.suggestion, 'proposition de thème');
  // Et utiliser cette suggestion en fait un THÈME, pas une réponse.
  assert.equal(utiliserSuggestion(e).origineBrouillon, 'theme');
});

test('« Afficher sur le prompteur » une question : l’écran change, « Mon texte » NON', () => {
  let e = afficher(ecrire(ETAT_INITIAL, 'MON THÈME'), 'theme');
  e = ecrire(e, 'brouillon en cours');
  e = selectionnerQuestion(recevoirMessages(e, [msg({ id: 'a' })], MOI), 'a');
  e = afficherQuestion(e);
  assert.ok(e.affiche.includes('Comment on respire ?'));
  assert.ok(e.affiche.includes('Awa'));
  assert.equal(e.sourceAffichee, 'question');
  assert.equal(e.brouillon, 'brouillon en cours', 'aucun écrasement de « Mon texte »');
  assert.equal(peutReprendre(e), true);
  assert.equal(reprendreTexte(e).affiche, 'MON THÈME');
});

test('afficherQuestion sans question sélectionnée ne change rien', () => {
  assert.equal(afficherQuestion(ETAT_INITIAL), ETAT_INITIAL);
});

/* ═══════════ 5. LE SCÉNARIO DU COACH, de bout en bout ═══════════ */

test('scénario : thème lu → question → sélection → IA prépare → retour thème : tout est là', () => {
  // Le coach lit son thème.
  let e = afficher(ecrire(ETAT_INITIAL, 'Le thème du jour : la respiration'), 'theme');
  const lu = e.affiche;
  // Une question arrive — dans la file, jamais à l'écran.
  e = recevoirMessages(e, [msg({ id: 'q1' })], MOI);
  assert.equal(e.affiche, lu);
  // Il la sélectionne ; l'IA prépare une réponse : PROPOSÉE, pas appliquée.
  e = selectionnerQuestion(e, 'q1');
  e = recevoirSuggestion(e, 'Inspire par le nez…', e.questionActive);
  assert.equal(e.affiche, lu, 'la suggestion ne passe pas à l’écran');
  assert.equal(e.brouillon, 'Le thème du jour : la respiration', 'ni dans « Mon texte »');
  // Il ne l'utilise pas encore et revient à son thème : intact.
  assert.equal(e.affiche, lu);
  // Il l'utilise : elle entre dans « Mon texte » seulement maintenant.
  const pris = utiliserSuggestion(e);
  assert.equal(pris.brouillon, 'Inspire par le nez…');
  assert.equal(pris.affiche, lu, 'toujours pas à l’écran sans « Afficher »');
});

/* ═══════════ 6. etatInitialDepuisScript — le script sauvegardé n'est plus effacé ═══════════ */

test('le script déjà sauvegardé est repris comme brouillon ET texte affiché', () => {
  const e = etatInitialDepuisScript('Mon script d’hier');
  assert.equal(e.brouillon, 'Mon script d’hier');
  assert.equal(e.affiche, 'Mon script d’hier');
  assert.equal(e.sourceAffichee, 'manuel');
  assert.equal(e.origineBrouillon, 'manuel');
});

test('aucun script → l’état initial vide, sans source', () => {
  assert.deepEqual(etatInitialDepuisScript(''), ETAT_INITIAL);
  assert.deepEqual(etatInitialDepuisScript(null), ETAT_INITIAL);
  assert.deepEqual(etatInitialDepuisScript('   '), ETAT_INITIAL);
});

/* ═══════════ 7. heureQuestion ═══════════ */

test('l’heure s’affiche en HH:MM', () => {
  assert.equal(heureQuestion(new Date(2026, 8, 28, 9, 5).getTime()), '09:05');
  assert.equal(heureQuestion(new Date(2026, 8, 28, 21, 47).getTime()), '21:47');
  assert.equal(heureQuestion(undefined), '');
  assert.equal(heureQuestion(Number.NaN), '');
});

/* ═══════════ 8. BANCS STRUCTURELS — le panneau unique ═══════════ */

const PANNEAU = codeSeul(lire('components', 'session', 'AssistantHotePanel.tsx'));
const BRUT = lire('components', 'session', 'AssistantHotePanel.tsx');

test('quatre onglets : Mon texte, Thème IA, Questions, Assistant IA', () => {
  assert.deepEqual(ONGLETS_PROMPTEUR.map((o) => o.cle), ['texte', 'theme', 'questions', 'assistant']);
  assert.deepEqual(ONGLETS_PROMPTEUR.map((o) => o.libelle), ['Mon texte', 'Thème IA', 'Questions', 'Assistant IA']);
  assert.ok(PANNEAU.includes("ONGLET('assistant'"), 'onglet Assistant IA rendu');
  assert.ok(PANNEAU.includes('role="tablist"') && PANNEAU.includes('role="tab"') && PANNEAU.includes('aria-selected'));
});

test('l’interrupteur IA vit DANS l’onglet Assistant IA', () => {
  const i = PANNEAU.indexOf("onglet === 'assistant' && (");
  assert.ok(i > 0, 'le contenu de l’onglet assistant existe');
  const bloc = PANNEAU.slice(i, i + 3000);
  assert.ok(bloc.includes('data-testid="assistant-bascule"'), 'la bascule IA est dans l’onglet');
  assert.ok(bloc.includes('data-testid="assistant-etat"'), 'l’état de l’assistant y est lisible');
});

test('la position de défilement est mémorisée PAR onglet et restaurée', () => {
  assert.ok(/useRef<Record<OngletPrompteur, number>>/.test(PANNEAU), 'une mémoire par onglet');
  assert.ok(PANNEAU.includes('useLayoutEffect('), 'restaurée avant l’affichage (pas de saut visible)');
  assert.ok(PANNEAU.includes('onScroll='), 'la position est relevée au défilement');
});

test('Échap ferme le panneau sans remonter à la page (le plein écran reste)', () => {
  const i = PANNEAU.indexOf("e.key === 'Escape'");
  assert.ok(i > 0);
  const bloc = PANNEAU.slice(i, i + 160);
  assert.ok(bloc.includes('stopPropagation') && bloc.includes('onClose'));
});

test('dans la zone caméra : feuille compacte, translucide, bornée, défilement interne', () => {
  assert.ok(PANNEAU.includes("disposition === 'zone-camera'"));
  assert.ok(PANNEAU.includes('max-h-[55%]'), 'mobile : ne masque pas tout l’hôte');
  assert.ok(PANNEAU.includes('w-[24rem]'), 'desktop : ~24rem de large');
  assert.ok(/absolute[^'"]*overflow-y-auto|overflow-y-auto[^'"]*absolute/.test(PANNEAU), 'défilement interne');
  assert.ok(PANNEAU.includes('backdrop-blur'), 'translucide');
});

test('les cibles tactiles font au moins 44 px', () => {
  assert.ok(/const BTN_TAILLE = 'w-11 h-11/.test(PANNEAU));
  assert.ok(/const BTN = '[^']*min-h-\[44px\]/.test(PANNEAU), 'les boutons texte aussi');
  assert.ok(/const ONGLET_CLS = '[^']*min-h-\[44px\]/.test(PANNEAU), 'les onglets aussi');
});

test('réglages de lecture via l’instance PARTAGÉE `p` — jamais un second prompteur', () => {
  ['prompteur-lecture-play', 'prompteur-vitesse-moins', 'prompteur-vitesse-plus', 'prompteur-miroir',
   'prompteur-sur-video', 'prompteur-a-moins', 'prompteur-a-plus']
    .forEach((id) => assert.ok(PANNEAU.includes(`data-testid="${id}"`), `réglage manquant : ${id}`));
  assert.ok(PANNEAU.includes('p.basculerLecture') && PANNEAU.includes('p.setMiroir'));
  assert.ok(!/\busePrompteur\(/.test(PANNEAU), 'aucune seconde instance');
  for (const interdit of ['socket', 'axios', 'fetch(', 'supabase', 'localStorage', 'bt_studio_script', 'speechSynthesis', 'SpeechSynthesis']) {
    assert.ok(!PANNEAU.includes(interdit), `le panneau ne contient aucun « ${interdit} »`);
  }
});

test('onglet Questions : auteur, question, heure, et les trois gestes', () => {
  const i = PANNEAU.indexOf("onglet === 'questions' && (");
  const bloc = PANNEAU.slice(i, PANNEAU.indexOf("onglet === 'assistant' && ("));
  assert.ok(bloc.includes('heureQuestion('), 'l’heure HH:MM');
  assert.ok(bloc.includes('q.auteur') && bloc.includes('q.texte'));
  ['prompteur-question-selectionner', 'prompteur-question-afficher', 'prompteur-question-preparer']
    .forEach((id) => assert.ok(bloc.includes(id), `geste manquant : ${id}`));
});

test('l’IA PROPOSE seulement : aucun effet ne remplace le texte ni n’envoie', () => {
  // Aucun effet du panneau n'appelle un rappel qui modifie le texte ou déclenche l'IA.
  const effets = PANNEAU.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\);|useLayoutEffect\([\s\S]*?\}, \[[^\]]*\]\);/g) || [];
  for (const eff of effets) {
    for (const interdit of ['onUtiliserSuggestion', 'onEcrire', 'onAfficher', 'onDemanderTexte', 'onPreparerReponse', 'onOuvrirQuestion', 'onInsererChat']) {
      assert.ok(!eff.includes(interdit), `un effet appelle ${interdit} — ce doit être un clic`);
    }
  }
  assert.ok(!/onSend|sendMessage|handleSendGroup/.test(PANNEAU));
  // La suggestion ne devient le brouillon QUE par le bouton « Utiliser ».
  const i = PANNEAU.indexOf('onClick={onUtiliserSuggestion}');
  assert.ok(i > 0 && PANNEAU.slice(i, i + 300).includes('prompteur-utiliser'));
});

test('aucune couleur codée en dur dans le panneau (hex)', () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(PANNEAU), 'pas de #hex : var(--bt-accent) ou blanc/noir translucides');
});

test('les surfaces remplacées sont signalées comme à ne plus rendre', () => {
  assert.ok(lire('components', 'session', 'PanneauPrompteur.tsx').includes('@deprecated'));
  assert.ok(lire('components', 'session', 'TiroirPrompteur.tsx').includes('@deprecated'));
  assert.ok(BRUT.includes('PanneauPrompteurUnique'), 'le panneau unique est exporté sous un nom explicite');
});
