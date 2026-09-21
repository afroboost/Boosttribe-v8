/**
 * MESURE RÉELLE (Chromium) — panneau STUDIO : une colonne, aucun chevauchement, clics réels.
 *
 * Pré-requis : `cd frontend && yarn dev --port 5182` (harnais : tests/harness/studio.html, qui rend
 * les VRAIS LiveVisioPanel + StudioPanel + useStudio + SceneRenderer avec des sources synthétiques).
 * Lancer : PW_PATH=~/.claude/skills/gstack/node_modules/playwright node tests/studio.ui.cjs
 * Options : STUDIO_URL (défaut http://localhost:5182), STUDIO_SHOTS (dossier des captures).
 *
 * Pour chaque viewport (1280×800, 1440×900, 390×844) :
 *  1. géométrie — intersection nulle entre les éléments VISIBLES du panneau (sections, boutons,
 *     onglets, libellés hors imbrication), aucun libellé coupé (scrollWidth ≤ clientWidth), aucun
 *     débordement horizontal de la page (scrollWidth ≤ innerWidth) ;
 *  2. clics réels → état réellement changé (lu sur `window.__studio.state` ET le DOM) : ouvrir /
 *     fermer le studio, onglet Preview / Programme, ouvrir Sources, ouvrir Scènes, choisir une scène
 *     (→ preview), Take (→ programme = ancienne preview), Cut (→ programme change immédiatement).
 * Code de sortie 1 au premier rouge. Chaque compteur est imprimé : rien n'est « prouvé » sans lui.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');

const BASE = process.env.STUDIO_URL || 'http://localhost:5182';
const SHOTS = process.env.STUDIO_SHOTS || path.join(__dirname, '.captures', 'studio');
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { nom: '1280x800', width: 1280, height: 800, mobile: false },
  { nom: '1440x900', width: 1440, height: 900, mobile: false },
  { nom: '390x844', width: 390, height: 844, mobile: true },
];

let rouges = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) rouges++; };

/** Géométrie du panneau : chevauchements entre éléments visibles NON imbriqués, textes coupés, overflow. */
async function mesurerGeometrie(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="studio-panel"]');
    if (!panel) return { absent: true };
    const sel = '[data-testid], button, [role="tab"], [role="option"], h3, summary, label, li, video';
    const visibles = [...panel.querySelectorAll(sel)].filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
    // Boîte RÉELLEMENT visible : la boîte englobante, rognée par chaque ancêtre qui coupe (overflow ≠ visible —
    //    ex. le corps défilable du tiroir mobile). Sans ce rognage, un élément défilé sous l'en-tête « chevaucherait ».
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      let b = { l: r.left, t: r.top, r: r.right, b: r.bottom };
      for (let p = el.parentElement; p && p !== panel.parentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const pr = p.getBoundingClientRect();
          b = { l: Math.max(b.l, pr.left), t: Math.max(b.t, pr.top), r: Math.min(b.r, pr.right), b: Math.min(b.b, pr.bottom) };
        }
      }
      return b;
    };
    const inter = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    // La COMPOSITION d'une scène (PiP = vignette PAR-DESSUS l'image principale) est voulue : on ne compare
    //    pas deux boîtes vidéo d'une même zone entre elles. Tout le reste (UI) doit être disjoint.
    const dansScene = (el) => !!el.closest('[data-studio-zone]');
    const chevauchements = [];
    for (let i = 0; i < visibles.length; i++) {
      for (let j = i + 1; j < visibles.length; j++) {
        const A = visibles[i]; const B = visibles[j];
        if (A.contains(B) || B.contains(A)) continue;             // imbrication = normal
        if (dansScene(A) && dansScene(B)) continue;               // composition de scène (PiP) = voulue
        const a = rect(A); const b = rect(B);
        const s = inter(a, b);
        if (s > 1) {                                              // tolérance 1 px² (arrondis)
          const nom = (el) => el.getAttribute('data-testid') || el.getAttribute('aria-label') || `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 24)}`;
          chevauchements.push({ a: nom(A), b: nom(B), px2: Math.round(s) });
        }
      }
    }
    // Libellés coupés : tout élément visible portant du texte direct.
    const textesCoupes = [];
    for (const el of panel.querySelectorAll('span, button, summary, h3, label, option, div')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1) textesCoupes.push({ texte: el.textContent.trim().slice(0, 30), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
    const pr = panel.getBoundingClientRect();
    const horsPanneau = [];
    for (const el of visibles) {
      const r = el.getBoundingClientRect();
      if (r.right > pr.right + 1 || r.left < pr.left - 1) horsPanneau.push(el.getAttribute('data-testid') || el.tagName);
    }
    return {
      absent: false,
      elements: visibles.length,
      chevauchements,
      textesCoupes,
      horsPanneau,
      overflowPage: document.documentElement.scrollWidth - window.innerWidth,
      overflowPanneau: panel.scrollWidth - panel.clientWidth,
      largeurPanneau: Math.round(pr.width),
    };
  });
}

const etat = (page) => page.evaluate(() => {
  const s = window.__studio.state;
  return { preview: s.preview ? s.preview.type : null, program: s.program ? s.program.type : null };
});

async function scenario(browser, vp) {
  console.log(`\n▶ ${vp.nom}${vp.mobile ? ' (mobile)' : ' (desktop)'}`);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('  pageerror', e.message); rouges++; });
  await page.goto(`${BASE}/tests/harness/studio.html?mobile=${vp.mobile ? 1 : 0}&open=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="studio-panel"]');
  await page.waitForTimeout(300);

  // ── 1. Géométrie à l'ouverture ─────────────────────────────────────────
  const g0 = await mesurerGeometrie(page);
  await page.screenshot({ path: path.join(SHOTS, `studio-${vp.nom}-ouvert.png`), fullPage: !vp.mobile });
  console.log(`  panneau ${g0.largeurPanneau}px, ${g0.elements} éléments visibles, overlaps=${g0.chevauchements.length}, textesCoupés=${g0.textesCoupes.length}, horsPanneau=${g0.horsPanneau.length}, overflowPage=${g0.overflowPage}px, overflowPanneau=${g0.overflowPanneau}px`);
  for (const c of g0.chevauchements.slice(0, 12)) console.log(`      overlap ${c.a} × ${c.b} = ${c.px2} px²`);
  for (const t of g0.textesCoupes.slice(0, 8)) console.log(`      coupé « ${t.texte} » ${t.scrollWidth}>${t.clientWidth}`);
  ok(g0.chevauchements.length === 0, 'aucun chevauchement entre éléments visibles');
  ok(g0.textesCoupes.length === 0, 'aucun libellé coupé');
  ok(g0.horsPanneau.length === 0, 'aucun élément hors du panneau');
  ok(g0.overflowPage <= 0, 'aucun débordement horizontal de la page');
  ok(g0.overflowPanneau <= 0, 'aucun débordement horizontal du panneau');

  // ── 2. Clics réels ──────────────────────────────────────────────────────
  // Onglets Preview / Programme
  await page.click('[data-testid="studio-onglet-preview"]');
  ok((await page.getAttribute('[data-testid="studio-onglet-preview"]', 'aria-selected')) === 'true' && await page.isVisible('[data-testid="studio-preview"]'), 'onglet Preview : sélectionné, zone preview rendue');
  await page.click('[data-testid="studio-onglet-program"]');
  ok((await page.getAttribute('[data-testid="studio-onglet-program"]', 'aria-selected')) === 'true' && await page.isVisible('[data-testid="studio-program"]') && !(await page.isVisible('[data-testid="studio-preview"]')), 'onglet Programme : sélectionné, zone programme seule');

  // Sources : repliée → ouverte, liste des sources disponibles seulement
  ok(!(await page.isVisible('[data-testid="studio-sources-liste"]')), 'Sources repliées au départ');
  await page.click('[data-testid="studio-sources-toggle"]');
  const nbSources = await page.locator('[data-testid="studio-sources-liste"] [data-studio-source-kind]').count();
  ok(await page.isVisible('[data-testid="studio-sources-liste"]') && nbSources === 3, `Sources ouvertes : ${nbSources} sources listées (coach, caméra 2, écran) + participant`);
  const gS = await mesurerGeometrie(page);
  ok(gS.chevauchements.length === 0 && gS.overflowPage <= 0, `Sources ouvertes : overlaps=${gS.chevauchements.length}, overflow=${gS.overflowPage}`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `studio-${vp.nom}-sources.png`), fullPage: !vp.mobile });

  // Scènes : repliées → ouvertes, liste = scenesDisponibles (7 avec coach+cam2+participant+écran)
  ok(!(await page.isVisible('[data-testid="studio-scenes-liste"]')), 'Scènes repliées au départ');
  await page.click('[data-testid="studio-scenes-toggle"]');
  const scenes = await page.locator('[data-testid="studio-scenes-liste"] [role="option"]').allInnerTexts();
  ok(scenes.length === 7, `Scènes ouvertes : ${scenes.length} scènes — ${scenes.map((s) => s.trim()).join(' · ')}`);
  const gSc = await mesurerGeometrie(page);
  ok(gSc.chevauchements.length === 0 && gSc.textesCoupes.length === 0 && gSc.overflowPage <= 0, `Scènes ouvertes : overlaps=${gSc.chevauchements.length}, textesCoupés=${gSc.textesCoupes.length}, overflow=${gSc.overflowPage}`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `studio-${vp.nom}-scenes.png`), fullPage: !vp.mobile });

  // Sélection d'une scène → preview change (état + onglet Preview bascule + zone preview rendue)
  const e0 = await etat(page);
  ok(e0.preview === null && e0.program === null, `état initial : preview=${e0.preview}, program=${e0.program}`);
  await page.click('[data-testid="studio-scene-split_50"]');
  const e1 = await etat(page);
  ok(e1.preview === 'split_50', `clic scène 50/50 → preview=${e1.preview}`);
  ok((await page.getAttribute('[data-testid="studio-onglet-preview"]', 'aria-selected')) === 'true', 'la scène choisie s\'affiche dans PREVIEW (onglet basculé)');
  ok((await page.locator('[data-testid="studio-preview"] [data-studio-source]').count()) === 2, 'preview rend 2 boîtes (coach + participant)');
  ok((await page.getAttribute('[data-testid="studio-scene-split_50"]', 'aria-selected')) === 'true', 'scène marquée sélectionnée');

  // TAKE → programme = ancienne preview ; onglet Programme ; liseré
  ok(!(await page.isDisabled('[data-testid="studio-take"]')), 'Take actif quand une preview existe');
  await page.click('[data-testid="studio-take"]');
  const e2 = await etat(page);
  ok(e2.program === 'split_50' && e2.preview === 'split_50', `Take → program=${e2.program} (= ancienne preview), preview conservée=${e2.preview}`);
  ok((await page.getAttribute('[data-testid="studio-program"]', 'data-studio-antenne')) === 'true', 'zone Programme marquée à l\'antenne');
  ok((await page.locator('[data-testid="studio-program"] [data-studio-source]').count()) === 2, 'programme rend les 2 boîtes de la scène');

  // CUT : choisir une autre scène en preview, puis Cut → programme change immédiatement
  await page.click('[data-testid="studio-scene-coach_full"]');
  const e3 = await etat(page);
  ok(e3.preview === 'coach_full' && e3.program === 'split_50', `preview=${e3.preview}, programme inchangé=${e3.program} (pas de cut automatique)`);
  await page.click('[data-testid="studio-cut"]');
  const e4 = await etat(page);
  ok(e4.program === 'coach_full', `Cut → program=${e4.program} immédiatement`);
  ok((await page.locator('[data-testid="studio-program"] [data-studio-source]').count()) === 1, 'programme rend 1 boîte (coach plein écran)');
  const gA = await mesurerGeometrie(page);
  ok(gA.chevauchements.length === 0 && gA.textesCoupes.length === 0 && gA.overflowPage <= 0, `à l'antenne : overlaps=${gA.chevauchements.length}, textesCoupés=${gA.textesCoupes.length}, overflow=${gA.overflowPage}`);
  await page.waitForTimeout(250);   // fin des `transition-colors` (150 ms) : la capture montre l'état stable
  await page.screenshot({ path: path.join(SHOTS, `studio-${vp.nom}-antenne.png`), fullPage: !vp.mobile });

  // PiP : scène avec vignette → 4 coins visibles, clic change l'état
  await page.click('[data-testid="studio-scene-pip"]');
  ok(await page.isVisible('[data-testid="studio-pip"]'), 'scène PiP → réglage de la vignette visible');
  await page.click('[data-testid="studio-pip-tl"]');
  ok((await page.evaluate(() => window.__studio.state.pip)) === 'tl', 'clic coin haut-gauche → pip=tl');
  const gP = await mesurerGeometrie(page);
  for (const c of gP.chevauchements.slice(0, 6)) console.log(`      overlap ${c.a} × ${c.b} = ${c.px2} px²`);
  ok(gP.chevauchements.length === 0 && gP.overflowPage <= 0, `PiP : overlaps=${gP.chevauchements.length}, overflow=${gP.overflowPage}`);

  // Participant : sélecteur → état
  await page.selectOption('[data-testid="studio-participant"]', 'p2');
  ok((await page.evaluate(() => window.__studio.state.selectedParticipant)) === 'p2', 'sélecteur participant → selectedParticipant=p2');

  // Replier Scènes / Sources
  await page.click('[data-testid="studio-scenes-toggle"]');
  ok(!(await page.isVisible('[data-testid="studio-scenes-liste"]')), 'Scènes repliées au 2e clic');
  await page.click('[data-testid="studio-sources-toggle"]');
  ok(!(await page.isVisible('[data-testid="studio-sources-liste"]')), 'Sources repliées au 2e clic');

  // Fermer / rouvrir le studio (✕, puis bouton de la barre sur desktop ; Échap sur mobile)
  await page.click('[data-testid="studio-close"]');
  ok(!(await page.isVisible('[data-testid="studio-panel"]')), 'fermer (✕) → panneau absent du DOM');
  const e5 = await etat(page);
  ok(e5.program === 'coach_full', `fermé : l'état de la régie survit (program=${e5.program})`);
  if (!vp.mobile) {
    await page.click('[data-testid="studio-toggle"]');
    ok(await page.isVisible('[data-testid="studio-panel"]'), 'ouvrir (icône de la barre) → panneau rendu');
    ok((await page.getAttribute('[data-testid="studio-toggle"]', 'aria-pressed')) === 'true', 'icône de la barre : état pressé');
    await page.keyboard.press('Escape');
    ok(!(await page.isVisible('[data-testid="studio-panel"]')), 'Échap → panneau fermé');
  } else {
    // Mobile : entrée par le menu ⋮ → item « Studio »
    await page.click('[data-testid="visio-menu"]').catch(() => {});
    const item = page.locator('[data-testid="visio-studio"]');
    if (await item.count()) { await item.click(); ok(await page.isVisible('[data-testid="studio-panel"]'), 'ouvrir (menu ⋮ → Studio) → panneau rendu'); }
  }

  // Boutons morts : chaque bouton visible du panneau (rouvert) a un gestionnaire React.
  if (!(await page.isVisible('[data-testid="studio-panel"]'))) {
    if (!vp.mobile) await page.click('[data-testid="studio-toggle"]'); else { await page.click('[data-testid="visio-menu"]').catch(() => {}); await page.locator('[data-testid="visio-studio"]').click().catch(() => {}); }
  }
  await page.click('[data-testid="studio-sources-toggle"]');
  await page.click('[data-testid="studio-scenes-toggle"]');
  const morts = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="studio-panel"]');
    const out = [];
    for (const b of panel.querySelectorAll('button, select')) {
      const k = Object.keys(b).find((x) => x.startsWith('__reactProps$'));
      const props = k ? b[k] : {};
      if (!props.onClick && !props.onChange) out.push(b.getAttribute('data-testid') || b.getAttribute('aria-label') || b.textContent.trim());
    }
    return out;
  });
  ok(morts.length === 0, `boutons sans gestionnaire : ${morts.length}${morts.length ? ' → ' + morts.join(', ') : ''}`);

  await ctx.close();
}

(async () => {
  const b = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const vp of VIEWPORTS) await scenario(b, vp);
  } finally { await b.close(); }
  console.log(`\nCaptures : ${SHOTS}`);
  console.log(rouges === 0 ? '\nVERT — 0 rouge' : `\nROUGE — ${rouges} assertion(s) en échec`);
  process.exit(rouges === 0 ? 0 : 1);
})();
