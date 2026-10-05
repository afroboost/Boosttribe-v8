// 🪟 Vignettes participants (plein écran) : agrandir / réduire / déplacer / redimensionner, présentation LOCALE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placementVignette, tailleDepuisPoignee, VIGNETTE_MAX, VIGNETTE_MAX_REDIM, VIGNETTE_PLANCHER_ABSOLU_PX } from './.build/sceneLive.mjs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const RESERVE_BARRE = 60, CHAMP = 64;

for (const [L, H] of [[360, 740], [390, 844], [430, 932], [1280, 720]]) {
  test(`${L}×${H} : bornée hors barre et hors champ, ratio 16:9, jamais hors écran`, () => {
    for (const pos of [{ x: 2, y: 2 }, { x: -1, y: -1 }, { x: 0.99, y: 0.99 }]) {
      for (const taille of [0.01, 0.3, 5]) {
        const p = placementVignette({ largeurScene: L, hauteurScene: H, reserveDroitePx: RESERVE_BARRE, reserveBasPx: CHAMP, position: pos, taille, tailleMax: VIGNETTE_MAX_REDIM });
        assert.ok(Math.abs(p.hauteur - (p.largeur * 9) / 16) < 1e-6, 'ratio 16:9');
        assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.largeur <= L && p.y + p.hauteur <= H, 'dans l’écran');
        assert.ok(p.x + p.largeur <= L - RESERVE_BARRE + 1e-6, 'jamais sous la barre verticale');
        assert.ok(p.y + p.hauteur <= H - CHAMP + 1e-6, 'jamais sur le champ commentaire');
        assert.ok(p.largeur >= Math.min(VIGNETTE_PLANCHER_ABSOLU_PX, L - RESERVE_BARRE) - 1, 'jamais minuscule');
        assert.ok(p.largeur <= VIGNETTE_MAX_REDIM * L + 1e-6, 'jamais plus grande que le plafond');
      }
    }
  });
}

test('poignée : la largeur suit le doigt, bornée par placementVignette ; défaut 40 % sans tailleMax', () => {
  assert.equal(tailleDepuisPoignee({ largeurScene: 1000, gaucheVignettePx: 100, pointeurPx: 500 }), 0.4);
  assert.equal(tailleDepuisPoignee({ largeurScene: 1000, gaucheVignettePx: 100, pointeurPx: 50 }), 0.05);
  const scene = placementVignette({ largeurScene: 1280, hauteurScene: 720, taille: 0.9 });
  assert.ok(scene.largeur <= VIGNETTE_MAX * 1280 + 1e-6);               // vignette de scène : plafond historique inchangé
});

test('plein écran caméra : une vignette par participant, clé = identité (jamais le rang)', () => {
  const p = src('components/session/LiveVisioPanel.tsx');
  assert.match(p, /!modeContenu && fsOthers\.map\(\(p, i\) => \{/);
  assert.match(p, /<VignetteFlottante\s+key=\{p\.id\}/);
  assert.match(p, /const etat = flottantes\[p\.id\];/);
  assert.match(p, /setFlottantes\(\(f\) => \(\{ \.\.\.f, \[p\.id\]: v \}\)\)/);
  assert.match(p, /onAgrandir=\{\(\) => setSpotlightId\(p\.id\)\}/);                        // la BONNE piste en grand
  assert.match(p, /data-testid="visio-fs-reduire-vignette"/);
  assert.match(p, /camFullscreen && modeContenu && fsOthers\.length > 0 && \(\s*<div[^>]*data-testid="visio-fs-thumbs"/);
});

test('UNE seule implémentation : la vignette de scène passe par VignetteFlottante', () => {
  const p = src('components/session/LiveVisioPanel.tsx');
  assert.ok(/<VignetteFlottante[\s\S]{0,900}?testId="scene-vignette"/.test(p), 'scène : composant unique');
  assert.doesNotMatch(p, /deplacerVignette|glisse\.current/);
  const v = src('components/session/VignetteFlottante.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // code seul
  assert.match(v, /touch-none/);                                                              // doigt : pas de défilement de page
  assert.doesNotMatch(v, /livekit|publishTrack|MediaStream|fetch\(/i);                       // présentation locale seulement
});

test('barre verticale inchangée', () => {
  const p = src('components/session/LiveVisioPanel.tsx');
  assert.match(p, /className="absolute top-1\/2 -translate-y-1\/2"\n\s+style=\{\{ right: camFullscreen \? 'calc\(0\.75rem \+ env\(safe-area-inset-right\)\)' : '0\.75rem' \}\}/);
});

test('« Faire ma promo » : jamais pour l’hôte ; participant connecté + promo activée seulement', () => {
  const s = src('pages/SessionPage.tsx');
  // 01/10 : la décision dépend de la PROPRIÉTÉ de cette session (host_id), jamais du rôle global.
  assert.match(s, /actionPromoParticipant\(\{ estProprietaire: estProprietaireSession, connecte: !!user, config: livePromo\.config \}\)/);   // 05/10
  assert.match(s, /promoHote=\{\(estProprietaireSession && livePromo\.config\?\.enabled\)/);   // l'hôte : « Promotions live »
});

test('menu ⋮ : jamais tronqué, il défile quand l’écran est court', () => {
  const m = src('components/session/MenuActions.tsx');
  assert.match(m, /overflow-y-auto overscroll-contain/);
  assert.match(m, /maxHeight: `calc\(100dvh - \$\{pos\.bottom\}px - 0\.5rem - env\(safe-area-inset-top\)\)`/);
});
