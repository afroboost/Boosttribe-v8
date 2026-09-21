/**
 * 🎬 Studio (Phase 2) — UI minimaliste : banc STRUCTUREL (esbuild + node --test, même style
 * que menuActions.test.mjs). Le contrat de la logique (`useStudio`) est un autre lot : ici on
 * ne lit que les sources de l'UI et on vérifie ce que Bassi a exigé.
 *
 *  - fermé → RIEN de rendu (la vidéo reste l'élément principal) ;
 *  - UNE SEULE COLONNE, desktop comme mobile (correctif terrain 21/09 : l'ancienne grille à trois
 *    colonnes chevauchait tout dans les ~380 px de la colonne droite) : onglets PREVIEW / PROGRAMME,
 *    une zone 16:9, Take / Cut dessous, puis SOURCES et SCÈNES en sections REPLIÉES ;
 *    mobile → même colonne dans un tiroir plein écran ;
 *  - Passer au programme / Cut = icônes rondes + tooltip, libellé DESSOUS (jamais superposé) ;
 *  La géométrie RÉELLE (0 chevauchement, 0 texte coupé, 0 débordement, clics) est mesurée dans
 *  Chromium par tests/studio.ui.cjs (harnais tests/harness/studio.html, composants réels).
 *  - scènes = celles fournies par le studio (aucune liste en dur), clic = preview ;
 *  - PiP visible seulement pour les scènes qui en ont ;
 *  - aucun prompteur / chat / minuteur dans le studio ;
 *  - entrée : item « Studio » du menu ⋮ (entre Interval et Embellir) + icône desktop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const PANEL = lire('components', 'session', 'StudioPanel.tsx');
const TYPES = lire('components', 'session', 'StudioTypes.ts');
const VISIO = lire('components', 'session', 'LiveVisioPanel.tsx');

test('fermé, le studio ne rend rien : la vidéo reste dominante', () => {
  assert.ok(PANEL.includes('if (!open) return null;'), 'retour null quand `open` est faux');
  assert.ok(VISIO.includes('{studioOpen && studioNode}'), 'LiveVisioPanel ne monte le panneau que si `studioOpen`');
});

test('une seule colonne : onglets PREVIEW / PROGRAMME, une zone à la fois, Take / Cut dessous, Sources puis Scènes', () => {
  const code = codeSeul(PANEL);
  assert.ok(!code.includes('grid-cols-[minmax('), 'plus AUCUNE grille à colonnes minimales (la cause des chevauchements)');
  assert.ok(!/grid-cols-3|lg:grid-cols|md:grid-cols/.test(code), 'aucune grille multi-colonnes, quel que soit le point de rupture');
  // La colonne est construite UNE fois et rendue telle quelle sur desktop et mobile.
  const colonne = code.slice(code.indexOf('const colonne = ('), code.indexOf('if (mobile) {'));
  const ordre = ['{onglets}', '<Zone zone={onglet}', '<Antenne studio={studio}', '<Sources studio={studio}', '<Scenes studio={studio}'].map((k) => colonne.indexOf(k));
  assert.ok(ordre.every((i) => i >= 0) && ordre.every((v, i) => i === 0 || v > ordre[i - 1]), 'ordre : onglets → zone → Take/Cut → Sources → Scènes');
  // `codeSeul` a retiré les commentaires : le bloc mobile va de `if (mobile) {` au dernier `return (` (desktop).
  const mobile = code.slice(code.indexOf('if (mobile) {'), code.lastIndexOf('return ('));
  const desktop = code.slice(code.lastIndexOf('return ('));
  assert.ok(mobile.includes('{colonne}') && desktop.includes('{colonne}'), 'la MÊME colonne sur mobile et desktop');
  assert.ok(mobile.includes('fixed inset-0') && mobile.includes('env(safe-area-inset-bottom)'), 'mobile : tiroir plein écran, zone sûre iPhone');
  assert.ok(desktop.includes('overflow-x-hidden') && mobile.includes('overflow-x-hidden'), 'aucun débordement horizontal possible');
  // Onglets : deux segments de même largeur, une zone rendue à la fois.
  assert.ok(code.includes("(['preview', 'program'] as StudioZone[])") && code.includes('role="tablist"'), 'onglets PREVIEW / PROGRAMME');
  assert.ok(code.includes('grid grid-cols-2 gap-1'), 'deux segments de même largeur (jamais superposés)');
  assert.ok((code.match(/<Zone zone=/g) || []).length === 1 && code.includes('<Zone zone={onglet}'), "UNE seule zone rendue (celle de l'onglet)");
  assert.ok(!code.includes('zone="preview"') && !code.includes('zone="program"'), 'jamais Preview et Programme côte à côte');
  assert.ok(PANEL.includes('uppercase tracking-wider'), 'étiquettes en petites capitales discrètes');
  assert.ok(PANEL.includes('Flux live actuel'), 'Programme vide = flux live existant, dit DANS la zone');
  assert.ok(PANEL.includes('data-testid="studio-close"') && PANEL.includes("e.key === 'Escape'"), 'fermeture ✕ + Échap');
  // Choisir une scène → l'onglet passe sur PREVIEW ; Take / Cut → PROGRAMME.
  assert.ok(code.includes("onChoisir={() => setOnglet('preview')}"), 'scène choisie → onglet Preview');
  assert.ok(code.includes("onPasse={() => setOnglet('program')}"), 'Take / Cut → onglet Programme');
});

test('Sources et Scènes : sections repliées par défaut, un bouton pleine largeur avec compteur', () => {
  const code = codeSeul(PANEL);
  assert.ok(code.includes('React.useState(false)') && code.includes('sourcesOuvertes') && code.includes('scenesOuvertes'), 'repliées au départ');
  assert.ok(code.includes('data-testid={`studio-${id}-toggle`}') && code.includes('aria-expanded={ouvert}'), 'en-tête = bouton aria-expanded');
  assert.ok(code.includes('data-testid={`studio-${id}-liste`}') && code.includes('{ouvert && ('), "la liste n'existe dans le DOM qu'ouverte (pas de grande zone vide)");
  assert.ok(code.includes("studio.sources.filter((s) => s.kind !== 'participant')"), 'Sources = les sources disponibles du studio (participants via le sélecteur)');
  assert.ok(code.includes('Aucune source : active ta caméra'), 'sans source : une phrase, pas un vide');
  assert.ok(code.includes('<ChevronRight'), 'chevron = icône Lucide, pas un caractère');
});

test('Passer au programme et Cut : icônes Lucide + tooltip + libellé dessous, branchés sur take() / cut()', () => {
  assert.ok(PANEL.includes('ArrowRightToLine') && PANEL.includes('Scissors'), 'icônes Lucide');
  assert.ok(PANEL.includes('title="Passer au programme"') && PANEL.includes('title="Cut (immédiat)"'), 'tooltips');
  assert.ok(PANEL.includes('onClick={() => { studio.take(); onPasse(); }}'), 'take() puis bascule sur PROGRAMME');
  const antenne = PANEL.slice(PANEL.indexOf('const Antenne'), PANEL.indexOf('export const StudioPanel'));
  assert.ok(antenne.includes('>Take</span>') && antenne.includes('>Cut</span>') && antenne.includes('flex flex-col items-center'), "libellé SOUS l'icône, dans un flux vertical (jamais superposé)");
  assert.ok(!antenne.includes('absolute'), 'Antenne : aucun libellé flottant (position absolue)');
  assert.ok(PANEL.includes('studio.cut(preview.type, opts)'), 'cut(type de la preview)');
  assert.ok(PANEL.includes('data-testid="studio-take"') && PANEL.includes('data-testid="studio-cut"'));
  assert.ok(PANEL.includes('disabled={!preview}'), 'désactivés sans preview');
});

test('scènes : uniquement celles du studio, icône + nom court, clic = preview', () => {
  assert.ok(PANEL.includes('studio.scenes.map((t) =>'), 'liste = `studio.scenes` (aucune scène en dur)');
  assert.ok(!/coach_full'|participant_full'|split_50'/.test(PANEL.replace(/SCENES_AVEC_PIP[^\n]*/g, '')), 'aucune scène codée en dur dans le panneau');
  assert.ok(PANEL.includes('data-testid={`studio-scene-${t.type}`}'));
  assert.ok(PANEL.includes('onClick={() => { studio.preview(t.type'), 'clic scène → preview');
  const icones = ['user', 'users', "'columns-2'", "'picture-in-picture-2'", 'monitor', 'camera', 'video'];
  for (const i of icones) assert.ok(PANEL.includes(i), `icône ${i} mappée`);
  assert.ok(TYPES.includes("'user' | 'users' | 'columns-2' | 'picture-in-picture-2' | 'monitor' | 'camera' | 'video'"), 'contrat des icônes');
});

test('participant : un sélecteur simple ; PiP : 4 coins, seulement pour les scènes concernées', () => {
  assert.ok(PANEL.includes('data-testid="studio-participant"') && PANEL.includes('studio.setParticipant(e.target.value || null)'));
  assert.ok(PANEL.includes('SCENES_AVEC_PIP.has(typePreview)'), 'PiP conditionnel');
  assert.ok(TYPES.includes("new Set<SceneType>(['pip', 'screen_coach'])"), 'pip + écran+coach');
  for (const pos of ['tl', 'tr', 'bl', 'br']) assert.ok(TYPES.includes(`pos: '${pos}'`), `position ${pos}`);
  assert.ok(PANEL.includes('data-testid={`studio-pip-${pos}`}') && PANEL.includes('studio.setPip(pos)'));
});

test('aucun prompteur, chat ou minuteur ne passe par le studio', () => {
  for (const interdit of ['Prompteur', 'ChatPanel', 'chat-launcher', 'Timer', 'timerNode']) {
    assert.ok(!PANEL.includes(interdit) && !TYPES.includes(interdit), `${interdit} absent du studio`);
  }
});

test('entrée : item « Studio » dans le menu ⋮ entre Interval et Embellir + icône ronde desktop', () => {
  const barre = VISIO.slice(VISIO.indexOf('{/* Barre de contrôle'), VISIO.indexOf('{/* 🎛️ Avis caméra discret'));
  const ordre = ["id: 'interval'", "id: 'studio'", "id: 'embellir'"].map((k) => barre.indexOf(k));
  assert.ok(ordre.every((i) => i > 0) && ordre[0] < ordre[1] && ordre[1] < ordre[2], 'Interval → Studio → Embellir');
  assert.ok(barre.includes("testId: 'visio-studio'") && barre.includes('Clapperboard'), 'item Lucide Clapperboard');
  assert.ok(barre.includes('data-testid="studio-toggle"') && barre.includes('hidden lg:inline-flex'), 'icône desktop seulement');
  assert.ok(barre.includes('aria-pressed={studioOpen}'), 'état ouvert reflété');
  assert.ok(VISIO.includes('studioNode?: React.ReactNode') && VISIO.includes('studioOpen?: boolean') && VISIO.includes('onToggleStudio?: () => void'), 'props exactes');
  // Les anciens data-testid restent en place.
  for (const id of ['visio-sources', 'visio-prompteur-toggle', 'visio-start-timer', 'visio-embellir', 'visio-leave', 'visio-camera-toggle', 'visio-camera-flip', 'visio-screen-share']) {
    assert.ok(barre.includes(id), `data-testid conservé : ${id}`);
  }
});

test('pas d’emoji rendu dans l’UI du studio (Lucide uniquement)', () => {
  const rendu = PANEL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(rendu), 'aucun emoji dans le code rendu');
});
