/**
 * Le prompteur est UN SEUL prompteur, monté à deux endroits.
 *
 * Ces bancs lisent les SOURCES, parce que la garantie demandée n'est pas
 * fonctionnelle mais structurelle : « ne crée pas un deuxième prompteur, un
 * deuxième système de sauvegarde, une deuxième logique Play/Pause ». Un test de
 * comportement ne verrait pas la duplication ; une lecture de source, si.
 *
 * Ils tiennent aussi la règle de confidentialité : le texte ne doit toucher NI
 * socket, NI réseau, dans aucun des fichiers concernés.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');
const lire = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const HOOK = lire('hooks', 'usePrompteur.ts');
const PANNEAU = lire('components', 'session', 'PanneauPrompteur.tsx');
const STUDIO = lire('pages', 'StudioPage.tsx');
const SESSION = lire('pages', 'SessionPage.tsx');
const PROMPTEUR = lire('components', 'studio', 'Prompteur.tsx');

/** Le code exécuté, commentaires retirés : une explication n'est pas une preuve. */
function codeSeul(txt) {
  return txt
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('un seul endroit écrit le script — une seule sauvegarde', () => {
  const cle = "'bt_studio_script'";
  assert.ok(HOOK.includes(cle), 'le hook porte la clé');
  for (const [nom, src] of [['StudioPage', STUDIO], ['PanneauPrompteur', PANNEAU], ['SessionPage', SESSION]]) {
    assert.ok(!codeSeul(src).includes(cle), `${nom} ne doit pas manipuler la clé lui-même`);
  }
});

test('un seul endroit écrit les réglages', () => {
  const cle = "'bt_studio_reglages'";
  assert.ok(HOOK.includes(cle));
  for (const [nom, src] of [['StudioPage', STUDIO], ['PanneauPrompteur', PANNEAU]]) {
    assert.ok(!codeSeul(src).includes(cle), `${nom} ne doit pas manipuler la clé lui-même`);
  }
});

test('une seule logique Play/Pause : les deux écrans appellent le hook', () => {
  assert.ok(HOOK.includes('basculerLecture'), 'le hook porte la bascule');
  assert.ok(STUDIO.includes("from '@/hooks/usePrompteur'"), '/studio utilise le hook');
  assert.ok(PANNEAU.includes("from '@/hooks/usePrompteur'"), 'le panneau Live utilise le hook');
  // Ni l'un ni l'autre ne redéfinit la bascule.
  for (const [nom, src] of [['StudioPage', STUDIO], ['PanneauPrompteur', PANNEAU]]) {
    assert.ok(!/const\s+basculerLecture\s*=\s*useCallback/.test(codeSeul(src)),
      `${nom} ne doit pas réimplémenter basculerLecture`);
  }
});

test('un seul composant d affichage : les deux montent le MÊME Prompteur', () => {
  assert.ok(STUDIO.includes("from '@/components/studio/Prompteur'"));
  assert.ok(PANNEAU.includes("from '@/components/studio/Prompteur'"));
  // Aucun second composant nommé « Prompteur » ailleurs.
  assert.ok(!/export const Prompteur/.test(PANNEAU), 'le panneau ne définit pas son propre Prompteur');
});

test('le texte reste PRIVÉ : aucun réseau dans la chaîne du prompteur', () => {
  for (const [nom, src] of [['usePrompteur', HOOK], ['PanneauPrompteur', PANNEAU], ['Prompteur', PROMPTEUR]]) {
    const code = codeSeul(src);
    for (const interdit of ['socket', 'axios', 'fetch(', 'supabase', 'emit(', 'WebSocket', 'RTCPeerConnection']) {
      assert.ok(!code.includes(interdit), `${nom} ne doit contenir aucun « ${interdit} »`);
    }
  }
});

test('le panneau est monté dans la session Live, et réservé à qui présente', () => {
  assert.ok(SESSION.includes("from '@/components/session/PanneauPrompteur'"));
  // Hôte ET co-hôte : la même condition que « Caméra externe » ou « Partager l’écran ».
  // Avec `isHost` seul, un co-animateur voyait sa caméra mais pas son prompteur.
  assert.ok(/const prompteurNode = canShare \?/.test(SESSION), 'réservé à qui présente');
  // Monté aux DEUX endroits : colonne desktop et onglet Live mobile.
  const occurrences = (SESSION.match(/\{prompteurNode\}/g) || []).length;
  assert.ok(occurrences >= 2, `attendu au moins 2 montages, trouvé ${occurrences}`);
  assert.ok(SESSION.includes('{isDesktop && prompteurNode}'), 'monté côté desktop');
});

test('le panneau ne vole pas la barre d espace au lecteur audio', () => {
  // L’instance est désormais tenue par la PAGE (et partagée avec l’overlay caméra) :
  // c’est donc là que se décide « pas de raccourcis clavier dans une session ».
  assert.ok(SESSION.includes('usePrompteur(false)'),
    'raccourcis clavier désactivés dans la session Live');
  assert.ok(STUDIO.includes('usePrompteur(true)'),
    'raccourcis actifs sur /studio, qui n’a pas de lecteur audio');
});

test('le panneau est replié par défaut : la caméra garde sa place', () => {
  assert.ok(/useState\(false\)/.test(PANNEAU.split('const [ouvert')[1] || ''),
    'l’état « ouvert » démarre à faux');
});
