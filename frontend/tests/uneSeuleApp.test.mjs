/**
 * UNE SEULE APPLICATION, DEUX HABILLAGES — et les outils du coach ne dépendent
 * d'AUCUN des deux.
 *
 * LE BUG RÉEL (14/09/2026). Sur afroboost.com → Publier → « Rejoindre le live »,
 * l'iframe chargeait https://afroboost.com/live/embed : une COPIE rebrandée du
 * dépôt, figée au 7 août — sans bouton Prompteur, sans ⏮ ▶ ⏭ en plein écran —
 * pendant que boosttribe.pro les avait. Aucune condition dans le code ne les
 * masquait : c'était un AUTRE code. Ces bancs verrouillent la réponse :
 *
 *   1. la marque ne pilote QUE l'habillage (nom, base, URL, manifeste, tarifs) ;
 *   2. aucun outil du coach (prompteur, musique, minuteur) ne lit la marque,
 *      le mode embed, ni le chemin — direct et embed rendent le MÊME panneau ;
 *   3. l'habillage Afroboost se construit depuis CE dépôt (base /live/, textes,
 *      manifeste), donc ne peut plus prendre de retard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lire, codeSeul, lister } from './lireSource.mjs';

const BRANDS = JSON.parse(lire('config', 'brands.json'));
const BRAND_TS = lire('config', 'brand.ts');
const SESSION = lire('pages', 'SessionPage.tsx');
const PANEL = lire('components', 'session', 'LiveVisioPanel.tsx');
const BARRE = lire('components', 'session', 'VisioControlBar.tsx');
const EMBED = lire('pages', 'EmbedPage.tsx');
const APP = lire('App.tsx');
const INDEX = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
const VITE = fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8');

/* ───────────── 1. Le catalogue de marques : complet, et les deux différents ───────────── */

test('deux marques, mêmes clés, valeurs distinctes là où ça compte', () => {
  assert.deepEqual(Object.keys(BRANDS).sort(), ['afroboost', 'boosttribe']);
  const cles = (b) => Object.keys(BRANDS[b]).sort();
  assert.deepEqual(cles('afroboost'), cles('boosttribe'), 'même forme pour les deux');
  assert.equal(BRANDS.boosttribe.basePath, '/');
  assert.equal(BRANDS.afroboost.basePath, '/live/', 'Afroboost Live vit sous /live/');
  assert.equal(BRANDS.afroboost.publicUrl, 'https://afroboost.com/live');
  assert.equal(BRANDS.boosttribe.publicUrl, 'https://boosttribe.pro');
  assert.equal(BRANDS.boosttribe.vendCredits, true);
  assert.equal(BRANDS.afroboost.vendCredits, false, 'Afroboost ne vend que des abonnements (V405)');
});

test('la marque se résout depuis REACT_APP_BRAND, Boosttribe par défaut', () => {
  const code = codeSeul(BRAND_TS);
  assert.ok(code.includes("=== 'afroboost' ? 'afroboost' : 'boosttribe'"), 'tout ce qui n est pas afroboost est boosttribe');
  assert.ok(code.includes('import.meta.env.REACT_APP_BRAND'));
  assert.ok(fs.existsSync(path.join(process.cwd(), 'src', 'config', 'theme.afroboost.json')), 'le thème Afroboost existe');
});

/* ───────────── 2. Les outils du coach ignorent marque, embed et chemin ───────────── */

const FICHIERS_LIVE = [
  ['components', 'session', 'LiveVisioPanel.tsx'],
  ['components', 'session', 'VisioControlBar.tsx'],
  ['components', 'session', 'PrompteurOverlay.tsx'],
  ['components', 'session', 'TiroirPrompteur.tsx'],
  ['components', 'session', 'PanneauPrompteur.tsx'],
  ['hooks', 'usePrompteur.ts'],
];

test('aucun composant du Live ne lit la marque, le mode embed ni le chemin', () => {
  for (const f of FICHIERS_LIVE) {
    const code = codeSeul(lire(...f));
    for (const interdit of ['config/brand', 'isEmbedMode', 'bt_embed_token', 'location.pathname', 'BASE_URL', 'REACT_APP_BRAND']) {
      assert.ok(!code.includes(interdit), `${f.join('/')} ne doit pas lire ${interdit}`);
    }
  }
});

test('dans SessionPage, le mode embed ne sert QU au crédit afroboost — jamais à un rendu', () => {
  const code = codeSeul(SESSION);
  const lignes = code.split('\n').filter((l) => l.includes('isEmbedMode'));
  assert.ok(lignes.length >= 1, 'isEmbedMode est bien utilisé (crédit)');
  for (const l of lignes) {
    assert.ok(!l.includes('?') || l.trim().startsWith('if (!isEmbedMode()) return;'),
      `isEmbedMode ne doit pas conditionner un rendu : ${l.trim()}`);
    assert.ok(!/prompteur|audioNode|onToggle|canShare|isHost/i.test(l), `isEmbedMode mêlé aux outils : ${l.trim()}`);
  }
  assert.ok(!code.includes('config/brand') || !/BRAND\.[a-z]+\s*&&\s*\(?\s*<|canShare\s*&&\s*BRAND/.test(code),
    'la marque ne gate aucun outil de session');
});

test('les quatre outils du coach ont UNE seule condition : canShare (hôte ou co-hôte)', () => {
  const code = codeSeul(SESSION);
  assert.ok(code.includes('const canShare = isHost || isCoHost;'));
  assert.ok(code.includes('const prompteurNode = canShare ?'), 'panneau prompteur');
  assert.ok(code.includes('const prompteurOverlayNode = (canShare && prompteurSurVideo) ?'), 'overlay');
  assert.ok(code.includes("const miniAudioControlNode = (canShare && selectedTrack && shareMode === 'audio') ?"), '⏮ ▶ ⏭');
  assert.ok(code.includes('onTogglePrompteur={canShare ? () => {'), 'bouton Prompteur');
  assert.ok(code.includes('onStartTimer={canShare ? () => setShowVisioTimerConfig(true) : undefined}'), 'minuteur');
  // Un seul LiveVisioPanel monté — pas de variante « embed ».
  assert.equal((code.match(/<LiveVisioPanel\b/g) || []).length, 1, 'un seul LiveVisioPanel');
});

test('direct et embed atterrissent sur la MÊME page de session', () => {
  const code = codeSeul(EMBED);
  assert.ok(code.includes("navigate(sessionCibleRef.current ? `/session/${sessionCibleRef.current}` : '/session', { replace: true })"),
    'l embed navigue vers /session (ou la session désignée par bt_session), il ne rend rien lui-même');
  assert.ok(code.includes("/^[A-Z0-9-]{4,40}$/.test(cible)"), 'bt_session est borné à un code de session');
  assert.ok(!code.includes('LiveVisio'), 'EmbedPage ne monte aucun Live');
  const app = codeSeul(APP);
  assert.equal((app.match(/element={<SessionPage/g) || []).length >= 1, true);
  assert.ok(!app.includes('EmbedSession'), 'pas de page de session dédiée à l embed');
});

test('le bouton Prompteur ne dépend pas de la caméra : présent caméra coupée', () => {
  const barre = codeSeul(BARRE);
  const bloc = barre.slice(barre.indexOf('{onTogglePrompteur && ('), barre.indexOf('data-testid="visio-fs-prompteur"'));
  assert.ok(!bloc.includes('cameraOn'), 'aucune condition cameraOn autour du bouton plein écran');
  const panel = codeSeul(PANEL);
  const bloc2 = panel.slice(panel.indexOf('{onTogglePrompteur && ('), panel.indexOf('data-testid="visio-prompteur-toggle"'));
  assert.ok(!bloc2.includes('cameraOn'), 'aucune condition cameraOn autour du bouton du panneau');
});

test('plein écran : prompteur, tiroir et musique restent DANS le nœud plein écran', () => {
  const code = codeSeul(PANEL);
  const fs_ = code.slice(code.indexOf('camFullscreen ? ('), code.indexOf(') : spotlightP ? ('));
  for (const attendu of ['<VisioControlBar', 'onTogglePrompteur={onTogglePrompteur}', '{prompteurNode}', '{prompteurTiroirNode}', 'data-testid="visio-fs-audio"']) {
    assert.ok(fs_.includes(attendu), `plein écran contient ${attendu}`);
  }
});

test('⏮ ▶/⏸ ⏭ : cible tactile 44 px, boutons visibles même désactivés, un seul lecteur', () => {
  const code = codeSeul(SESSION);
  const bloc = code.slice(code.indexOf('const miniAudioControlNode'), code.indexOf('const liveVisioNode'));
  assert.equal((bloc.match(/min-w-\[44px\] min-h-\[44px\]/g) || []).length, 3, 'les trois boutons font 44 px');
  assert.ok(bloc.includes("disabled={miniAudioPrecedent === 'rien'}"), '⏮ désactivé, jamais masqué');
  assert.ok(bloc.includes('disabled={!miniAudioSuivante}'), '⏭ désactivé, jamais masqué');
  assert.ok(!bloc.includes('<audio') && !bloc.includes('new Audio('), 'aucun second lecteur');
  assert.ok(bloc.includes('onClick={handlePlayerNext}') && bloc.includes('handlePlayerPrevious('), 'mêmes gestionnaires que le grand lecteur');
});

/* ───────────── 3. L'habillage Afroboost se construit d'ICI ───────────── */

test('vite.config : base, métadonnées HTML et manifeste viennent du catalogue', () => {
  assert.ok(VITE.includes("import brands from './src/config/brands.json'"));
  assert.ok(VITE.includes('base: basePath'));
  assert.ok(VITE.includes('process.env.REACT_APP_BASE_PATH = basePath'));
  assert.ok(VITE.includes('manifestePourLaMarque('));
  assert.ok(VITE.includes('loadEnv(mode, racine'), 'les fichiers .env.production sont lus (branche de déploiement)');
});

test('index.html ne fige plus aucune marque ni aucun chemin racine', () => {
  for (const interdit of ['<title>Boosttribe', 'href="/manifest.json"', "register('/sw.js'", 'href="/icon-']) {
    assert.ok(!INDEX.includes(interdit), `index.html contient encore ${interdit}`);
  }
  assert.ok(INDEX.includes('<title>%REACT_APP_BRAND_TITLE%</title>'));
  assert.ok(INDEX.includes("register('%REACT_APP_BASE_PATH%sw.js'"));
});

test('sw.js déduit sa base de sa portée — aucun chemin racine figé', () => {
  assert.ok(SW.includes('self.registration.scope'));
  for (const interdit of ["'/manifest.json'", "caches.match('/')", "'/icon-192x192.png'"]) {
    assert.ok(!SW.includes(interdit), `sw.js contient encore ${interdit}`);
  }
});

test('le routeur suit la base du build ; les liens internes sont des <Link>', () => {
  assert.ok(codeSeul(APP).includes('<BrowserRouter basename={ROUTER_BASENAME}>'));
  for (const f of [['components', 'AssistantChat.tsx'], ['components', 'session', 'ChatPanel.tsx'], ['components', 'session', 'SharedMediaPlayer.tsx']]) {
    assert.ok(!codeSeul(lire(...f)).includes('href="/pricing"'), `${f.join('/')} : plus de <a href="/pricing">`);
  }
  // Liens partagés : jamais window.location.origin seul.
  for (const f of [['pages', 'SessionPage.tsx'], ['components', 'session', 'PromoEditor.tsx']]) {
    assert.ok(!codeSeul(lire(...f)).includes('${window.location.origin}/promo/'), `${f.join('/')} : lien de partage par publicUrl`);
  }
});

test('le manifeste généré pour Afroboost vit sous /live/ (fonction pure du build)', async () => {
  // La fonction est exportée par vite.config.ts ; on la charge par esbuild pour ne pas
  // dépendre de Vite ici.
  const { execSync } = await import('node:child_process');
  const out = path.join(process.cwd(), 'tests', '.build', 'vite.config.mjs');
  execSync(`node_modules/.bin/esbuild vite.config.ts --bundle --format=esm --platform=node --outfile=${out} --log-level=error --external:vite --external:@vitejs/plugin-react`);
  const mod = await import(`${out}?t=${Date.now()}`);
  const source = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'manifest.json'), 'utf8'));
  const m = mod.manifestePourLaMarque(source, 'afroboost', '/live/');
  assert.equal(m.name, 'Afroboost Live');
  assert.equal(m.start_url, '/live/');
  assert.equal(m.scope, '/live/');
  assert.ok(m.icons.every((i) => i.src.startsWith('/live/')), 'icônes sous /live/');
  assert.equal(m.shortcuts[0].url, '/live/session');
  assert.equal(m.theme_color, '#9f2d70');
  const b = mod.manifestePourLaMarque(source, 'boosttribe', '/');
  assert.equal(b.name, BRANDS.boosttribe.name);
  assert.equal(b.start_url, '/');
  assert.equal(mod.normaliserBase('live'), '/live/');
  assert.equal(mod.normaliserBase('/'), '/');
  // La résolution : env > catalogue ; tout ce qui n'est pas « afroboost » = boosttribe.
  assert.deepEqual(mod.resoudreMarque({ REACT_APP_BRAND: 'afroboost' }).basePath, '/live/');
  assert.equal(mod.resoudreMarque({ REACT_APP_BRAND: 'afroboost' }).publicUrl, 'https://afroboost.com/live');
  assert.equal(mod.resoudreMarque({ REACT_APP_BRAND: 'AFROBOOST ' }).brandId, 'afroboost');
  assert.equal(mod.resoudreMarque({}).brandId, 'boosttribe');
  assert.equal(mod.resoudreMarque({ REACT_APP_BRAND: 'autre' }).basePath, '/');
  assert.equal(mod.resoudreMarque({ REACT_APP_BRAND: 'afroboost', REACT_APP_BASE_PATH: 'test' }).basePath, '/test/');
});
