/**
 * 🎬 Studio (Phase 2) — UI minimaliste : banc STRUCTUREL (esbuild + node --test, même style
 * que menuActions.test.mjs). Le contrat de la logique (`useStudio`) est un autre lot : ici on
 * ne lit que les sources de l'UI et on vérifie ce que Bassi a exigé.
 *
 *  - fermé → RIEN de rendu (la vidéo reste l'élément principal) ;
 *  - desktop → 3 zones Sources | PREVIEW · PROGRAMME | Scènes ; mobile → tiroir plein écran,
 *    jamais Preview et Programme côte à côte ;
 *  - Passer au programme / Cut = icônes + tooltip, jamais de texte ;
 *  - scènes = celles fournies par le studio (aucune liste en dur), clic = preview ;
 *  - PiP visible seulement pour les scènes qui en ont ;
 *  - aucun prompteur / chat / minuteur dans le studio ;
 *  - entrée : item « Studio » du menu ⋮ (entre Interval et Embellir) + icône desktop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lire } from './lireSource.mjs';

const PANEL = lire('components', 'session', 'StudioPanel.tsx');
const TYPES = lire('components', 'session', 'StudioTypes.ts');
const VISIO = lire('components', 'session', 'LiveVisioPanel.tsx');

test('fermé, le studio ne rend rien : la vidéo reste dominante', () => {
  assert.ok(PANEL.includes('if (!open) return null;'), 'retour null quand `open` est faux');
  assert.ok(VISIO.includes('{studioOpen && studioNode}'), 'LiveVisioPanel ne monte le panneau que si `studioOpen`');
});

test('desktop : trois zones Sources | Preview · Programme | Scènes, étiquettes discrètes', () => {
  const desktop = PANEL.slice(PANEL.indexOf('// 🖥️ Desktop'));
  assert.ok(desktop.includes('<Sources studio={studio}') && desktop.includes('<Scenes studio={studio}'), 'zones Sources et Scènes');
  assert.ok(desktop.includes('zone="preview"') && desktop.includes('zone="program"'), 'PREVIEW et PROGRAMME côte à côte');
  assert.ok(desktop.includes('grid-cols-[minmax(150px,1fr)_minmax(0,4fr)_minmax(170px,1fr)]'), 'grille à trois colonnes, vidéo au centre');
  assert.ok(PANEL.includes("zone === 'preview' ? 'Preview' : 'Programme'"), 'étiquettes PREVIEW / PROGRAMME');
  assert.ok(PANEL.includes('uppercase tracking-wider'), 'étiquettes en petites capitales discrètes');
  assert.ok(PANEL.includes('Flux live actuel'), 'Programme vide = flux live existant, dit tel quel');
  assert.ok(PANEL.includes('data-testid="studio-close"') && PANEL.includes("e.key === 'Escape'"), 'fermeture ✕ + Échap');
});

test('mobile : tiroir plein écran, une zone à la fois, antenne au pouce', () => {
  const mobile = PANEL.slice(PANEL.indexOf('if (mobile) {'), PANEL.indexOf('// 🖥️ Desktop'));
  assert.ok(mobile.includes('fixed inset-0'), 'tiroir plein écran');
  assert.ok(mobile.includes('role="tablist"') && mobile.includes("(['program', 'preview'] as StudioZone[])"), 'PROGRAMME / PREVIEW en onglets');
  assert.ok(mobile.includes('<Zone zone={onglet}'), 'UNE zone rendue à la fois (jamais côte à côte)');
  assert.ok(mobile.includes('<Antenne studio={studio} vertical={false} />'), 'Passer au programme / Cut en bas');
  assert.ok(mobile.includes('env(safe-area-inset-bottom)'), 'zone sûre iPhone');
});

test('Passer au programme et Cut : icônes Lucide + tooltip, branchés sur take() / cut()', () => {
  assert.ok(PANEL.includes('ArrowRightToLine') && PANEL.includes('Scissors'), 'icônes Lucide');
  assert.ok(PANEL.includes('title="Passer au programme"') && PANEL.includes('title="Cut (immédiat)"'), 'tooltips');
  assert.ok(PANEL.includes('onClick={() => studio.take()}'), 'take()');
  assert.ok(PANEL.includes('studio.cut(preview.type, opts)'), 'cut(type de la preview)');
  assert.ok(PANEL.includes('data-testid="studio-take"') && PANEL.includes('data-testid="studio-cut"'));
  assert.ok(PANEL.includes('disabled={!preview}'), 'désactivés sans preview');
});

test('scènes : uniquement celles du studio, icône + nom court, clic = preview', () => {
  assert.ok(PANEL.includes('studio.scenes.map((t) =>'), 'liste = `studio.scenes` (aucune scène en dur)');
  assert.ok(!/coach_full'|participant_full'|split_50'/.test(PANEL.replace(/SCENES_AVEC_PIP[^\n]*/g, '')), 'aucune scène codée en dur dans le panneau');
  assert.ok(PANEL.includes('data-testid={`studio-scene-${t.type}`}'));
  assert.ok(PANEL.includes('onClick={() => studio.preview(t.type'), 'clic scène → preview');
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
