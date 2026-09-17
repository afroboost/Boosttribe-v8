/**
 * Écran live ÉPURÉ (17/09/2026) — banc structurel.
 *
 * Constat de Bassi sur iPhone : deux rangées de boutons texte (« Sources », « Prompteur »,
 * « Plein écran », « Interval training », « Quitter le live »), un « Plein écran » en double
 * avec l'Agrandir de la vignette, et deux icônes chat (colonne plein écran + bulle).
 *
 * Attendu : UNE rangée d'icônes rondes + un menu ⋮ qui range le secondaire ; « Plein écran »
 * retiré de la barre ; un seul chat (la bulle) ; les data-testid historiques conservés.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const PANEL = lire('components', 'session', 'LiveVisioPanel.tsx');
const MENU = lire('components', 'session', 'MenuActions.tsx');
const BARRE = lire('components', 'session', 'VisioControlBar.tsx');
const SESSION = lire('pages', 'SessionPage.tsx');

const barreDuBas = () => PANEL.slice(PANEL.indexOf('{/* Barre de contrôle'), PANEL.indexOf('{/* 🎛️ Avis caméra discret'));

test('la barre du bas est UNE rangée d’icônes rondes, sans boutons texte pour l’hôte', () => {
  const b = barreDuBas();
  assert.ok(!b.includes('flex-wrap'), 'plus de retour à la ligne : une seule rangée');
  assert.ok(b.includes('${ROUND}'), 'les boutons réutilisent les classes rondes de la colonne plein écran');
  assert.ok(/Couper la caméra/.test(b) && !/>\s*\{cameraOn \? 'Couper la caméra'/.test(b),
    'le libellé caméra est un title/aria-label, pas un texte affiché');
  assert.ok(b.includes('data-testid="visio-camera-toggle"'));
  assert.ok(b.includes('data-testid="visio-camera-flip"'), 'la bascule avant/arrière reste en barre (mobile)');
  assert.ok(b.includes('data-testid="visio-screen-share"'), 'le partage d’écran reste en barre (desktop)');
  assert.ok(b.includes('Quitter la scène') && b.includes('Demander à monter en vidéo'),
    'le spectateur garde ses actions de scène visibles');
});

test('« Plein écran » n’est plus dans la barre : l’Agrandir de la vignette suffit', () => {
  assert.ok(!PANEL.includes('visio-camera-fullscreen'), 'bouton barre supprimé');
  assert.ok(PANEL.includes('visio-tile-enlarge') || PANEL.includes("'visio-tile-enlarge'") || /enlarge\(/.test(PANEL),
    'l’agrandir de la vignette existe toujours');
});

test('le menu ⋮ existe, range le secondaire dans l’ordre, Quitter en dernier et rouge', () => {
  assert.ok(PANEL.includes('<MenuActions'), 'la barre monte le menu');
  assert.ok(MENU.includes('MoreVertical'), 'icône lucide ⋮');
  assert.ok(MENU.includes('role="menu"') && MENU.includes('aria-expanded={open}'), 'sémantique menu');
  assert.ok(MENU.includes("e.key === 'Escape'") && MENU.includes("'mousedown'"), 'fermeture Échap + clic dehors');
  assert.ok(MENU.includes('className="fixed'), 'ancré en fixed (le panneau est overflow-hidden)');
  const b = barreDuBas();
  const ordre = ["id: 'sources'", "id: 'prompteur'", "id: 'interval'", "id: 'embellir'", "id: 'quitter'"]
    .map((k) => b.indexOf(k));
  assert.ok(ordre.every((i) => i > 0), 'Sources, Prompteur, Interval, Embellir, Quitter sont dans le menu');
  assert.deepEqual(ordre, [...ordre].sort((a, c) => a - c), 'ordre : Sources → Prompteur → Interval → Embellir → Quitter');
  const quitter = b.slice(b.indexOf("id: 'quitter'"), b.indexOf("id: 'quitter'") + 300);
  assert.ok(quitter.includes('danger: true'), 'Quitter est marqué danger (rouge, séparé, dernier)');
  assert.ok(MENU.includes('text-red-300'), 'rendu rouge du danger');
  for (const id of ['visio-sources', 'visio-prompteur-toggle', 'visio-start-timer', 'visio-leave']) {
    assert.ok(b.includes(`'${id}'`), `data-testid historique conservé : ${id}`);
  }
});

test('un seul chat : la colonne plein écran n’a plus d’icône chat, la bulle reste', () => {
  assert.ok(!BARRE.includes('visio-fs-chat'), 'bouton chat de la colonne supprimé');
  assert.ok(!BARRE.includes('MessageCircle'), 'plus d’icône chat dans la colonne');
  assert.ok(!/onOpenChat/.test(codeSeul(BARRE)) && !/onOpenChat/.test(codeSeul(PANEL)), 'la prop ne circule plus');
  assert.ok(SESSION.includes('createPortal(chatPanelNode, fsChatPortalTarget)'),
    'la bulle est portée dans le plein écran visio');
  assert.ok(SESSION.includes('chatNode={chatPanelNode}'), 'et rendue dans le plein écran de la vidéo partagée');
});

test('le slot « Embellir le visage » est prévu pour le lot beauté', () => {
  assert.ok(PANEL.includes('embellirNode?: React.ReactNode'), 'prop optionnelle du panneau');
  assert.ok(SESSION.includes('embellirNode={embellirNode}'), 'la page la transmet');
  assert.ok(MENU.includes('node?: React.ReactNode'), 'un item peut rendre un réglage libre');
});
