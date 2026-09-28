/**
 * Le Live vidéo doit porter DEUX choses que le coach ne peut pas aller chercher
 * ailleurs pendant qu'il filme : son texte SUR la vidéo, et ⏮ ▶/⏸ ⏭ pour la musique.
 *
 * Ces bancs lisent les SOURCES. Ce qui est demandé n'est pas un comportement isolable
 * mais une STRUCTURE : « l'overlay est dans la zone caméra », « il n'entre dans aucun
 * flux », « il n'existe qu'un lecteur », « il n'existe qu'un prompteur ». Un test de
 * rendu ne verrait ni la duplication ni la fuite ; une lecture de source, si.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul, lister } from './lireSource.mjs';


const OVERLAY = lire('components', 'session', 'PrompteurOverlay.tsx');
const PANEL = lire('components', 'session', 'LiveVisioPanel.tsx');
const BARRE = lire('components', 'session', 'VisioControlBar.tsx');
const SESSION = lire('pages', 'SessionPage.tsx');
const STUDIO = lire('pages', 'StudioPage.tsx');
const PANNEAU = lire('components', 'session', 'PanneauPrompteur.tsx');


/* ───────────────────────── PROMPTEUR : SUR la vidéo ───────────────────────── */

test('l overlay est monté DANS la zone caméra — donc sur l aperçu du coach', () => {
  const code = codeSeul(PANEL);
  // La zone caméra est la cible du plein écran ; y poser l'overlay le fait suivre.
  assert.ok(code.includes('ref={camAreaRef}'), 'la zone caméra existe');
  assert.ok(code.includes('{!camFullscreen && prompteurNode}'),
    'hors plein écran, le texte est posé sur la grille de caméras');
  // Hors plein écran la zone doit être un repère de positionnement, sinon l'overlay
  // s'ancrerait sur un ancêtre quelconque et se retrouverait n'importe où.
  assert.ok(code.includes("'relative p-3'"), 'la zone caméra est « relative » hors plein écran');
});

test('l overlay reste visible EN PLEIN ÉCRAN', () => {
  const code = codeSeul(PANEL);
  const pleinEcran = code.split('{camFullscreen ? (')[1] || '';
  const avantSpotlight = pleinEcran.split(') : spotlightP ? (')[0];
  assert.ok(avantSpotlight.includes('{prompteurNode}'),
    'la branche plein écran rend le prompteur');
  assert.ok(code.includes('onTogglePrompteur={onTogglePrompteur}'),
    'la barre du plein écran reçoit la bascule');
  // Barre unique (28/09) : LiveControls, avec l'id historique du plein écran.
  assert.ok(lire('components', 'session', 'LiveControls.tsx').includes("'visio-fs-prompteur'"),
    'un bouton Prompteur existe dans la barre du plein écran');
});

test('le texte est en HAUT et ne masque pas tout le cadre', () => {
  const code = codeSeul(OVERLAY);
  assert.ok(code.includes('absolute inset-x-0 top-0'), 'ancré en haut, pleine largeur');
  assert.ok(code.includes('style={{ height: hauteur }}'), 'une bande, pas tout l écran');
  assert.ok(/hauteur = '58%'/.test(code), 'valeur par défaut : une bande haute du cadre');
  assert.ok(code.includes('pointer-events-none'), 'le texte ne vole pas les clics de la vidéo');
});

test('sur mobile, bande + barre restent DANS la zone caméra ; desktop inchangé', () => {
  // Mesuré en prod (390x844, 412x915, 430x932) : la bande suit `26vh`, pas la zone
  // caméra (~206-229 px) ; bande + barre (86 px sur 2 lignes) débordaient et
  // recouvraient caméra / enregistrer / Terminer. Plafond relatif à la zone caméra
  // (ancêtre `relative`) moins la place de la barre, SOUS lg seulement.
  const code = codeSeul(OVERLAY);
  assert.ok(code.includes('max-h-[calc(100%-6rem)]'),
    'sous lg, la bande est plafonnée à la zone caméra moins la barre');
  assert.ok(code.includes('lg:max-h-none'),
    'à partir de lg (isDesktop), aucun plafond : rendu desktop identique');
  assert.ok(code.includes("barre && 'max-h-[calc(100%-6rem)] lg:max-h-none'"),
    'le plafond ne vaut que lorsque la barre est affichée (/studio intact)');
  // La hauteur demandée reste la valeur inline : le plafond ne fait que la borner.
  assert.ok(code.includes('style={{ height: hauteur }}'));
  assert.ok(code.includes('absolute inset-x-0 top-full mt-1.5'), 'la barre reste sous la bande');
});

test('l overlay ne peut PAS entrer dans le flux des participants', () => {
  const code = codeSeul(OVERLAY);
  for (const interdit of [
    'captureStream', 'getUserMedia', 'MediaStream', 'canvas', 'getContext',
    'socket', 'axios', 'fetch(', 'supabase', 'emit(', 'WebSocket', 'RTCPeerConnection',
    'addTrack', 'publishTrack', 'localStorage',
  ]) {
    assert.ok(!code.includes(interdit), `PrompteurOverlay ne doit contenir aucun « ${interdit} »`);
  }
  // Et personne ne va le chercher depuis la couche média.
  for (const f of lister('hooks')) {
    assert.ok(!lire('hooks', f).includes('PrompteurOverlay'), `${f} ne doit pas connaître l overlay`);
  }
});

test('un participant n a NI panneau NI overlay', () => {
  const code = codeSeul(SESSION);
  assert.ok(/const prompteurNode = \(canShare && !liveMode\) \?/.test(code),
    'le lanceur est réservé à qui présente (hôte ou co-hôte)');
  assert.ok(/const assistantNode: React\.ReactNode = canShare \?/.test(code),
    'le panneau est réservé à qui présente (hôte ou co-hôte)');
  assert.ok(/const prompteurOverlayNode = \(canShare && prompteurSurVideo\) \?/.test(code),
    'l overlay est réservé à qui présente');
  assert.ok(/onTogglePrompteur=\{canShare \?[\s\S]{0,400}?: undefined\}/.test(code),
    'la bascule elle-même n est fournie qu à qui présente');
});

test('embed afroboost et accès direct suivent le MÊME chemin', () => {
  // Rien dans la chaîne du prompteur ne regarde le mode embed : il ne PEUT donc pas
  // se comporter différemment dans l'iframe afroboost et sur boosttribe.pro.
  for (const [nom, src] of [['PrompteurOverlay', OVERLAY], ['LiveVisioPanel', PANEL], ['VisioControlBar', BARRE]]) {
    assert.ok(!src.includes('isEmbedMode') && !src.includes('bt_embed'),
      `${nom} ne doit pas dépendre du mode embed`);
  }
  const code = codeSeul(SESSION);
  const bloc = code.slice(code.indexOf('const prompteurNode'), code.indexOf('const liveVisioNode'));
  assert.ok(!bloc.includes('isEmbedMode'), 'le montage du prompteur ne dépend pas du mode embed');
});

test('mobile ET desktop montent le panneau visio, donc l overlay', () => {
  const code = codeSeul(SESSION);
  assert.ok(code.includes('{liveVisioNode}'), 'monté dans l onglet Live (mobile)');
  assert.ok(code.includes('{liveMode && sessionId && isDesktop && liveVisioNode}'), 'monté en colonne (desktop)');
  // L'overlay voyage AVEC le panneau : une seule prop, donc les deux dispositions.
  assert.ok(code.includes('prompteurNode={prompteurOverlayNode}'));
});

/* ───────────────────────── AUDIO : ⏮ ▶/⏸ ⏭ sous les yeux ───────────────────────── */

test('les commandes musique sont DANS le Live vidéo (colonne + ⋮), plein écran compris', () => {
  // 28/09 : plus de grosse barre ⏮ ▶ ⏭ posée sous la scène — Play/Pause dans la colonne de
  // la barre Live (même composant dans les deux modes), ⏮ ⏭ dans son ⋮.
  const code = codeSeul(SESSION);
  assert.ok(code.includes('lecture={lectureLive}'), 'le panneau visio reçoit la lecture');
  const p = codeSeul(PANEL);
  assert.ok(p.includes('lecture={lecture}'), 'transmise à LA barre (LiveControls)');
  assert.ok(!p.includes('audioNode'), 'aucune seconde barre musique');
});

test('⏮ et ⏭ réutilisent LES gestionnaires du lecteur — aucun second moteur', () => {
  const code = codeSeul(SESSION);
  assert.ok(code.includes('() => handlePlayerPrevious(audioState?.currentTime ?? 0)'));
  assert.ok(code.includes('onSuivant: miniAudioSuivante ? handlePlayerNext : undefined'));
  // L'ancienne navigation parallèle du mini-contrôle a disparu.
  assert.ok(!code.includes('handleMiniTrackNav'), 'plus de seconde mécanique de sélection');
  // Un seul lecteur audio dans la page.
  assert.equal((code.match(/<AudioPlayer/g) || []).length, 1, 'un seul <AudioPlayer>');
  assert.equal((code.match(/const lectureLive/g) || []).length, 1, 'une seule commande de lecture');
});

test('premier / dernier morceau : les MÊMES règles décident de ⏮ / ⏭ (items du menu ⋮)', () => {
  const code = codeSeul(SESSION);
  assert.ok(code.includes("onPrecedent: miniAudioPrecedent === 'rien' ? undefined :"), '⏮ absent quand il n y a rien avant');
  assert.ok(code.includes('onSuivant: miniAudioSuivante ?'), '⏭ absent au dernier morceau');
});

test('la décision de ⏮ vient d actionPrecedent, pas d un seuil recopié', () => {
  const code = codeSeul(SESSION);
  assert.ok(code.includes('actionPrecedent(audioState?.currentTime ?? 0, miniAudioAPrecedente)'),
    'la MÊME fonction décide de l action et de l état du bouton');
  // Aucun « 3 » recopié à la main dans le mini-contrôle.
  const bloc = code.slice(code.indexOf('const miniAudioIndex'), code.indexOf('const liveVisioNode'));
  assert.ok(!/>\s*3\b/.test(bloc), 'le seuil de 3 s n est pas réécrit ici');
});

/* ───────────────────────── UN SEUL PROMPTEUR ───────────────────────── */

test('un seul usePrompteur dans la session : panneau et overlay partagent l instance', () => {
  const code = codeSeul(SESSION);
  assert.equal((code.match(/usePrompteur\(/g) || []).length, 1, 'appelé une seule fois');
  assert.ok(code.includes('usePrompteur(false)'), 'raccourcis OFF : l espace reste au lecteur audio');
  assert.ok(/<AssistantHotePanel[\s\S]*?p=\{prompteur\}/.test(code), 'le panneau reçoit l instance');
  assert.ok(code.includes('p={prompteur}'), 'l overlay reçoit la MÊME instance');
  // Ni le panneau ni l'overlay ne rappellent le hook.
  for (const [nom, src] of [['PanneauPrompteur', PANNEAU], ['PrompteurOverlay', OVERLAY]]) {
    assert.ok(!/\busePrompteur\(/.test(codeSeul(src)), `${nom} ne crée pas sa propre instance`);
  }
});

test('une seule PRÉSENTATION du texte sur la vidéo : /studio et la session la partagent', () => {
  assert.ok(STUDIO.includes("from '@/components/session/PrompteurOverlay'"), '/studio utilise l overlay');
  assert.ok(SESSION.includes("from '@/components/session/PrompteurOverlay'"), 'la session utilise l overlay');
  // /studio ne remonte plus son propre affichage de texte sur la vidéo.
  assert.ok(!/<Prompteur\b/.test(codeSeul(STUDIO)), '/studio ne redéclare pas l affichage');
  assert.equal((codeSeul(OVERLAY).match(/export const PrompteurOverlay/g) || []).length, 1);
});

test('le panneau reste le lieu de PRÉPARATION et renvoie vers la caméra', () => {
  const UNIQUE = lire('components', 'session', 'AssistantHotePanel.tsx');
  assert.ok(UNIQUE.includes('prompteur-editeur'), 'on y écrit son texte');
  assert.ok(UNIQUE.includes('prompteur-sur-video'), 'et on y bascule vers l affichage caméra');
  assert.ok(codeSeul(SESSION).includes('onSurVideo={setPrompteurSurVideo}'));
});
