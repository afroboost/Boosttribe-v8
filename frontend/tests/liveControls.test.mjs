/**
 * 🎛️ BARRE DE COMMANDES LIVE UNIQUE (28/09/2026) — refonte UX « Live mobile ».
 *
 * Avant : une rangée d'icônes sous la vidéo (vue normale) ET une colonne verticale à
 * droite (plein écran, VisioControlBar) — deux barres, deux jeux de boutons, un bouton
 * Assistant séparé. Attendu : UNE barre (LiveControls), en bas de la vidéo, la même dans
 * les deux modes ; le secondaire dans ⋮ ; des calques chat / réactions / champ posés
 * DANS la zone caméra ; tailles calculées par des fonctions pures.
 *
 * Deux bancs : LOGIQUE (lib/liveControls.ts transpilée) et STRUCTUREL (lecture des sources).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';
import {
  repartirCommandes, zoneCommentaires, ORDRE_COMMANDES, PRIORITE_COMMANDES,
  TAILLE_BOUTON, ESPACE_BOUTONS, MARGE_BARRE, LARGEUR_PILULE,
} from './.build/liveControls.mjs';

const PANEL = codeSeul(lire('components', 'session', 'LiveVisioPanel.tsx'));
const PANEL_BRUT = lire('components', 'session', 'LiveVisioPanel.tsx');
const LC = codeSeul(lire('components', 'session', 'LiveControls.tsx'));
const ADAPT = codeSeul(lire('components', 'session', 'VisioControlBar.tsx'));

const HOTE_PLEIN_ECRAN = ['micro', 'camera', 'partage', 'record', 'prompteur', 'diffusion', 'demandes', 'terminer', 'reduire'];
const LARGEURS = [360, 390, 414, 430, 768, 1280, 1440];

/* ═════════════════════════ LOGIQUE : repartirCommandes ═════════════════════════ */

const largeurBarre = (barre, largeurs = {}) =>
  MARGE_BARRE + TAILLE_BOUTON /* ⋮ */ + barre.reduce((t, c) => t + (largeurs[c] ?? TAILLE_BOUTON) + ESPACE_BOUTONS, 0);

test('aucune largeur ne déborde : ce qui ne tient pas descend dans ⋮', () => {
  for (const l of LARGEURS) {
    const { barre, menu } = repartirCommandes(HOTE_PLEIN_ECRAN, l);
    assert.ok(largeurBarre(barre) <= l, `${l} px : barre ${largeurBarre(barre)} px`);
    assert.deepEqual([...barre, ...menu].sort(), [...HOTE_PLEIN_ECRAN].sort(), `${l} px : rien ne se perd`);
  }
  // Pilule spectateur (« Demander à monter en vidéo ») : tient aussi à 360 px.
  const spect = repartirCommandes(['micro', 'scene'], 360, { scene: LARGEUR_PILULE });
  assert.deepEqual(spect.barre, ['micro', 'scene']);
  assert.ok(largeurBarre(spect.barre, { scene: LARGEUR_PILULE }) <= 360);
});

test('les commandes vitales restent dans la barre même à 360 px', () => {
  const { barre } = repartirCommandes(HOTE_PLEIN_ECRAN, 360);
  for (const c of ['terminer', 'camera', 'micro']) assert.ok(barre.includes(c), `${c} reste visible à 360 px`);
  // Plus large : tout tient.
  assert.deepEqual(repartirCommandes(HOTE_PLEIN_ECRAN, 1280).menu, []);
  // Une colonne (vidéo partagée) n'a pas de contrainte de largeur.
  assert.deepEqual(repartirCommandes(HOTE_PLEIN_ECRAN, Infinity).menu, []);
});

test('ordre d’affichage stable, priorité distincte, doublons ignorés', () => {
  const { barre } = repartirCommandes(['terminer', 'micro', 'camera', 'micro'], 1440);
  assert.deepEqual(barre, ['micro', 'camera', 'terminer'], 'affichage dans ORDRE_COMMANDES');
  assert.equal(PRIORITE_COMMANDES[0], 'terminer', 'une action irréversible ne se cherche pas dans un menu');
  assert.deepEqual([...PRIORITE_COMMANDES].sort(), [...ORDRE_COMMANDES].sort(), 'mêmes commandes dans les deux listes');
  assert.ok(!ORDRE_COMMANDES.includes('assistant'), 'aucune commande Assistant dans la barre');
});

/* ═════════════════════════ LOGIQUE : zoneCommentaires ═════════════════════════ */

test('une caméra, téléphone : chat ≤ 70 % de large, ≤ 40 % de haut, champ pleine largeur', () => {
  const z = zoneCommentaires({ largeur: 390, camerasActives: 1, pleinEcran: false });
  assert.equal(z.mobile, true);
  assert.equal(z.reduit, false);
  assert.equal(z.chatLargeurMax, '70%');
  assert.equal(z.chatHauteurMax, '40%');
  assert.equal(z.inputLargeurMax, '100%');
  assert.ok(z.hauteurMin, 'hors plein écran, la zone a une hauteur utile pour le chat');
  const fs = zoneCommentaires({ largeur: 390, camerasActives: 1, pleinEcran: true });
  assert.equal(fs.chatHauteurMax, '38%');
  assert.equal(fs.hauteurMin, undefined, 'le plein écran a déjà tout l’écran');
  assert.equal(fs.reserveBas, '0px');
});

test('ordinateur : chat ≤ 22 rem, champ ≤ 24 rem à gauche, réactions en colonne étroite', () => {
  for (const largeur of [768, 1280, 1440]) {
    const z = zoneCommentaires({ largeur, camerasActives: 1, pleinEcran: true });
    assert.equal(z.mobile, false);
    assert.equal(z.chatLargeurMax, '22rem');
    assert.equal(z.inputLargeurMax, '24rem');
    assert.equal(z.reactionsLargeur, '3.5rem');
  }
});

test('invités sur scène ou vignettes : le chat rapetisse et ne recouvre pas les invités', () => {
  const deux = zoneCommentaires({ largeur: 390, camerasActives: 2, pleinEcran: true });
  assert.equal(deux.reduit, true);
  assert.equal(deux.chatHauteurMax, '25%');
  const vign = zoneCommentaires({ largeur: 1280, camerasActives: 1, pleinEcran: true, vignettes: true });
  assert.equal(vign.reduit, true);
  assert.equal(vign.chatHauteurMax, '25%');
  // Hors plein écran : on réserve sous la grille la place barre + champ + chat réduit.
  const grille = zoneCommentaires({ largeur: 390, camerasActives: 3, pleinEcran: false });
  assert.equal(grille.chatHauteurMax, '7rem');
  assert.equal(grille.reserveBas, '14rem');
  assert.equal(zoneCommentaires({ largeur: 390, camerasActives: 3, pleinEcran: false, avecCalques: false }).reserveBas, '4rem',
    'sans calque, seule la barre est réservée');
});

/* ═════════════════════════ STRUCTURE : une seule barre ═════════════════════════ */

test('UNE seule barre rendue : LiveControls, une fois, hors de toute branche plein écran', () => {
  assert.equal((PANEL.match(/<LiveControls\b/g) || []).length, 1, 'un seul <LiveControls> dans le panneau');
  assert.ok(!PANEL.includes('<VisioControlBar'), 'plus de seconde barre (colonne) dans le panneau');
  assert.ok(!PANEL.includes('<MenuActions'), 'le menu ⋮ appartient à la barre, pas au panneau');
  // Rendue APRÈS la bascule camFullscreen ? … : … → la même instance dans les deux modes.
  const finTernaire = PANEL.indexOf('{!camFullscreen && prompteurNode}');
  assert.ok(PANEL.indexOf('<LiveControls') > finTernaire, 'hors du ternaire plein écran / normal');
  assert.ok(PANEL.includes('pleinEcran={camFullscreen}'), 'simplement repositionnée selon le mode');
  assert.ok(PANEL.includes('onReduce={camFullscreen ? exitCamFullscreen : undefined}'), 'Réduire seulement en plein écran');
});

test('la barre est DANS la zone caméra (cible du plein écran), en bas, au-dessus du prompteur', () => {
  const debut = PANEL.indexOf('ref={camAreaRef}');
  const fin = PANEL.indexOf('data-testid="visio-audio"');
  const i = PANEL.indexOf('<LiveControls');
  assert.ok(i > debut && i < fin, 'LiveControls est à l’intérieur de camAreaRef');
  assert.ok(PANEL.includes('pointer-events-none absolute z-[115] inset-0 flex flex-col justify-end'),
    'couche absolue transparente aux clics, ancrée en bas, z > overlay prompteur (112)');
  assert.ok(PANEL.includes("env(safe-area-inset-bottom)"), 'safe-area en plein écran');
  assert.ok(PANEL.includes('paddingBottom: `calc(0.75rem + ${zone.reserveBas} + ${zone.reservePrompteur})`'), 'hors plein écran, la place de la barre est réservée sous les vignettes');
});

test('VisioControlBar reste exporté, API compatible, simple adaptateur vers LiveControls', () => {
  assert.ok(ADAPT.includes('export const VisioControlBar'), 'export conservé (SessionPage : vidéo partagée)');
  assert.ok(ADAPT.includes('<LiveControls'), 'adaptateur mince');
  for (const p of ['micActive?: boolean', 'onToggleMic?: () => void', 'onStartTimer?: () => void', 'onToggleStageRequests?: () => void', 'onTogglePrompteur?: () => void', 'onReduce?: () => void']) {
    assert.ok(ADAPT.includes(p), `prop conservée : ${p}`);
  }
  assert.ok(ADAPT.includes('orientation="verticale"'), 'colonne : le lecteur de la vidéo partagée occupe déjà le bas');
});

test('pas de bouton Assistant dans la barre (il vit dans le panneau Prompteur)', () => {
  assert.ok(!LC.includes('visio-assistant') && !PANEL.includes('visio-assistant'));
  assert.ok(!/onToggleAssistant/.test(LC), 'la barre ne reçoit pas la bascule assistant');
  assert.ok(PANEL_BRUT.includes('onToggleAssistant?: () => void'), 'la prop reste acceptée (compatibilité)');
  assert.equal((LC.match(/'visio-prompteur-toggle'/g) || []).length, 2, 'une seule icône Prompteur (bouton + repli ⋮, jamais les deux)');
});

test('contenu principal : micro, caméra, partage, enregistrement, prompteur, diffusion, terminer, ⋮', () => {
  for (const c of ['micro', 'camera', 'partage', 'record', 'prompteur', 'diffusion', 'terminer']) {
    assert.ok(LC.includes(`{enBarre('${c}') && (`), `commande ${c} rendue dans la barre`);
  }
  assert.ok(LC.includes('<MenuActions'), 'menu ⋮');
  // Micro pour TOUS (hôte compris) : plus de hideMicButton dans la barre.
  assert.ok(LC.includes("if (onToggleMic) candidats.push('micro');"));
  assert.ok(!LC.includes('hideMicButton'));
  // Vraie icône « record » : un disque plein, un carré plein en cours ; badge durée conservé.
  const rec = LC.slice(LC.indexOf("{enBarre('record') && ("), LC.indexOf("{enBarre('prompteur') && ("));
  assert.ok(rec.includes('rounded-full bg-[var(--bt-accent)]'), 'disque plein');
  assert.ok(rec.includes('data-testid="visio-record-direct-duree"'), 'badge durée');
  // Terminer réservé à l'hôte propriétaire.
  assert.ok(LC.includes('(estHote ?? canManageStage)'));
});

test('le secondaire est dans ⋮ : sources, bascule, interval, studio, scène, embellir, commentaires, quitter', () => {
  const menu = LC.slice(LC.indexOf('const items: MenuAction[]'));
  for (const id of ['sources', 'flip', 'interval', 'studio', 'gestion-scene', 'record', 'embellir', 'commentaires', 'quitter']) {
    assert.ok(menu.includes(`id: '${id}'`), `item ⋮ ${id}`);
  }
  assert.ok(menu.includes("label: commentairesMasques ? 'Afficher les commentaires' : 'Masquer les commentaires'"));
});

test('spectateur : barre minimale, aucun outil coach', () => {
  // Toutes les commandes coach sont gardées par canManageStage / estHote.
  for (const c of ['partage', 'record', 'diffusion', 'demandes']) {
    const ligne = LC.split('\n').find((l) => l.includes(`candidats.push('${c}')`));
    assert.ok(ligne && ligne.includes('canManageStage'), `${c} réservé à qui gère la scène`);
  }
  assert.ok(/!canManageStage && !cameraOn && \(onRequestStage \|\| stageRequestPending\)\) candidats\.push\('scene'\)/.test(LC),
    'le spectateur peut demander la scène');
  const menu = LC.slice(LC.indexOf('const items: MenuAction[]'));
  for (const id of ['sources', 'flip', 'interval', 'studio', 'gestion-scene', 'record', 'embellir']) {
    const bloc = menu.slice(Math.max(0, menu.indexOf(`id: '${id}'`) - 160), menu.indexOf(`id: '${id}'`));
    assert.ok(bloc.includes('canManageStage'), `item ${id} réservé à qui gère la scène`);
  }
});

/* ═════════════════════════ ACCESSIBILITÉ ═════════════════════════ */

test('chaque bouton de la barre a un aria-label, 44 px de cible et un focus visible', () => {
  const boutons = LC.split('<button').slice(1).map((b) => b.slice(0, b.indexOf('>\n') > 0 ? b.indexOf('>\n') : 600));
  assert.ok(boutons.length >= 12, `boutons trouvés : ${boutons.length}`);
  boutons.forEach((b, i) => assert.ok(/aria-label=/.test(b), `bouton #${i + 1} sans aria-label`));
  assert.ok(LC.includes("const ROUND = 'w-11 h-11"), 'boutons ronds 44 px');
  assert.ok(LC.includes('min-h-[44px]'), 'pilules 44 px de haut');
  assert.ok((LC.match(/focus-visible:ring-2/g) || []).length >= 2, 'focus clavier visible (ronds + pilules)');
  assert.ok(LC.includes('role="toolbar"') && LC.includes('aria-label="Commandes du Live"'), 'barre annoncée comme barre d’outils');
});

test('aucune couleur codée en dur : accent du thème ou blanc/noir translucides', () => {
  for (const [nom, src] of [['LiveControls', LC], ['LiveVisioPanel', PANEL], ['VisioControlBar', ADAPT]]) {
    const hex = src.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    const permis = nom === 'LiveVisioPanel' ? hex.filter((h) => h !== '#15151b') : hex; // <option> du select caméra (préexistant)
    assert.deepEqual(permis, [], `${nom} : ${permis.join(', ')}`);
  }
  assert.ok(!/(purple|violet|fuchsia|pink)-\d/.test(LC), 'pas de teinte Tailwind en dur à la place de l’accent');
});

/* ═════════════════════════ CALQUES : chat, réactions, champ ═════════════════════════ */

test('slots chat / réactions / champ : props du panneau', () => {
  const props = PANEL_BRUT.slice(PANEL_BRUT.indexOf('interface LiveVisioPanelProps'), PANEL_BRUT.indexOf('type Layout'));
  for (const p of [
    'chatOverlayNode?: React.ReactNode', 'reactionsNode?: React.ReactNode', 'commentInputNode?: React.ReactNode',
    'commentairesMasques?: boolean', 'onToggleCommentaires?: () => void', 'estHote?: boolean',
  ]) assert.ok(props.includes(p), p);
});

test('slots rendus DANS camAreaRef, dans les DEUX modes (aucune condition camFullscreen)', () => {
  const debut = PANEL.indexOf('ref={camAreaRef}');
  const fin = PANEL.indexOf('data-testid="visio-audio"');
  for (const slot of ['{chatOverlayNode}', '{reactionsNode}', '{commentInputNode}']) {
    const i = PANEL.indexOf(slot);
    assert.ok(i > debut && i < fin, `${slot} est dans la zone caméra`);
    assert.equal((PANEL.match(new RegExp(slot.replace(/[{}]/g, '\\$&'), 'g')) || []).length, 1, `${slot} monté une seule fois`);
  }
  assert.ok(PANEL.includes('const chatVisible = !!chatOverlayNode && !commentairesMasques;'), 'masquer = retirer le flux');
  assert.ok(PANEL.includes('const inputVisible = !!commentInputNode && !commentairesMasques;'), 'masquer = retirer le champ');
  assert.ok(!/camFullscreen && \(chatVisible|camFullscreen && inputVisible|camFullscreen && reactionsNode/.test(PANEL),
    'aucun slot n’est réservé à un seul mode');
});

test('mise en page : barre en bas, champ juste au-dessus, chat à gauche, réactions à droite', () => {
  const couche = PANEL.slice(PANEL.indexOf('data-testid="visio-calques"'), PANEL.indexOf('<LiveControls'));
  const ordre = ['{chatOverlayNode}', '{reactionsNode}', '{commentInputNode}'].map((k) => couche.indexOf(k));
  assert.ok(ordre.every((i) => i > 0) && ordre[0] < ordre[1] && ordre[1] < ordre[2], 'chat + réactions, puis champ, puis barre');
  assert.ok(couche.includes('maxWidth: zone.chatLargeurMax') && couche.includes('height: zone.chatHauteurMax'), 'tailles du chat = zoneCommentaires');
  assert.ok(couche.includes('maxWidth: zone.inputLargeurMax'), 'largeur du champ = zoneCommentaires');
  assert.ok(couche.includes('width: zone.reactionsLargeur'), 'colonne des réactions = zoneCommentaires');
  assert.ok(couche.includes('data-testid="visio-fs-thumbs"'), 'vignettes des invités dans la pile : jamais sous le chat');
  assert.ok(PANEL.includes('camerasActives: Math.max(activeCameraCount, participants.length)') && PANEL.includes('vignettes: camFullscreen && fsOthers.length > 0'),
    'le chat rapetisse avec les invités');
});

test('la largeur mesurée ne relance pas de boucle de rendu', () => {
  assert.ok(PANEL.includes('setLargeurZone((p) => (p === l ? p : l))'), 'setState à l’identique évité');
  assert.ok(PANEL.includes('ro?.disconnect()'), 'observateur libéré');
});

/* ═══════════════ QA MOBILE (28/09) : défauts mesurés en navigateur réel ═══════════════
 * Harnais Playwright (Chrome) 360→1440 px, vrais composants, faux flux caméra :
 *  1. le flux de chat débordait par le BAS de son calque (hauteur auto) : les messages les
 *     plus RÉCENTS étaient rognés, 81 % d'une vignette d'invité recouverte à 360 px ;
 *  2. le calque du chat captait les clics (pointer-events-auto) sur 40 % de la vidéo ;
 *  3. sur ordinateur, la grille suivait la largeur de l'ÉCRAN (lg:grid-cols-3) alors
 *     qu'elle vit dans une colonne de 384 px : vignette de l'hôte à 64 px de haut ;
 *  4. un participant caméra coupée n'activait pas le mode réduit : chat sur sa vignette ;
 *  5. le Prompteur ouvert recouvrait le visage de l'hôte (centre de la vidéo). */

test('QA : grille = largeur de la ZONE, jamais de l’écran', async () => {
  const { colonnesGrille } = await import('./.build/liveControls.mjs');
  assert.equal(colonnesGrille(384, 1), 1, 'une personne : pleine largeur');
  assert.equal(colonnesGrille(384, 2), 1, 'colonne desktop étroite, deux personnes : empilées');
  assert.equal(colonnesGrille(384, 4), 2, 'quatre personnes : 2 × 2, pas une tour de 800 px');
  assert.equal(colonnesGrille(328, 2), 1, 'téléphone, deux personnes : empilées (comportement historique)');
  assert.equal(colonnesGrille(328, 3), 2, 'téléphone, trois personnes ou plus : 2 colonnes');
  assert.equal(colonnesGrille(720, 4), 2, 'tablette : deux colonnes');
  assert.equal(colonnesGrille(1100, 4), 3, 'large : trois colonnes');
  assert.equal(colonnesGrille(1100, 2), 2, 'jamais plus de colonnes que de personnes');
  assert.ok(!/lg:grid-cols-3/.test(PANEL), 'plus de breakpoint écran dans la grille');
  assert.ok(PANEL.includes('colonnesGrille(largeurZone, participants.length)'));
});

test('QA : le chat remplit SON calque (derniers messages visibles) et ne capte aucun clic', () => {
  const couche = PANEL.slice(PANEL.indexOf('data-testid="visio-calques"'), PANEL.indexOf('<LiveControls'));
  const chat = couche.slice(couche.lastIndexOf('<div', couche.indexOf('data-testid="visio-calque-chat"')), couche.indexOf('data-testid="visio-calque-chat"'));
  assert.ok(chat.includes('pointer-events-none'), 'calque chat transparent aux clics');
  assert.ok(chat.includes('h-full'), 'hauteur définie : le débordement part en HAUT (anciens messages)');
  const reac = couche.slice(couche.lastIndexOf('<div', couche.indexOf('data-testid="visio-calque-reactions"')), couche.indexOf('data-testid="visio-calque-reactions"'));
  assert.ok(reac.includes('pointer-events-none'), 'colonne des réactions transparente aux clics');
});

test('QA : toute vignette compte pour le mode réduit (caméra coupée comprise)', () => {
  assert.ok(PANEL.includes('camerasActives: Math.max(activeCameraCount, participants.length)'));
});

test('QA : Prompteur ouvert — place réservée hors plein écran, hors du centre en plein écran', () => {
  const z = zoneCommentaires({ largeur: 390, camerasActives: 1, pleinEcran: false, prompteurOuvert: true });
  assert.equal(z.reservePrompteur, '16rem');
  assert.equal(zoneCommentaires({ largeur: 390, camerasActives: 1, pleinEcran: false }).reservePrompteur, '0px');
  assert.equal(zoneCommentaires({ largeur: 390, camerasActives: 1, pleinEcran: true, prompteurOuvert: true }).reservePrompteur, '0px');
  assert.ok(PANEL.includes('paddingBottom: `calc(0.75rem + ${zone.reserveBas} + ${zone.reservePrompteur})`'));
  assert.ok(PANEL.includes('data-testid="visio-prompteur-place"'), 'le panneau vit dans une place bornée');
  assert.ok(PANEL.includes("largeurZone < 1024 ? 'inset-x-0 top-1/2' : 'left-1/2 right-0 top-0'"), 'plein écran : jamais sur le centre de l’image (visage)');
});
