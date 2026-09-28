#!/usr/bin/env node
// BANC NAVIGATEUR RÉEL — caméra / écran partagé / calques Live dans le LiveVisioPanel.
//
//   node tests/.banc-camera/run.mjs [racine-frontend] [dossier-captures]
//
// racine-frontend : frontend dont on monte le code (défaut : celui du worktree de ce script).
// dossier-captures : PNG + mesures.json + tableau.md (défaut : <tmp>/banc-camera/derniere).
// Démarre Vite lui-même (API, sans fichier de config écrit sur disque), lance Chromium
// headless avec une caméra simulée RÉELLE, mesure, puis arrête tout. Code de sortie ≠ 0 si ÉCHEC
// (le scénario F est optionnel : mesuré, affiché, mais exclu du code de sortie).
//
// Modes : N = vue normale ; PN = plein écran NATIF (Fullscreen API) ; PC = plein écran de REPLI
// CSS (requestFullscreen / webkitRequestFullscreen supprimés avant chargement, comme iOS Safari).
// Filtres facultatifs :
//   BANC_VP=390x844,1280x800   BANC_SC=C,E   BANC_MODE=normal|plein|natif|css
//   BANC_FS=natif|css (ne garde que ce plein écran ; défaut : les deux)
//   BANC_SEUL=1 : l'hôte seul (cas prod panneau compact)
//   BANC_MEDIA=0 : aucune musique chargée (pas de bouton Play/Pause → assertion 7 sans objet)
//   BANC_ECRAN=display : tenter getDisplayMedia (repli canvas). Défaut : canvas.captureStream —
//   en headless, la piste getDisplayMedia n'atteint jamais la scène (1b toujours rouge, mesuré).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, realpathSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(process.argv[2] || join(ICI, '..', '..'));
const CAPTURES = resolve(process.argv[3] || join(tmpdir(), 'banc-camera', 'derniere'));
const PW = process.env.PLAYWRIGHT_PATH || '/Users/afroboost/.npm/_npx/e41f203b7505f1fb/node_modules/playwright';
const AVEC_MEDIA = process.env.BANC_MEDIA !== '0';
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
  { w: 430, h: 932, mobile: true }, { w: 768, h: 1024, mobile: true }, // tablette portrait
  { w: 1280, h: 800, mobile: false }, { w: 1440, h: 900, mobile: false },
  { w: 1280, h: 633, mobile: false }, // gabarit du constat prod (plein écran 1280×633)
].filter((v) => !process.env.BANC_VP || process.env.BANC_VP.split(',').includes(`${v.w}x${v.h}`));
const SCENARIOS = {
  A: { titre: 'caméra seule', camera: true, ecran: false, disposition: null },
  B: { titre: 'écran seul (caméra coupée)', camera: false, ecran: true, disposition: null },
  C: { titre: 'écran + caméra vignette', camera: true, ecran: true, disposition: 'screen_coach' },
  D: { titre: 'caméra principale + écran vignette', camera: true, ecran: true, disposition: 'coach_screen' },
  E: { titre: 'côte à côte', camera: true, ecran: true, disposition: 'screen_split' },
  F: { titre: 'écran seul + caméra en bande (optionnel)', camera: true, ecran: true, disposition: 'screen_full', optionnel: true },
};
const SC = Object.keys(SCENARIOS).filter((k) => !process.env.BANC_SC || process.env.BANC_SC.split(',').includes(k));
const MODES = ['normal', 'natif', 'css'].filter((m) => {
  const bm = process.env.BANC_MODE;
  if (bm === 'normal' && m !== 'normal') return false;
  if (bm === 'plein' && m === 'normal') return false;
  if ((bm === 'natif' || bm === 'css') && m !== bm) return false;
  if (process.env.BANC_FS && m !== 'normal' && m !== process.env.BANC_FS) return false;
  return true;
});
const COURT = { normal: 'N', natif: 'PN', css: 'PC' };

// Repli CSS : le navigateur n'a PAS de Fullscreen API (iOS Safari) → useFullscreen pose l'overlay.
const SANS_FULLSCREEN_API = () => {
  for (const proto of [Element.prototype, HTMLElement.prototype]) {
    for (const k of ['requestFullscreen', 'webkitRequestFullscreen']) {
      try { delete proto[k]; } catch { /* ignore */ }
      try { Object.defineProperty(proto, k, { value: undefined, configurable: true, writable: true }); } catch { /* ignore */ }
    }
  }
};

// ---- Mesure dans la page ------------------------------------------------------------
function mesurer() {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
  const visible = (el) => { if (!el) return false; const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
  const nomEl = (el) => { if (!el) return 'rien'; const t = el.getAttribute?.('data-testid'); return t ? `[${t}]` : `${el.tagName.toLowerCase()}${el.getAttribute?.('aria-label') ? `(${el.getAttribute('aria-label')})` : ''}${el.closest?.('[data-bt-entete]') ? '<en-tête>' : ''}`; };
  const panel = document.querySelector('[data-testid="live-visio-panel"]');
  const scene = panel?.querySelector('[data-testid="scene-principale"]');
  const barre = [...(panel?.querySelectorAll('[data-testid="visio-controls"],[data-testid="visio-fs-controls"]') || [])].find(visible)
    || [...(panel?.querySelectorAll('[aria-orientation="vertical"]') || [])].find(visible) || null;
  const champ = [...document.querySelectorAll('input[placeholder="Écrire un commentaire…"]')].find(visible) || null;
  const entete = document.querySelector('[data-bt-entete]');
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
  // 6. Boutons de la colonne : le point central de chacun doit tomber SUR lui (rien par-dessus).
  const boutons = barre ? [...barre.querySelectorAll('button')].filter(visible).map((b) => {
    const x = b.getBoundingClientRect();
    const cx = x.left + x.width / 2; const cy = x.top + x.height / 2;
    const dansVp = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight;
    const hit = dansVp ? document.elementFromPoint(cx, cy) : null;
    return { id: b.getAttribute('data-testid') || b.getAttribute('aria-label') || '?', rect: r(b), atteint: !!(hit && b.contains(hit)), recouvert: hit && !b.contains(hit) ? nomEl(hit) : (dansVp ? null : 'hors-viewport') };
  }) : [];
  // 7. Musique : bouton Play/Pause.
  const lecEl = [...document.querySelectorAll('[data-testid="visio-lecture"]')].find(visible) || null;
  let lecture = null;
  if (lecEl) {
    const x = lecEl.getBoundingClientRect(); const cx = x.left + x.width / 2; const cy = x.top + x.height / 2;
    const hit = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
    lecture = { rect: r(lecEl), dansColonne: !!(barre && barre.contains(lecEl)), dansMenu: !!lecEl.closest('[role="menu"]'), atteint: !!(hit && lecEl.contains(hit)), recouvert: hit && !lecEl.contains(hit) ? nomEl(hit) : null };
  }
  // 8. Voile / rectangle dans le calque chat (hors bulles `li`).
  const calqueChat = panel?.querySelector('[data-testid="visio-calque-chat"]') || null;
  const voiles = [];
  let nbMessages = 0;
  if (calqueChat) {
    nbMessages = calqueChat.querySelectorAll('li').length;
    for (const el of [calqueChat, ...calqueChat.querySelectorAll('*')]) {
      if (el.closest('li')) continue;
      const s = getComputedStyle(el);
      const bg = s.backgroundColor;
      const bgC = !(bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg));
      const bgI = s.backgroundImage && s.backgroundImage !== 'none';
      const bd = (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none');
      const b = el.getBoundingClientRect();
      if ((bgC || bgI || bd) && b.width > 0 && b.height > 0) {
        voiles.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 4).join('.')} ${Math.round(b.width)}×${Math.round(b.height)}${bgI ? ' bgImage' : ''}${bgC ? ` bg=${bg}` : ''}${bd ? ' backdrop' : ''}`);
      }
    }
  }
  // 9. Champ commentaire.
  const calquesInput = [...document.querySelectorAll('[data-testid="visio-calque-input"]')];
  const champsTexte = [...document.querySelectorAll('input[aria-label="Écrire un commentaire"], input[placeholder="Écrire un commentaire…"]')].filter(visible);
  const pile = panel?.querySelector('[data-testid="visio-calques-bas"]') || null;
  return {
    viewport: { w: innerWidth, h: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
    pleinEcranNatif: !!document.fullscreenElement,
    apiFullscreen: typeof Element.prototype.requestFullscreen === 'function',
    entete: r(entete), entetePeinte: !document.fullscreenElement,
    zoneCamera: r(panel?.querySelector('[data-testid="visio-camera-area"]')),
    scene: r(scene), barre: r(barre), barreId: barre?.getAttribute('data-testid') || null, champ: r(champ),
    boutons, lecture,
    calqueChat: r(calqueChat), nbMessages, voiles,
    nbCalquesInput: calquesInput.length, nbChampsTexte: champsTexte.length,
    calqueInput: r(calquesInput.find(visible) || calquesInput[0]), calqueInputVisible: calquesInput.some(visible), pile: r(pile),
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

function verifier(m, s, mode, actions) {
  const res = [];
  const ok = (id, cond, detail) => res.push({ id, ok: !!cond, detail });
  const vp = { left: 0, top: 0, right: m.viewport.w, bottom: m.viewport.h };
  const pistesVisibles = (piste) => m.videos.filter((v) => v.piste === piste && v.videoWidth > 0 && v.readyState >= 2);
  const visibleEntier = (v) => v.visible && dedans(v.rect, vp) && (!v.dansScene || dedans(v.rect, m.scene));
  const decrire = (v) => `${v.conteneur} ${fmt(v.rect)} vw=${v.videoWidth} rs=${v.readyState}`
    + (dedans(v.rect, vp) ? '' : ` HORS-VIEWPORT(bas+${Math.round(v.rect.bottom - m.viewport.h)} droite+${Math.round(v.rect.right - m.viewport.w)})`)
    + (v.dansScene && !dedans(v.rect, m.scene) ? ` HORS-SCÈNE(bas+${Math.round(v.rect.bottom - m.scene.bottom)} droite+${Math.round(v.rect.right - m.scene.right)})` : '');

  // 0. le mode demandé est bien celui obtenu (validité du banc)
  if (mode === 'natif') ok('0-mode-natif', m.pleinEcranNatif, `document.fullscreenElement ${m.pleinEcranNatif ? 'présent' : 'ABSENT (le navigateur a refusé la Fullscreen API)'}`);
  if (mode === 'css') ok('0-mode-css', !m.pleinEcranNatif && !m.apiFullscreen, `API Fullscreen ${m.apiFullscreen ? 'ENCORE présente' : 'supprimée'}, natif=${m.pleinEcranNatif}`);

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

  // 6. en-tête ∩ barre = ∅, chaque bouton de la colonne atteignable, clic d'essai sur le micro
  if (!m.barre) {
    ok('6-barre-presente', false, 'barre de commandes introuvable');
  } else {
    if (m.entetePeinte) {
      const inter = chevauche(m.entete, m.barre);
      ok('6-entete-hors-barre', !inter, `en-tête ${fmt(m.entete)} barre ${fmt(m.barre)}${inter ? ` → ${Math.round(Math.min(m.entete.bottom, m.barre.bottom) - Math.max(m.entete.top, m.barre.top))} px de recouvrement` : ''}`);
    }
    // Vue normale : le panneau vit dans la page ; un bouton sous le pli s'atteint en défilant
    // (compté à part). En plein écran, hors viewport = inatteignable.
    const sousPli = mode === 'normal' ? m.boutons.filter((b) => b.recouvert === 'hors-viewport') : [];
    const bloques = m.boutons.filter((b) => !b.atteint && !sousPli.includes(b));
    ok('6-boutons-atteignables', m.boutons.length > 0 && bloques.length === 0,
      bloques.length ? `${bloques.length}/${m.boutons.length} recouverts : ${bloques.map((b) => `${b.id}←${b.recouvert}`).join(', ')}` : `${m.boutons.length} boutons (${m.boutons.map((b) => b.id).join(', ')})${sousPli.length ? ` ; sous le pli (défilement) : ${sousPli.map((b) => b.id).join(', ')}` : ''}`);
    ok('6-micro-clic', actions.micro?.ok, actions.micro?.detail || 'non tenté');
  }
  if (mode === 'natif') {
    ok('6-natif-couvre-ecran', m.zoneCamera && m.zoneCamera.top <= T && m.zoneCamera.left <= T && m.zoneCamera.right >= m.viewport.w - T && m.zoneCamera.bottom >= m.viewport.h - T, `zone caméra ${fmt(m.zoneCamera)} / ${m.viewport.w}×${m.viewport.h}`);
  }
  if (mode === 'css') {
    ok('6-css-sous-entete', m.zoneCamera && m.entete && m.zoneCamera.top >= m.entete.bottom - T, `zone caméra top=${m.zoneCamera ? Math.round(m.zoneCamera.top) : '∅'} en-tête bottom=${m.entete ? Math.round(m.entete.bottom) : '∅'}`);
  }

  // 7. musique : Play/Pause DANS la colonne, atteignable, un vrai clic appelle onPlayPause
  if (AVEC_MEDIA) {
    const l = m.lecture;
    ok('7-lecture-dans-colonne', l && l.dansColonne && !l.dansMenu, l ? `colonne=${l.dansColonne} menu=${l.dansMenu} ${fmt(l.rect)}` : 'bouton visio-lecture absent de la colonne (rangé dans ⋮ ?)');
    ok('7-lecture-atteignable', l && l.atteint, l ? (l.atteint ? 'centre = bouton' : `centre recouvert par ${l.recouvert}`) : 'absent');
    ok('7-lecture-clic', actions.lecture?.ok, actions.lecture?.detail || 'non tenté');
  }

  // 8. aucun voile/rectangle derrière le chat (3 messages)
  if (!m.calqueChat) ok('8-chat-sans-voile', false, 'calque visio-calque-chat absent');
  else ok('8-chat-sans-voile', m.voiles.length === 0, m.voiles.length ? `${m.voiles.length} voile(s) : ${m.voiles.join(' | ')}` : `${m.nbMessages} messages, aucun fond hors bulles`);

  // 9. champ commentaire unique, visible, centré sur la pile, hors barre
  ok('9-champ-unique', m.nbCalquesInput === 1 && m.nbChampsTexte === 1, `calques=${m.nbCalquesInput} champs visibles=${m.nbChampsTexte}`);
  // Vue normale : le panneau vit dans la page (on défile jusqu'à lui) → le champ doit tenir dans la
  // zone caméra ; plein écran : dans le viewport.
  const cadre = mode === 'normal' ? m.zoneCamera : vp;
  ok('9-champ-visible', m.calqueInputVisible && m.calqueInput && dedans(m.calqueInput, cadre), `champ ${fmt(m.calqueInput)} ${mode === 'normal' ? 'zone caméra' : 'viewport'} ${fmt(cadre && cadre.w !== undefined ? cadre : { w: vp.right, h: vp.bottom, left: 0, top: 0 })}`);
  if (m.calqueInput && m.pile) {
    const dc = (m.calqueInput.left + m.calqueInput.w / 2) - (m.pile.left + m.pile.w / 2);
    ok('9-champ-centre', Math.abs(dc) <= 4, `écart au centre de la pile ${dc.toFixed(1)} px (champ ${fmt(m.calqueInput)} pile ${fmt(m.pile)})`);
  } else ok('9-champ-centre', false, 'champ ou pile absent');
  ok('9-champ-hors-barre', !chevauche(m.calqueInput, m.barre), `champ ${fmt(m.calqueInput)} barre ${fmt(m.barre)}`);

  // 10. pas de scroll horizontal = assertion 5 (conservée telle quelle).
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
let echecsOptionnels = 0;
try {
  for (const v of VIEWPORTS) {
    for (const k of SC) {
      const s = SCENARIOS[k];
      for (const mode of MODES) {
        const nom = `${v.w}x${v.h}_${k}_${COURT[mode]}`;
        const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, isMobile: v.mobile, hasTouch: v.mobile, deviceScaleFactor: 1, permissions: ['camera', 'microphone'] });
        if (mode === 'css') await ctx.addInitScript(SANS_FULLSCREEN_API);
        const page = await ctx.newPage();
        const erreursPage = [];
        page.on('pageerror', (e) => erreursPage.push(String(e.message || e)));
        await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
        let m = null; let res = [];
        try {
          await page.goto(`${BASE}?sc=${k}${AVEC_MEDIA ? '' : '&media=0'}${process.env.BANC_SEUL === '1' ? '&seul=1' : ''}${process.env.BANC_ECRAN === 'display' ? '' : '&ecran=canvas'}`, { waitUntil: 'load' });
          await page.click('#demarrer');
          await page.waitForFunction(() => window.__pret || window.__erreur, null, { timeout: 15000 });
          const err = await page.evaluate(() => window.__erreur);
          if (err) throw new Error(`démarrage : ${err}`);
          await page.waitForSelector('[data-testid="live-visio-panel"]');
          if (s.disposition) {
            const btn = page.locator(`[data-testid="scene-disposition-${s.disposition}"]`);
            if (await btn.count()) await btn.first().click();
          }
          if (mode !== 'normal') {
            if (s.ecran) await page.locator('[data-testid="scene-agrandir"]').first().click();
            else await page.locator('[data-testid="visio-tile-enlarge"]').first().click({ force: true });
            await page.waitForFunction(() => document.querySelector('[data-testid="visio-camera-area"]')?.className.includes('fixed'), null, { timeout: 5000 });
            if (mode === 'natif') await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 }).catch(() => {});
          }
          await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="live-visio-panel"] video')].every((x) => x.readyState >= 2 && x.videoWidth > 0), null, { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(500); // ResizeObserver + rendu des calques
          m = await page.evaluate(mesurer);
          await page.screenshot({ path: join(CAPTURES, `${nom}.png`) }).catch(() => {});
          // Actions réelles (après mesure + capture) : clic d'essai micro, vrai clic Play/Pause.
          const actions = {};
          const micro = page.locator('[data-testid="visio-mic-toggle"]:visible, [data-testid="visio-fs-mic"]:visible').first();
          if (await micro.count()) {
            try { await micro.click({ trial: true, timeout: 2000 }); actions.micro = { ok: true, detail: 'clic d\'essai accepté' }; }
            catch (e) { actions.micro = { ok: false, detail: `clic refusé : ${e.message.split('\n').find((x) => /intercepts|outside|not visible|not stable/.test(x))?.trim() || e.message.split('\n')[0]}` }; }
          } else actions.micro = { ok: false, detail: 'micro absent de la colonne' };
          if (AVEC_MEDIA) {
            const lec = page.locator('[data-testid="visio-lecture"]:visible').first();
            if (await lec.count()) {
              const avant = await page.evaluate(() => window.__play || 0);
              try {
                await lec.click({ timeout: 2000 });
                const apres = await page.evaluate(() => window.__play || 0);
                actions.lecture = { ok: apres > avant, detail: `__play ${avant} → ${apres}` };
              } catch (e) {
                actions.lecture = { ok: false, detail: `clic refusé : ${e.message.split('\n').find((x) => /intercepts|outside|not visible|not stable/.test(x))?.trim() || e.message.split('\n')[0]}` };
              }
            } else actions.lecture = { ok: false, detail: 'bouton visio-lecture absent' };
          }
          m.actions = actions;
          res = verifier(m, s, mode, actions);
        } catch (e) {
          res = [{ id: '0-banc', ok: false, detail: `le cas n'a pas pu s'exécuter : ${e.message.split('\n')[0]}` }];
          await page.screenshot({ path: join(CAPTURES, `${nom}.png`) }).catch(() => {});
        }
        if (erreursPage.length) res.push({ id: '0-erreur-js', ok: false, detail: erreursPage.slice(0, 2).join(' / ') });
        await ctx.close();
        const ko = res.filter((x) => !x.ok);
        if (ko.length) { if (s.optionnel) echecsOptionnels += 1; else echecs += 1; }
        lignes.push({ vp: `${v.w}×${v.h}`, sc: k, mode, ok: ko.length === 0, ko });
        toutes.push({ cas: nom, scenario: s.titre, mode, mesures: m, assertions: res });
        process.stdout.write(`${ko.length ? (s.optionnel ? 'échec' : 'ÉCHEC') : 'OK   '} ${nom}${ko.length ? '  ← ' + ko.map((x) => `${x.id}: ${x.detail}`).join(' ; ') : ''}\n`);
      }
    }
  }
} finally {
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
}

writeFileSync(join(CAPTURES, 'mesures.json'), JSON.stringify({ racine: RACINE, date: new Date().toISOString(), media: AVEC_MEDIA, cas: toutes }, null, 2));
// Tableau récapitulatif : viewport × scénario × mode (numéros d'assertions en échec)
const cols = SC.flatMap((k) => MODES.map((mo) => `${k}-${COURT[mo]}`));
const tab = [`| viewport | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`];
for (const v of VIEWPORTS) {
  const vp = `${v.w}×${v.h}`;
  tab.push(`| ${vp} | ${SC.flatMap((k) => MODES.map((mo) => {
    const l = lignes.find((x) => x.vp === vp && x.sc === k && x.mode === mo);
    return l ? (l.ok ? 'OK' : `ÉCHEC(${[...new Set(l.ko.map((x) => x.id.split('-')[0]))].join(',')})`) : '-';
  })).join(' | ')} |`);
}
// Décompte par assertion (hors F optionnel)
const parAssertion = {};
for (const t of toutes) {
  if (SCENARIOS[t.cas.split('_')[1]]?.optionnel) continue;
  for (const a of t.assertions) { parAssertion[a.id] ||= { ok: 0, ko: 0 }; parAssertion[a.id][a.ok ? 'ok' : 'ko'] += 1; }
}
const tabA = ['| assertion | OK | ÉCHEC |', '|---|---|---|', ...Object.keys(parAssertion).sort().map((id) => `| ${id} | ${parAssertion[id].ok} | ${parAssertion[id].ko} |`)];
const src = toutes.find((t) => t.mesures?.sourceEcran)?.mesures.sourceEcran;
const nObl = lignes.filter((l) => !SCENARIOS[l.sc].optionnel).length;
const recap = `\nRacine : ${RACINE}\nCaptures : ${CAPTURES}\nSource écran : ${src || '-'}\nMusique chargée : ${AVEC_MEDIA ? 'oui' : 'non (BANC_MEDIA=0)'}\nScénarios : ${SC.map((k) => `${k}=${SCENARIOS[k].titre}`).join(', ')}\nModes : N=vue normale, PN=plein écran natif, PC=plein écran repli CSS\n\n${tab.join('\n')}\n\n${tabA.join('\n')}\n\n${nObl - echecs}/${nObl} cas OK (hors F)${SC.includes('F') ? ` ; F optionnel : ${echecsOptionnels} échec(s), exclu du code de sortie` : ''}\n`;
writeFileSync(join(CAPTURES, 'tableau.md'), recap);
process.stdout.write(recap);
process.exit(echecs ? 1 : 0);
