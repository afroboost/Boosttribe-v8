// 📣 01/10 PARTIE A — la promo diffusée, déplaçable / redimensionnable par l'hôte, même place pour tous.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placementPromo, PROMO_LARGEUR_MIN_PX, PROMO_LARGEUR_MAX } from './.build/sceneLive.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const dansScene = (p, L, H, rd, rb) => p.x >= 0 && p.y >= 0 && p.x + p.largeur <= L - Math.min(rd, L - p.largeur) + 0.5 && p.y + p.hauteur <= H + 0.5;

for (const [L, H] of [[320, 568], [360, 740], [375, 667], [390, 844], [412, 915], [430, 932], [1280, 720]]) {
  test(`${L}×${H} : bornée, hors barre, lisible, jamais plus grande que la scène`, () => {
    const rd = L < 600 ? 56 : 72, rb = 64, h = 110;
    for (const layout of [{ x: 0, y: 0, w: 0.4 }, { x: 0.9, y: 0.95, w: 0.4 }, { x: 0.5, y: 0.5, w: 2 }, { x: -1, y: -1, w: 0.01 }]) {
      const p = placementPromo({ largeurScene: L, hauteurScene: H, reserveDroitePx: rd, reserveBasPx: rb, layout, hauteurContenuPx: h });
      assert.ok(p.largeur >= Math.min(PROMO_LARGEUR_MIN_PX, L - 16) - 0.5, `plancher (${p.largeur})`);
      assert.ok(p.largeur <= PROMO_LARGEUR_MAX * L + 0.5, `plafond (${p.largeur})`);
      assert.ok(dansScene(p, L, H, rd, rb), JSON.stringify({ layout, p }));
      assert.ok(p.x + p.largeur <= L - rd + 0.5 || L - rd < Math.min(PROMO_LARGEUR_MIN_PX, L - 16), 'hors barre verticale');
      assert.ok(p.y + p.hauteur <= H - rb + 0.5, 'hors champ commentaire');
    }
  });
}

test('pas de ratio imposé : la hauteur suit le contenu', () => {
  const a = placementPromo({ largeurScene: 1280, hauteurScene: 720, layout: { x: 0.1, y: 0.1, w: 0.4 }, hauteurContenuPx: 90 });
  const b = placementPromo({ largeurScene: 1280, hauteurScene: 720, layout: { x: 0.1, y: 0.1, w: 0.4 }, hauteurContenuPx: 160 });
  assert.equal(a.largeur, b.largeur); assert.equal(a.hauteur, 90); assert.equal(b.hauteur, 160);
});

test('geste seulement par les poignées : « Découvrir » / « Arrêter » restent des clics ; tactile sans défilement', () => {
  const f = codeSeul(lire('components/session/LivePromoFlottante.tsx'));
  assert.match(f, /onPointerDown=\{\(e\) => debut\(e, 'deplacer'\)\}/);
  assert.match(f, /onPointerDown=\{\(e\) => debut\(e, 'taille'\)\}/);
  assert.equal((f.match(/touch-none/g) || []).length, 2);
  assert.match(f, /tailleDepuisPoignee\(\{ largeurScene: s\.width/);                         // mécanique de VignetteFlottante
  assert.match(f, /if \(l\) oRef\.current\.onFin\?\.\(l\);/);                                 // UNE écriture par geste
  assert.match(f, /if \(!debut\) return null;/);                                               // participant : aucune poignée
  const b = codeSeul(lire('components/session/LivePromoBanner.tsx'));
  assert.doesNotMatch(b, /onPointerDown/);                                                     // la bannière elle-même ne capte rien
});

test('position par défaut inchangée (pile du bas) ; position serveur pour tous ; hôte seul', () => {
  const v = codeSeul(lire('components/session/LiveVisioPanel.tsx'));
  assert.match(v, /\{promoBanniere && !promoPos\.layout \? \(/);                               // défaut : en bas, comme avant
  assert.match(v, /<CalquePromoPlace pos=\{promoPos\}/);
  const s = codeSeul(lire('pages/SessionPage.tsx'));
  assert.match(s, /promoLayout=\{livePromo\.active\?\.layout \?\? null\}/);
  assert.match(s, /onPromoLayout=\{estProprietaireSession \? onPromoLayout : undefined\}/);
  assert.match(s, /promoLayout\(promoActifId, l\)\.then\(\(\) => promoRafraichirEtSignaler\(\)\)/);
  const h = codeSeul(lire('hooks/useLivePromo.ts'));
  assert.match(h, /JSON\.stringify\(prev\.layout \?\? null\) === JSON\.stringify\(r\.promo\.layout \?\? null\)/);  // participants suivent
});
