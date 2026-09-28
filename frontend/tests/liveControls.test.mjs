/**
 * 🎛️ BARRE DE COMMANDES LIVE UNIQUE (28/09/2026) — refonte UX « Live mobile ».
 *
 * Avant : une rangée d'icônes sous la vidéo (vue normale) ET une colonne verticale à
 * droite (plein écran, VisioControlBar) — deux barres, deux jeux de boutons, un bouton
 * Assistant séparé. Attendu : UNE barre (LiveControls), la même dans les deux modes ; le
 * secondaire dans ⋮ ; des calques chat / réactions / champ posés DANS la zone caméra ;
 * tailles calculées par des fonctions pures.
 *
 * Barre v2 (28/09) : la barre n'est plus en bas mais VERTICALE À DROITE de la vidéo,
 * partout (360 → 1440 px, normal et plein écran). Ce qui ne tient pas en HAUTEUR descend
 * dans ⋮. Le chat et le champ vivent en bas à gauche de la scène, à gauche de la barre.
 *
 * Deux bancs : LOGIQUE (lib/liveControls.ts transpilée) et STRUCTUREL (lecture des sources).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';
import * as LOGIQUE from './.build/liveControls.mjs';

const {
  repartirCommandes, zoneCommentaires, ORDRE_COMMANDES, PRIORITE_COMMANDES,
  TAILLE_BOUTON, ESPACE_BOUTONS, MARGE_BARRE, LARGEUR_PILULE,
  ESPACE_COLONNE, dispositionBarre, ancrageImage,
} = LOGIQUE;

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

test('ordinateur : chat ≤ 22 rem, champ ≤ 36 rem CENTRÉ, réactions en colonne étroite', () => {
  for (const largeur of [768, 1280, 1440]) {
    const z = zoneCommentaires({ largeur, camerasActives: 1, pleinEcran: true });
    assert.equal(z.mobile, false);
    assert.equal(z.chatLargeurMax, '22rem');
    assert.equal(z.inputLargeurMax, '36rem');
    assert.equal(z.inputAlignement, 'centre');
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
  // Hors plein écran : on réserve sous la grille la place champ + chat réduit — plus la
  // barre (4 rem), qui vit désormais à droite.
  const grille = zoneCommentaires({ largeur: 390, camerasActives: 3, pleinEcran: false });
  assert.equal(grille.chatHauteurMax, '7rem');
  assert.equal(grille.reserveBas, '10rem');
  assert.equal(zoneCommentaires({ largeur: 390, camerasActives: 3, pleinEcran: false, avecCalques: false }).reserveBas, '0px',
    'sans calque, rien à réserver en bas : la barre est à droite');
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

test('la barre est DANS la zone caméra (cible du plein écran), VERTICALE À DROITE, au-dessus du prompteur', () => {
  const debut = PANEL.indexOf('ref={camAreaRef}');
  const fin = PANEL.indexOf('{studioOpen && studioNode}');
  const i = PANEL.indexOf('<LiveControls');
  assert.ok(i > debut && i < fin, 'LiveControls est à l’intérieur de camAreaRef');
  assert.ok(PANEL.includes('pointer-events-none absolute z-[115] inset-0'),
    'couche absolue transparente aux clics, z > overlay prompteur (112)');
  const barre = PANEL.slice(i, PANEL.indexOf('/>', i));
  assert.ok(barre.includes('orientation={barre.orientation}'), 'orientation = dispositionBarre (verticale)');
  assert.ok(barre.includes('hauteur={'), 'la HAUTEUR mesurée décide du débordement dans ⋮');
  assert.ok(barre.includes('top-1/2 -translate-y-1/2'), 'centrée verticalement');
  assert.ok(barre.includes('env(safe-area-inset-right)'), 'safe-area à droite en plein écran');
  assert.ok(PANEL.includes("env(safe-area-inset-bottom)"), 'safe-area en bas pour le chat en plein écran');
  assert.ok(PANEL.includes('paddingRight: `calc(0.25rem + ${zone.reserveDroite})`'), 'hors plein écran, les vignettes laissent la colonne de la barre libre');
});

test('barre v2 : dispositionBarre = verticale à droite partout (téléphone → ordinateur, normal et plein écran)', () => {
  for (const largeur of [360, 390, 414, 430, 768, 1440]) {
    for (const pleinEcran of [false, true]) {
      for (const hauteur of [213, 416, 844, 900]) {
        assert.deepEqual(dispositionBarre({ largeur, hauteur, pleinEcran }),
          { orientation: 'verticale', cote: 'droite', reserveDroite: '3.75rem' }, `${largeur}×${hauteur} ${pleinEcran ? 'plein écran' : 'normal'}`);
      }
    }
  }
  const z = zoneCommentaires({ largeur: 1440, pleinEcran: true, camerasActives: 1 });
  assert.equal(z.reserveDroite, '3.75rem', 'le chat laisse la colonne de la barre libre');
  assert.ok(!/4rem/.test(z.reserveBas), `reserveBas sans la barre : ${z.reserveBas}`);
  for (const largeur of [360, 1440]) {
    const n = zoneCommentaires({ largeur, pleinEcran: false, camerasActives: 1 });
    assert.equal(n.reserveBas, '0px', `${largeur} px, une caméra : plus rien sous les vignettes pour la barre`);
    assert.equal(n.reserveDroite, '3.75rem');
  }
});

test('barre v2 : en colonne, la HAUTEUR décide (même formule, espace gap-3 = 12 px)', () => {
  assert.equal(ESPACE_COLONNE, 12, 'gap-3 de la colonne');
  const hauteurColonne = (barre) => MARGE_BARRE + TAILLE_BOUTON + barre.length * (TAILLE_BOUTON + ESPACE_COLONNE);
  const r = repartirCommandes(HOTE_PLEIN_ECRAN, 300, {}, ESPACE_COLONNE);
  assert.ok(r.menu.length > 0, '9 commandes ne tiennent pas dans 300 px de haut');
  assert.ok(hauteurColonne(r.barre) <= 300, `colonne ${hauteurColonne(r.barre)} px ≤ 300`);
  assert.ok(r.barre.includes('terminer') && r.barre.includes('camera'), 'vitales gardées');
  for (const h of [213, 416, 600, 844]) {
    const x = repartirCommandes(HOTE_PLEIN_ECRAN, h, {}, ESPACE_COLONNE);
    assert.ok(hauteurColonne(x.barre) <= h, `${h} px : colonne ${hauteurColonne(x.barre)} px`);
  }
  assert.deepEqual(repartirCommandes(HOTE_PLEIN_ECRAN, 900, {}, ESPACE_COLONNE).menu, [], '900 px : tout tient');
  // La colonne reçoit la hauteur : plus de « Infinity » codé en dur pour la verticale.
  assert.ok(!LC.includes('vertical ? Infinity'), 'LiveControls ne neutralise plus la contrainte en colonne');
  assert.ok(LC.includes('vertical ? hauteur : largeur'), 'la colonne est contrainte par sa hauteur');
  assert.ok(LC.includes('vertical ? ESPACE_COLONNE : ESPACE_BOUTONS'), 'gap cohérent avec la classe gap-3');
  assert.ok(LC.includes("flex-col gap-3 py-2"), 'marge verticale = MARGE_BARRE (py-2 × 2)');
});

test('barre v2 : chat + champ ancrés au bord gauche de l’IMAGE (object-contain centrée)', () => {
  assert.deepEqual(ancrageImage({ largeur: 1440, hauteur: 900, ratio: 9 / 16 }), { gauche: 467 }, 'image portrait : bande noire de 467 px');
  assert.deepEqual(ancrageImage({ largeur: 1440, hauteur: 900, ratio: 4 / 3 }), { gauche: 120 });
  assert.deepEqual(ancrageImage({ largeur: 1440, hauteur: 900, ratio: 16 / 9 }), { gauche: 0 }, 'image plus large que l’écran : bord de la scène');
  assert.deepEqual(ancrageImage({ largeur: 390, hauteur: 844, ratio: 16 / 9 }), { gauche: 0 });
  assert.deepEqual(ancrageImage({ largeur: 1440, hauteur: 900, ratio: 0 }), { gauche: 0 }, 'ratio inconnu : pas d’hypothèse');
});

test('barre v2 : le champ commentaire est HORS de la pile de la barre', () => {
  const i = PANEL.indexOf('<LiveControls');
  const pile = PANEL.indexOf('data-testid="visio-calques-bas"');
  const input = PANEL.indexOf('data-testid="visio-calque-input"');
  assert.ok(pile > 0 && input > pile, 'le champ vit dans la pile bas-gauche');
  assert.ok(i < pile, 'la barre est rendue AVANT (donc hors de) la pile bas-gauche');
  const blocPile = PANEL.slice(PANEL.lastIndexOf('<div', pile), pile);
  assert.ok(blocPile.includes('absolute') && blocPile.includes('bottom-0'), 'pile ancrée en bas');
  const stylePile = PANEL.slice(pile - 500, pile);
  assert.ok(stylePile.includes('right: droitePile'), 'marge droite ≥ reserveDroite (à gauche de la barre)');
  assert.ok(PANEL.includes('const droitePile = gaucheCalques > 0 ? `max(${gaucheCalques}px, ${droiteCalques})` : droiteCalques;'), 'jamais moins que la colonne de la barre');
  assert.ok(stylePile.includes('gaucheCalques'), 'bord gauche = bord de l’image');
  assert.ok(PANEL.includes('const droiteCalques = camFullscreen ? `calc(${zone.reserveDroite} + env(safe-area-inset-right))` : zone.reserveDroite;'));
  assert.ok(PANEL.includes('ancrageImage({ largeur: largeurZone, hauteur: hauteurZone, ratio: ratioImage })'), 'ancre = fonction pure testée');
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
  const fin = PANEL.indexOf('{studioOpen && studioNode}');
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

test('mise en page : barre à droite ; en bas à gauche le chat (+ réactions), puis le champ', () => {
  const couche = PANEL.slice(PANEL.indexOf('data-testid="visio-calques-bas"'), PANEL.indexOf('{studioOpen && studioNode}'));
  const ordre = ['{chatOverlayNode}', '{reactionsNode}', '{commentInputNode}'].map((k) => couche.indexOf(k));
  assert.ok(ordre.every((i) => i > 0) && ordre[0] < ordre[1] && ordre[1] < ordre[2], 'chat + réactions, puis champ');
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
  const couche = PANEL.slice(PANEL.indexOf('data-testid="visio-calques-bas"'), PANEL.indexOf('{studioOpen && studioNode}'));
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
  assert.ok(PANEL.includes("largeurZone < 1024 ? 'left-0 top-1/2' : 'left-1/2 top-0'"), 'plein écran : jamais sur le centre de l’image (visage)');
  assert.ok((PANEL.match(/right: droiteCalques/g) || []).length >= 4, 'tiroir (deux modes) et texte du prompteur (deux modes) ne recouvrent pas la colonne de la barre');
});
