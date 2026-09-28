#!/usr/bin/env node
// BANC NAVIGATEUR RÉEL — caméra / écran partagé dans le LiveVisioPanel.
//
//   node tests/.banc-camera/run.mjs [racine-frontend] [dossier-captures]
//
// racine-frontend : frontend dont on monte le code (défaut : celui du worktree de ce script).
// dossier-captures : PNG + mesures.json (défaut : <tmp>/banc-camera/derniere).
// Démarre Vite lui-même (API, sans fichier de config écrit sur disque), lance Chromium
// headless avec une caméra simulée RÉELLE, mesure, puis arrête tout. Code de sortie ≠ 0 si ÉCHEC.
// Filtres facultatifs : BANC_VP=390x844,1280x800  BANC_SC=C,E  BANC_MODE=normal|plein
// BANC_ECRAN=canvas : piste écran canvas.captureStream (sinon getDisplayMedia, repli canvas).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, realpathSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(process.argv[2] || join(ICI, '..', '..'));
const CAPTURES = resolve(process.argv[3] || join(tmpdir(), 'banc-camera', 'derniere'));
const PW = process.env.PLAYWRIGHT_PATH || '/Users/afroboost/.npm/_npx/e41f203b7505f1fb/node_modules/playwright';
mkdirSync(CAPTURES, { recursive: true });

const req = createRequire(join(RACINE, 'package.json'));
// Entrées ESM des paquets de la racine (req.resolve donnerait la version CJS).
const esm = (nom) => {
  const dir = join(RACINE, 'node_modules', nom);
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const e = pj.exports?.['.'];
  const imp = typeof e === 'string' ? e : (e?.import?.default || e?.import || e?.default || pj.module || pj.main);
  return import(pathToFileURL(join(dir, imp)).href);
};
const { createServer } = await esm('vite');
const reactMod = await esm('@vitejs/plugin-react');
const react = reactMod.default || reactMod;
const tailwind = req('tailwindcss');
const autoprefixer = req('autoprefixer');
const twConfig = req(join(RACINE, 'tailwind.config.js'));
const { chromium } = createRequire(import.meta.url)(PW);

const nm = join(RACINE, 'node_modules');
const server = await createServer({
  configFile: false,
  root: ICI,
  cacheDir: join(tmpdir(), 'banc-camera-vite', Buffer.from(RACINE).toString('hex').slice(-24)),
  logLevel: 'error',
  plugins: [react()],
  resolve: { alias: { '@': join(RACINE, 'src') }, dedupe: ['react', 'react-dom'] },
  css: {
    postcss: {
      plugins: [
        tailwind({ ...twConfig, content: [join(RACINE, 'src/**/*.{js,jsx,ts,tsx}'), join(ICI, '*.{html,tsx}')] }),
        autoprefixer(),
      ],
    },
  },
  envPrefix: ['VITE_', 'REACT_APP_'],
  define: { global: 'globalThis' },
  server: {
    port: 5311, strictPort: false, host: '127.0.0.1',
    fs: { allow: [ICI, RACINE, existsSync(nm) ? realpathSync(nm) : nm] },
  },
});
await server.listen();
const BASE = server.resolvedUrls.local[0];

const VIEWPORTS = [
  { w: 360, h: 740, mobile: true }, { w: 390, h: 844, mobile: true }, { w: 414, h: 896, mobile: true },
  { w: 430, h: 932, mobile: true }, { w: 1280, h: 800, mobile: false }, { w: 1440, h: 900, mobile: false },
  { w: 1280, h: 633, mobile: false }, // gabarit du constat prod (plein écran 1280×633)
].filter((v) => !process.env.BANC_VP || process.env.BANC_VP.split(',').includes(`${v.w}x${v.h}`));
const SCENARIOS = {
  A: { titre: 'caméra seule', camera: true, ecran: false, disposition: null },
  B: { titre: 'écran seul (caméra coupée)', camera: false, ecran: true, disposition: null },
  C: { titre: 'écran + caméra vignette', camera: true, ecran: true, disposition: 'screen_coach' },
  D: { titre: 'caméra principale + écran vignette', camera: true, ecran: true, disposition: 'coach_screen' },
  E: { titre: 'côte à côte', camera: true, ecran: true, disposition: 'screen_split' },
  F: { titre: 'écran seul + caméra en bande', camera: true, ecran: true, disposition: 'screen_full' },
};
const SC = Object.keys(SCENARIOS).filter((k) => !process.env.BANC_SC || process.env.BANC_SC.split(',').includes(k));
const MODES = ['normal', 'plein'].filter((m) => !process.env.BANC_MODE || process.env.BANC_MODE === m);

// ---- Mesure dans la page ------------------------------------------------------------
function mesurer() {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
  const visible = (el) => { if (!el) return false; const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
  const panel = document.querySelector('[data-testid="live-visio-panel"]');
  const scene = panel?.querySelector('[data-testid="scene-principale"]');
  const barre = [...(panel?.querySelectorAll('[aria-orientation="vertical"]') || [])].find(visible) || null;
  const champ = [...document.querySelectorAll('input[placeholder="Écrire un commentaire…"]')].find(visible) || null;
  // Conteneur de SCÈNE le plus proche (la tuile CameraTile interne n'en est pas un).
  const SEL = ['scene-vignette', 'scene-cote', 'scene-ecran', 'scene-camera', 'scene-vignettes', 'visio-fs-thumb']
    .map((t) => `[data-testid="${t}"]`).join(',');
  const lum = (v) => {
    try {
      const c = document.createElement('canvas'); c.width = 32; c.height = 18;
      const x = c.getContext('2d'); x.drawImage(v, 0, 0, 32, 18);
      const d = x.getImageData(0, 0, 32, 18).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return Math.round(s / (d.length / 4));
    } catch { return -1; }
  };
  const videos = [...(panel?.querySelectorAll('video') || [])].map((v) => {
    const cont = v.closest(SEL) || v.closest('[data-testid="camera-tile"]');
    const piste = v.srcObject && v.srcObject === window.__camStream ? 'camera' : v.srcObject && v.srcObject === window.__ecranStream ? 'ecran' : 'autre';
    // Surface réellement peinte (object-fit contain/cover) dans la boîte de l'élément.
    const b = v.getBoundingClientRect(); const fit = getComputedStyle(v).objectFit;
    let peint = { w: b.width, h: b.height };
    if (fit === 'contain' && v.videoWidth && v.videoHeight) {
      const k = Math.min(b.width / v.videoWidth, b.height / v.videoHeight); peint = { w: v.videoWidth * k, h: v.videoHeight * k };
    }
    return {
      piste, conteneur: cont?.getAttribute('data-testid') || null, dansScene: !!(scene && scene.contains(v)),
      videoWidth: v.videoWidth, videoHeight: v.videoHeight, readyState: v.readyState, visible: visible(v),
      objectFit: fit, peint, rect: r(v), rectConteneur: r(cont), luminance: lum(v),
    };
  });
  return {
    viewport: { w: innerWidth, h: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
    pleinEcranNatif: !!document.fullscreenElement,
    zoneCamera: r(panel?.querySelector('[data-testid="visio-camera-area"]')),
    scene: r(scene), barre: r(barre), champ: r(champ),
    ecranZone: r(panel?.querySelector('[data-testid="scene-ecran"]')), coteZone: r(panel?.querySelector('[data-testid="scene-cote"]')),
    vignette: r(panel?.querySelector('[data-testid="scene-vignette"]')),
    vignetteContenu: panel?.querySelector('[data-testid="scene-vignette"]')?.getAttribute('data-contenu') || null,
    disposition: panel?.querySelector('[data-testid="scene-live"]')?.getAttribute('data-disposition') || null,
    videos, sourceEcran: window.__sourceEcran || null,
  };
}

// ---- Assertions ---------------------------------------------------------------------
const T = 1; // tolérance px
const dedans = (a, b) => a && b && a.left >= b.left - T && a.top >= b.top - T && a.right <= b.right + T && a.bottom <= b.bottom + T;
const chevauche = (a, b) => a && b && a.left < b.right - T && b.left < a.right - T && a.top < b.bottom - T && b.top < a.bottom - T;
const aire = (x) => (x ? x.w * x.h : 0);
const fmt = (x) => (x ? `${Math.round(x.w)}×${Math.round(x.h)}@(${Math.round(x.left)},${Math.round(x.top)})` : '∅');

function verifier(m, s) {
  const res = [];
  const ok = (id, cond, detail) => res.push({ id, ok: !!cond, detail });
  const vp = { left: 0, top: 0, right: m.viewport.w, bottom: m.viewport.h };
  const pistesVisibles = (piste) => m.videos.filter((v) => v.piste === piste && v.videoWidth > 0 && v.readyState >= 2);
  const visibleEntier = (v) => v.visible && dedans(v.rect, vp) && (!v.dansScene || dedans(v.rect, m.scene));
  const decrire = (v) => `${v.conteneur} ${fmt(v.rect)} vw=${v.videoWidth} rs=${v.readyState}`
    + (dedans(v.rect, vp) ? '' : ` HORS-VIEWPORT(bas+${Math.round(v.rect.bottom - m.viewport.h)} droite+${Math.round(v.rect.right - m.viewport.w)})`)
    + (v.dansScene && !dedans(v.rect, m.scene) ? ` HORS-SCÈNE(bas+${Math.round(v.rect.bottom - m.scene.bottom)} droite+${Math.round(v.rect.right - m.scene.right)})` : '');

  // 1. caméra active ⇒ vidéo caméra réelle, entièrement visible (viewport + scène)
  if (s.camera) {
    const cams = pistesVisibles('camera');
    ok('1-camera-visible', cams.some(visibleEntier), cams.length ? cams.map(decrire).join(' | ') : 'aucune vidéo caméra prête');
  }
  if (s.ecran) {
    const ecr = pistesVisibles('ecran');
    ok('1b-ecran-visible', ecr.some(visibleEntier), ecr.length ? ecr.map(decrire).join(' | ') : 'aucune vidéo écran prête');
  }
  // 2. vignette ≠ barre verticale, ≠ champ commentaire
  if (m.vignette) {
    const b = m.barre; const c = m.champ;
    const sousBarre = chevauche(m.vignette, b);
    ok('2-vignette-hors-barre', !sousBarre,
      b ? `vignette.right=${Math.round(m.vignette.right)} barre.left=${Math.round(b.left)}${sousBarre ? ` → ${Math.round(m.vignette.right - b.left)} px sous la barre` : ''}` : 'barre verticale absente');
    ok('2-vignette-hors-champ', !chevauche(m.vignette, c), c ? `vignette ${fmt(m.vignette)} champ ${fmt(c)}` : 'champ absent');
  }
  // 3. vignette caméra ≥ 120 px de large
  if (s.camera) {
    const vign = m.videos.filter((v) => v.piste === 'camera' && ['scene-vignette', 'scene-vignettes', 'visio-fs-thumb'].includes(v.conteneur));
    const petites = vign.filter((v) => v.rect.w < 120);
    if (vign.length) ok('3-vignette-camera-120', petites.length === 0, vign.map((v) => `${v.conteneur} ${Math.round(v.rect.w)}×${Math.round(v.rect.h)}`).join(' | '));
  }
  // 4. côte à côte : chaque zone ≥ 35 % de la scène, la caméra peint sa moitié
  if (s.disposition === 'screen_split') {
    const A = aire(m.scene);
    const pe = A ? aire(m.ecranZone) / A : 0; const pc = A ? aire(m.coteZone) / A : 0;
    const cam = m.videos.find((v) => v.piste === 'camera' && v.conteneur === 'scene-cote');
    const couvre = cam && m.coteZone ? (cam.peint.w * cam.peint.h) / aire(m.coteZone) : 0;
    const ecran = m.videos.find((v) => v.piste === 'ecran' && v.dansScene);
    const peintEcran = ecran && A ? (ecran.peint.w * ecran.peint.h) / A : 0;
    ok('4-cote-a-cote-35pc', pe >= 0.35 && pc >= 0.35, `zone écran ${(pe * 100).toFixed(0)} % | zone caméra ${(pc * 100).toFixed(0)} % (image écran peinte ${(peintEcran * 100).toFixed(0)} % de la scène)`);
    ok('4-camera-pas-moitie-noire', cam && cam.videoWidth > 0 && couvre >= 0.5 && cam.luminance > 8,
      cam ? `caméra peint ${(couvre * 100).toFixed(0)} % de sa moitié, luminance ${cam.luminance}` : 'pas de vidéo caméra dans scene-cote');
  }
  // 5. pas de défilement horizontal
  ok('5-pas-de-scroll-horizontal', m.scrollWidth <= m.viewport.w, `scrollWidth=${m.scrollWidth} / ${m.viewport.w}`);
  return res;
}

// ---- Exécution ----------------------------------------------------------------------
const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen', '--autoplay-policy=no-user-gesture-required'],
});
const lignes = [];
const toutes = [];
let echecs = 0;
try {
  for (const v of VIEWPORTS) {
    for (const k of SC) {
      const s = SCENARIOS[k];
      for (const mode of MODES) {
        const nom = `${v.w}x${v.h}_${k}_${mode}`;
        const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, isMobile: v.mobile, hasTouch: v.mobile, deviceScaleFactor: 1, permissions: ['camera', 'microphone'] });
        const page = await ctx.newPage();
        const erreursPage = [];
        page.on('pageerror', (e) => erreursPage.push(String(e.message || e)));
        await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
        let m = null; let res = [];
        try {
          await page.goto(`${BASE}?sc=${k}${process.env.BANC_ECRAN === 'canvas' ? '&ecran=canvas' : ''}`, { waitUntil: 'load' });
          await page.click('#demarrer');
          await page.waitForFunction(() => window.__pret || window.__erreur, null, { timeout: 15000 });
          const err = await page.evaluate(() => window.__erreur);
          if (err) throw new Error(`démarrage : ${err}`);
          await page.waitForSelector('[data-testid="live-visio-panel"]');
          if (s.disposition) {
            const btn = page.locator(`[data-testid="scene-disposition-${s.disposition}"]`);
            if (await btn.count()) await btn.first().click();
          }
          if (mode === 'plein') {
            if (s.ecran) await page.locator('[data-testid="scene-agrandir"]').first().click();
            else await page.locator('[data-testid="visio-tile-enlarge"]').first().click({ force: true });
            await page.waitForFunction(() => document.querySelector('[data-testid="visio-camera-area"]')?.className.includes('fixed'), null, { timeout: 5000 });
          }
          await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="live-visio-panel"] video')].every((x) => x.readyState >= 2 && x.videoWidth > 0), null, { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(500); // ResizeObserver + rendu des calques
          m = await page.evaluate(mesurer);
          res = verifier(m, s);
        } catch (e) {
          res = [{ id: '0-banc', ok: false, detail: `le cas n'a pas pu s'exécuter : ${e.message.split('\n')[0]}` }];
        }
        if (erreursPage.length) res.push({ id: '0-erreur-js', ok: false, detail: erreursPage.slice(0, 2).join(' / ') });
        await page.screenshot({ path: join(CAPTURES, `${nom}.png`) }).catch(() => {});
        await ctx.close();
        const ko = res.filter((x) => !x.ok);
        if (ko.length) echecs += 1;
        lignes.push({ vp: `${v.w}×${v.h}`, sc: k, mode, ok: ko.length === 0, ko });
        toutes.push({ cas: nom, scenario: s.titre, mesures: m, assertions: res });
        process.stdout.write(`${ko.length ? 'ÉCHEC' : 'OK   '} ${nom}${ko.length ? '  ← ' + ko.map((x) => `${x.id}: ${x.detail}`).join(' ; ') : ''}\n`);
      }
    }
  }
} finally {
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
}

writeFileSync(join(CAPTURES, 'mesures.json'), JSON.stringify({ racine: RACINE, date: new Date().toISOString(), cas: toutes }, null, 2));
// Tableau récapitulatif : viewport × scénario × mode
const cols = SC.flatMap((k) => MODES.map((mo) => `${k}-${mo === 'normal' ? 'N' : 'PE'}`));
const tab = [`| viewport | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`];
for (const v of VIEWPORTS) {
  const vp = `${v.w}×${v.h}`;
  tab.push(`| ${vp} | ${SC.flatMap((k) => MODES.map((mo) => { const l = lignes.find((x) => x.vp === vp && x.sc === k && x.mode === mo); return l ? (l.ok ? 'OK' : `ÉCHEC(${l.ko.map((x) => x.id.split('-')[0]).join(',')})`) : '-'; })).join(' | ')} |`);
}
const src = toutes.find((t) => t.mesures?.sourceEcran)?.mesures.sourceEcran;
const recap = `\nRacine : ${RACINE}\nCaptures : ${CAPTURES}\nSource écran : ${src || '-'}\nScénarios : ${SC.map((k) => `${k}=${SCENARIOS[k].titre}`).join(', ')} ; N=vue normale, PE=plein écran\n\n${tab.join('\n')}\n\n${lignes.length - echecs}/${lignes.length} cas OK\n`;
writeFileSync(join(CAPTURES, 'tableau.md'), recap);
process.stdout.write(recap);
process.exit(echecs ? 1 : 0);
