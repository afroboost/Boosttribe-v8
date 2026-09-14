/**
 * Deux garanties que la panne du 10/09/2026 a rendues indispensables.
 *
 * 1. LA CAMÉRA. Ce jour-là, « Allumer la caméra » ne produisait RIEN : ni image, ni
 *    message. La cause était côté serveur (le SFU refusait la clé `APIboosttribe`),
 *    mais le code la rendait INVISIBLE : `startCamera` mettait la demande en attente
 *    et répondait « oui ». On a donc cherché des heures une régression dans le code
 *    de la caméra. Ces bancs verrouillent le contraire : un échec se DIT.
 *
 * 2. LE PROMPTEUR. Le texte s'affichait sur la vidéo, mais il n'existait aucun endroit
 *    où l'ÉCRIRE une fois en Live vidéo — l'overlay invitait à écrire « ci-dessous »
 *    alors qu'en plein écran il n'y a pas de « ci-dessous ».
 *
 * Bancs STRUCTURELS (lecture des sources) : ce qui est demandé n'est pas isolable en
 * test de rendu (pas de caméra, pas de SFU, pas de plein écran dans `node --test`),
 * mais parfaitement lisible dans le code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';


const HOOK_LK = lire('hooks', 'useLiveKitStage.ts');
const PANEL = lire('components', 'session', 'LiveVisioPanel.tsx');
const OVERLAY = lire('components', 'session', 'PrompteurOverlay.tsx');
const TIROIR = lire('components', 'session', 'TiroirPrompteur.tsx');
const TUILE = lire('components', 'session', 'CameraTile.tsx');
const SESSION = lire('pages', 'SessionPage.tsx');


/* ═════════════════════ CAMÉRA — un échec doit se VOIR ═════════════════════ */

test('serveur vidéo injoignable : startCamera répond NON, il ne fait pas semblant', () => {
  const code = codeSeul(HOOK_LK);
  assert.ok(code.includes("if (connexionRef.current === 'echec') return false;"),
    'une connexion en échec ne peut pas rendre un succès');
  // L'état existe et couvre les trois issues.
  for (const etat of ["'en-cours'", "'connectee'", "'echec'"]) {
    assert.ok(code.includes(`setConnexion(${etat})`), `l'état ${etat} est posé quelque part`);
  }
  assert.ok(/connexion,/.test(code.slice(code.lastIndexOf('return {'))), 'l’état est exposé à l’écran');
});

test('les deux causes d échec caméra ne disent PAS la même chose', () => {
  const code = codeSeul(SESSION);
  assert.ok(code.includes("videoMesh.connexion === 'echec'"),
    'la page distingue « serveur injoignable » de « permission refusée »');
  assert.ok(/Serveur vidéo injoignable/.test(code), 'message serveur explicite');
  assert.ok(/autorisez l\\?'accès/.test(code), 'message permission conservé');
  // Le message serveur dit aussi ce qu'il ne FAUT PAS faire (chercher une permission).
  assert.ok(/pas une autorisation/.test(code));
});

test('le panneau affiche l échec, il ne le garde pas pour lui', () => {
  const code = codeSeul(PANEL);
  assert.ok(code.includes("connexionScene === 'echec'"), 'bandeau conditionné à l’échec');
  assert.ok(code.includes('data-testid="visio-connexion-echec"'));
  assert.ok(codeSeul(SESSION).includes('connexionScene={videoMesh.connexion}'), 'la page le renseigne');
});

/* ═════════════════ CAMÉRA — le prompteur ne doit rien lui prendre ═════════════════ */

test('le bouton caméra n est JAMAIS sous l overlay du prompteur', () => {
  const code = codeSeul(PANEL);
  // Hors plein écran : la barre de contrôle est rendue APRÈS la zone caméra, donc
  // hors de portée d'un overlay ancré dans cette zone.
  const finZone = code.indexOf('{!camFullscreen && prompteurTiroirNode}');
  const boutonCam = code.indexOf('data-testid="visio-camera-toggle"');
  assert.ok(finZone > 0 && boutonCam > finZone, 'le bouton caméra est hors de la zone caméra');
  // En plein écran : la barre de contrôles passe DEVANT l'overlay (z plus grand).
  const zOverlay = Number(/z-\[(\d+)\]/.exec(codeSeul(OVERLAY))[1]);
  const zBarre = Number(/absolute z-\[(\d+)\]/.exec(codeSeul(lire('components', 'session', 'VisioControlBar.tsx')))[1]);
  assert.ok(zBarre > zOverlay, `la barre (${zBarre}) doit passer devant l’overlay (${zOverlay})`);
});

test('l overlay laisse passer les clics : il ne capte que sa propre barre', () => {
  const code = codeSeul(OVERLAY);
  const racine = code.slice(code.indexOf('data-testid="prompteur-overlay"') - 400, code.indexOf('data-testid="prompteur-overlay"'));
  assert.ok(racine.includes('pointer-events-none'), 'la racine de l’overlay ne prend aucun clic');
  // Ce qui reprend les clics est explicite et limité.
  assert.ok(code.includes('pointer-events-auto'), 'seules les commandes reprennent les clics');
});

test('afficher ou fermer le prompteur ne touche jamais la caméra', () => {
  for (const [nom, src] of [['PrompteurOverlay', OVERLAY], ['TiroirPrompteur', TIROIR]]) {
    const code = codeSeul(src);
    for (const interdit of [
      'stopCamera', 'startCamera', 'getUserMedia', 'MediaStream', 'srcObject',
      'getTracks', 'videoMesh', 'localStream', 'captureStream', 'canvas',
      'socket', 'axios', 'fetch(', 'supabase', 'addTrack', 'publishTrack', 'localStorage',
    ]) {
      assert.ok(!code.includes(interdit), `${nom} ne doit contenir aucun « ${interdit} »`);
    }
  }
  // Fermer, côté page, ne fait QUE changer un état d'affichage.
  const code = codeSeul(SESSION);
  assert.ok(code.includes('onFermer={() => setPrompteurSurVideo(false)}'));
  assert.ok(code.includes('onFermer={() => setPrompteurEnEdition(false)}'));
});

test('le prompteur ne remonte pas les vignettes caméra : il est leur VOISIN', () => {
  const code = codeSeul(PANEL);
  // Dans le RENDU (pas la signature des props), `prompteurNode` n'est jamais la
  // condition d'affichage d'une vignette : il en est le frère.
  const rendu = code.slice(code.indexOf('return ('));
  for (const m of rendu.matchAll(/prompteurNode/g)) {
    const suite = rendu.slice(m.index, m.index + 200);
    assert.ok(!/\btileFor\b|\bCameraTile\b/.test(suite.split('}')[0] + suite.split('}')[1] || ''),
      'aucune vignette n’est rendue à l’intérieur d’une condition portant le prompteur');
  }
  assert.ok(!/prompteurNode\s*(\?\s|&&)\s*\(?\s*(tileFor|<CameraTile)/.test(rendu),
    'le prompteur ne conditionne jamais le rendu d’une vignette');
  assert.ok(code.includes('{!camFullscreen && prompteurNode}'));
  // La vignette, elle, est le seul endroit qui branche un flux sur une balise vidéo.
  assert.ok(codeSeul(TUILE).includes('srcObject'), 'CameraTile branche le flux sur le <video>');
  assert.ok(!codeSeul(PANEL).includes('srcObject'), 'le panneau ne double pas ce branchement');
});

test('publier la caméra passe par LiveKit, pas par un chemin parallèle', () => {
  const code = codeSeul(HOOK_LK);
  assert.ok(code.includes('setCameraEnabled(true'), 'activation via LiveKit');
  assert.equal((code.match(/getUserMedia/g) || []).length, 1,
    'un seul getUserMedia : la sonde de libellés, jamais un second chemin d’ouverture');
});

/* ═════════════════════ PROMPTEUR — écrire sans quitter le direct ═════════════════════ */

test('il existe une zone de saisie ATTEIGNABLE depuis le Live vidéo', () => {
  assert.ok(TIROIR.includes('data-testid="prompteur-tiroir-script"'), 'le tiroir porte un textarea');
  assert.ok(TIROIR.includes('<textarea'));
  const code = codeSeul(PANEL);
  assert.ok(code.includes('{prompteurTiroirNode}'), 'monté dans le plein écran');
  assert.ok(code.includes('{!camFullscreen && prompteurTiroirNode}'), 'monté hors plein écran');
});

test('le tiroir est DANS la zone caméra — sinon il n existe pas en plein écran', () => {
  const code = codeSeul(PANEL);
  const debutZone = code.indexOf('ref={camAreaRef}');
  const finZone = code.indexOf('data-testid="visio-audio"');
  const positions = [...code.matchAll(/prompteurTiroirNode\}/g)].map((m) => m.index);
  assert.ok(positions.length >= 2, 'monté aux deux endroits');
  for (const i of positions) {
    assert.ok(i > debutZone && i < finZone, 'chaque montage est à l’intérieur de la zone caméra');
  }
});

test('script vide : un message ET un moyen d écrire, pas une invitation en l air', () => {
  const code = codeSeul(OVERLAY);
  assert.ok(code.includes("onEditer && !p.script.trim()"), 'l’état vide est traité');
  assert.ok(code.includes('data-testid="prompteur-overlay-ajouter"'), 'bouton « Ajouter mon texte »');
  assert.ok(code.includes("Aucun texte pour l'instant"), 'message explicite');
  // Et ce bloc reprend les clics, sinon le bouton serait décoratif.
  const bloc = code.slice(code.indexOf('prompteur-overlay-vide') - 300, code.indexOf('prompteur-overlay-ajouter'));
  assert.ok(bloc.includes('pointer-events-auto'), 'le bouton est réellement cliquable');
});

test('demander le prompteur sans texte ouvre de quoi écrire', () => {
  const code = codeSeul(SESSION);
  assert.ok(code.includes('const vide = !prompteur.script.trim();'));
  assert.ok(code.includes('if (vide) setPrompteurEnEdition(true);'),
    'ouvrir un cadre vide sans clavier n’aiderait personne');
});

test('le texte s enregistre en frappant — aucune étape « valider » à oublier', () => {
  const code = codeSeul(TIROIR);
  assert.ok(code.includes('onChange={(e) => p.setScript(e.target.value)}'),
    'chaque frappe passe par l’instance partagée');
  // La persistance reste l'affaire du hook, à un seul endroit.
  assert.ok(!code.includes('bt_studio_script'));
  assert.ok(lire('hooks', 'usePrompteur.ts').includes("'bt_studio_script'"));
});

test('trois surfaces, UNE instance : panneau, overlay, tiroir', () => {
  const code = codeSeul(SESSION);
  assert.equal((code.match(/usePrompteur\(/g) || []).length, 1, 'un seul appel au hook');
  for (const m of ['<PanneauPrompteur p={prompteur}', '<TiroirPrompteur p={prompteur}', 'p={prompteur}']) {
    assert.ok(code.includes(m), `la même instance est passée (${m})`);
  }
  for (const [nom, src] of [['PrompteurOverlay', OVERLAY], ['TiroirPrompteur', TIROIR]]) {
    assert.ok(!/\busePrompteur\(/.test(codeSeul(src)), `${nom} ne crée pas sa propre instance`);
  }
});

test('mobile : la feuille tient compte du clavier, avec un repli réel', () => {
  assert.ok(TIROIR.includes('items-end'), 'ancrée en bas — au-dessus du clavier');
  assert.ok(TIROIR.includes('max-h-[88vh]'), 'repli pour les navigateurs sans dvh');
  assert.ok(TIROIR.includes('supports-[height:1dvh]:max-h-[88dvh]'),
    'la hauteur suit la fenêtre visible quand le clavier s’ouvre');
  assert.ok(TIROIR.includes('text-base'), 'police ≥ 16 px : pas de zoom forcé au focus sur mobile');
});

test('embed et accès direct : le tiroir ne connaît pas le mode embed', () => {
  for (const [nom, src] of [['TiroirPrompteur', TIROIR], ['PrompteurOverlay', OVERLAY], ['LiveVisioPanel', PANEL]]) {
    assert.ok(!src.includes('isEmbedMode') && !src.includes('bt_embed'), `${nom} est indépendant de l’embed`);
  }
});
