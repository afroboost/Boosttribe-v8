#!/usr/bin/env node
/**
 * 🛡️ CONTRAT DE NON-RÉGRESSION DU LIVE — une seule commande :  yarn test:live-contract
 *
 *   1. suite front complète (node --test)          — règles pures + branchements
 *   2. harnais NAVIGATEUR (Chromium, vrai GPU)     — vrais composants CLIQUÉS ; caméra/beauté MESURÉES
 *                                                    en 1080p, 1440p et 4K (caméras factices)
 *   3. banc LiveKit LOCAL (vrai serveur SFU)       — hôte publie, spectateur reçoit : simulcast,
 *                                                    adaptiveStream, dynacast, changement de caméra,
 *                                                    caméra coupée/rallumée, reconnexion, jamais noir
 *   4. tests SERVEUR du Live (pytest)              — préférences (parcours), promo, invité, fin du Live
 *   5. build de production (vite, dossier temporaire)
 *   6. --prod : fumée LECTURE SEULE sur la production (pages publiques : pas d'écran noir, pas de 500)
 *
 * Options : --sans-build  --sans-serveur  --sans-suite  --prod
 * Sortie : un tableau « fonction protégée → OK / ÉCHEC ». Code 1 si une seule ligne échoue.
 * Voir docs/LIVE_CONTRACT.md. AUCUN push / déploiement si ce contrat n'est pas entièrement vert.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(ICI, '..', '..');
const RACINE = path.resolve(FRONT, '..');
const args = new Set(process.argv.slice(2));
const resultats = [];   // { fonction, preuve, ok, detail }
const noter = (fonction, preuve, ok, detail = '') => resultats.push({ fonction, preuve, ok: !!ok, detail: String(detail) });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
// 🎨 Looks : la caméra factice de Chromium livre ~20 i/s RÉELS (mesuré). Un look ne doit perdre AUCUNE
//    cadence : sortie ≥ 90 % des images/s de la source, et ≥ 15 i/s absolus. Coût GPU 4K plafonné :
//    une image 4K (embellissement + look) doit tenir dans 1/30 s = 33 ms (budget d'une caméra 30 i/s).
const RATIO_IPS_LOOK = 0.9;
const IPS_MIN_LOOK = 15;
const BUDGET_MS_4K = 33;
const chronos = [];
const mesuresLooks = [];

function lancer(cmd, a, cwd, env = {}) {
  const r = spawnSync(cmd, a, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, sortie: `${r.stdout || ''}${r.stderr || ''}` };
}

// ── 1. Suite front complète ───────────────────────────────────────────────────────────────────────
if (!args.has('--sans-suite')) {
  const r = lancer('npm', ['run', '-s', 'test'], FRONT);
  const pass = Number((r.sortie.match(/^# pass (\d+)/m) || [])[1] || 0);
  const fail = Number((r.sortie.match(/^# fail (\d+)/m) || [])[1] || 0);
  const echecs = [...r.sortie.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]).slice(0, 8);
  noter('Suite front complète', `${pass} réussis / ${fail} échoués`, r.code === 0 && fail === 0 && pass > 0, echecs.join(' | '));
}

// ── Outils : Playwright, LiveKit local ────────────────────────────────────────────────────────────
function trouverPlaywright() {
  const lieux = [process.env.PLAYWRIGHT_DIR, FRONT, path.join(os.homedir(), '.claude/skills/gstack')].filter(Boolean);
  for (const l of lieux) {
    try { return createRequire(path.join(l, 'package.json'))('playwright'); } catch { /* lieu suivant */ }
  }
  return null;
}
function trouverLiveKit() {
  const lieux = [process.env.LIVEKIT_SERVER, path.join(os.homedir(), '.cache/livekit/livekit-server'), '/opt/homebrew/bin/livekit-server', '/usr/local/bin/livekit-server'];
  return lieux.find((l) => l && fs.existsSync(l)) || null;
}
const portLibre = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jetonLiveKit(cle, secret, identite, publier) {
  const t = Math.floor(Date.now() / 1000);
  const corps = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: cle, sub: identite, name: identite, nbf: t - 10, exp: t + 3600,
    video: { room: 'contrat-live', roomJoin: true, canPublish: publier, canSubscribe: true } })}`;
  return `${corps}.${crypto.createHmac('sha256', secret).update(corps).digest('base64url')}`;
}
async function demarrerLiveKit(bin) {
  const port = await portLibre(); const tcp = await portLibre();
  const debut = 40000 + Math.floor(Math.random() * 20000);
  const cle = 'contratkey'; const secret = crypto.randomBytes(24).toString('hex');
  const conf = `port: ${port}\nbind_addresses: ["127.0.0.1"]\nrtc:\n  tcp_port: ${tcp}\n  port_range_start: ${debut}\n  port_range_end: ${debut + 200}\n  use_external_ip: false\n  node_ip: 127.0.0.1\nkeys:\n  ${cle}: ${secret}\nlogging:\n  level: warn\n`;
  const p = spawn(bin, ['--config-body', conf], { stdio: ['ignore', 'pipe', 'pipe'] });
  let journal = ''; p.stdout.on('data', (d) => { journal += d; }); p.stderr.on('data', (d) => { journal += d; });
  for (let i = 0; i < 50; i++) {
    await attendre(200);
    const ok = await new Promise((r) => http.get(`http://127.0.0.1:${port}/`, (res) => { res.resume(); r(true); }).on('error', () => r(false)));
    if (ok) return { url: `ws://127.0.0.1:${port}`, cle, secret, arreter: () => p.kill('SIGTERM'), journal: () => journal };
  }
  p.kill('SIGTERM');
  throw new Error(`LiveKit local ne démarre pas : ${journal.slice(-300)}`);
}

// ── 2 + 3. Harnais navigateur + banc LiveKit ──────────────────────────────────────────────────────
async function compilerHarnais() {
  const esbuild = createRequire(path.join(FRONT, 'package.json'))('esbuild');
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'contrat-live-'));
  // Le harnais intercepte le réseau des appels promo : seul le JETON est factice (stubs/paymentApi.ts).
  const jetonFactice = { name: 'jeton-factice', setup(b) {
    b.onResolve({ filter: /^@\/lib\/paymentApi$/ }, (a) => (a.importer.endsWith(`${path.sep}livePromoApi.ts`) ? { path: path.join(ICI, 'stubs', 'paymentApi.ts') } : undefined));
  } };
  await esbuild.build({ entryPoints: [path.join(ICI, 'harnais.tsx')], bundle: true, format: 'iife', jsx: 'automatic', logLevel: 'error',
    alias: { '@': path.join(FRONT, 'src') }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
    outfile: path.join(dist, 'h.js'), plugins: [jetonFactice] });
  // Les VRAIES classes Tailwind de l'app (sinon aucune mise en page : défilement, positions, tailles faux).
  const css = lancer('npx', ['tailwindcss', '-c', 'tailwind.config.js', '-i', 'src/index.css', '-o', path.join(dist, 'app.css')], FRONT);
  if (css.code !== 0) throw new Error(`CSS Tailwind : ${css.sortie.slice(-300)}`);
  const feuille = fs.readFileSync(path.join(dist, 'app.css'), 'utf8').replace(/@import url\([^)]*\);?/g, '');   // aucune police distante
  fs.writeFileSync(path.join(dist, 'app.css'), feuille);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body style="background:#111;margin:0"><div id="root"></div><script src="h.js"></script>');
  return dist;
}

async function harnaisNavigateur() {
  const pw = trouverPlaywright();
  if (!pw) { noter('Harnais navigateur', 'Playwright introuvable (PLAYWRIGHT_DIR)', false, 'contrat INCOMPLET : installer Playwright ou poser PLAYWRIGHT_DIR'); return; }
  let dist;
  try { dist = await compilerHarnais(); } catch (e) { noter('Harnais navigateur', 'compilation du harnais', false, String(e.message || e).slice(0, 400)); return; }
  const serveur = http.createServer((q, s) => {
    const f = path.join(dist, q.url === '/' ? 'index.html' : q.url.slice(1).split('?')[0]);
    if (!f.startsWith(dist) || !fs.existsSync(f)) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); s.end(fs.readFileSync(f));
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${serveur.address().port}/`;
  const nav = await pw.chromium.launch({ args: ['--use-fake-device-for-media-stream=device-count=2', '--use-fake-ui-for-media-stream',
    '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--disable-features=WebRtcHideLocalIpsWithMdns', '--enable-experimental-web-platform-features'] });
  const erreurs = [];
  const dialogues = [];
  const nouvellePage = async (o = {}) => {
    const ctx = await nav.newContext({ viewport: o.viewport || { width: 1280, height: 800 }, deviceScaleFactor: o.dpr || 1, permissions: ['camera', 'microphone'] });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    p.on('dialog', (d) => { dialogues.push(d.message()); d.accept().catch(() => {}); });   // « Terminer le Live ? » → confirmé
    await p.goto(url);
    return p;
  };
  try {
    const page = await nouvellePage();
    const ouvrirMenu = async (role) => {
      await page.evaluate((r) => window.contrat.menu(r), role);
      await page.click('[data-testid="visio-menu"]', { timeout: 5000 }).catch(() => {});
      return page.$$eval('[data-testid="visio-menu-liste"] [data-testid]', (l) => l.map((e) => e.getAttribute('data-testid')));
    };
    const visible = async (id) => !!(await page.$(`[data-testid="${id}"]`));
    // Un élément absent = une ligne en ÉCHEC, jamais l'arrêt de tout le harnais.
    const clic = async (id) => { try { await page.click(`[data-testid="${id}"]`, { timeout: 5000 }); } catch { return []; } return page.evaluate(() => [...window.contrat.appels]); };
    // Item de l'hôte : dans la barre s'il y tient, sinon dans le menu ⋮ (même composant, même gestionnaire).
    const cliquerItemHote = async (id) => { await page.evaluate(() => window.contrat.menu('hote')); if (!(await visible(id))) await page.click('[data-testid="visio-menu"]'); return clic(id); };

    // ── Menu ⋮ : participant connecté ──
    let items = await ouvrirMenu('participant');
    noter('Menu ⋮ — s\'ouvre (participant)', 'clic ⋮ → liste', items.length > 0, items.join(','));
    noter('Faire la promo — présent (participant)', 'menu ⋮ cliqué', items.includes('visio-faire-ma-promo'), items.join(','));
    noter('Faire la promo — ouvre la fenêtre', 'clic → onFaireMaPromo', (await clic('visio-faire-ma-promo')).includes('promo:ouvrir'));
    items = await ouvrirMenu('participant');
    noter('Quitter — présent (participant)', 'menu ⋮', items.includes('visio-leave'));
    noter('Quitter — action', 'clic → onLeaveLive', (await clic('visio-leave')).includes('quitter'));
    noter('Terminer — jamais chez un participant', 'menu ⋮ + barre', !items.includes('visio-terminer-live') && !(await visible('visio-terminer-live')));
    items = await ouvrirMenu('participant');
    noter('Commentaires — masquer/afficher', 'clic → bascule', (await clic('visio-toggle-commentaires')).includes('commentaires'));

    // ── Faire ma promo : la fenêtre ENVOIE la demande (réseau intercepté, aucun serveur réel) ──
    await page.evaluate(() => window.contrat.promoParticipant());
    await page.fill('[data-testid="live-promo-titre-champ"]', 'Cours de salsa samedi');
    await page.click('[data-testid="live-promo-envoyer"]');
    await page.waitForTimeout(300);
    const envoi = await page.evaluate(() => ({ r: window.contrat.requetes.map((x) => ({ ...x })), a: [...window.contrat.appels] }));
    const demande = envoi.r.find((x) => x.url.endsWith('/live-promo/requests'));
    noter('Faire la promo — demande envoyée (participant)', 'POST /live-promo/requests (offre + titre)', !!demande
      && demande.corps.offre_id === 'offre-30' && demande.corps.titre === 'Cours de salsa samedi' && demande.corps.session_id === 'CONTRAT1-ABCDEF'
      && envoi.a.includes('promo:envoyee'), JSON.stringify(envoi.r).slice(0, 200));

    // ── Invité SANS compte (Gratuit par lien/QR) : item visible → connexion ──
    items = await ouvrirMenu('invite');
    noter('Faire la promo — invité sans compte', 'item visible → connexion', items.includes('visio-faire-ma-promo')
      && (await clic('visio-faire-ma-promo')).includes('promo:connexion'));
    await page.evaluate(() => window.contrat.promoConnexion());
    noter('Faire la promo — invité : « Se connecter »', 'clic → page de connexion', (await clic('promo-connexion-go')).includes('connexion:go'));
    items = await ouvrirMenu('participant_promo_fermee');
    noter('Faire la promo — absente si promo fermée', 'menu ⋮', !items.includes('visio-faire-ma-promo'));

    // ── Hôte ──
    items = await ouvrirMenu('hote');
    noter('Faire la promo — jamais chez l\'hôte', 'menu ⋮ hôte', !items.includes('visio-faire-ma-promo'));
    noter('Terminer — distinct pour l\'hôte', 'Terminer ET Quitter présents', (items.includes('visio-terminer-live') || await visible('visio-terminer-live')) && items.includes('visio-leave'), items.join(','));
    noter('Embellissement — entrée hôte', 'menu ⋮', items.includes('visio-embellir'));
    noter('Promotions live — entrée hôte', 'menu ⋮', items.includes('visio-promo-hote'));
    noter('Look vidéo — entrée hôte', 'menu ⋮', items.includes('visio-look'));
    noter('Look vidéo — sélection', 'clic Noir & blanc', (await clic('look-noir_blanc')).includes('look:noir_blanc'));
    items = await ouvrirMenu('participant');
    noter('Look vidéo — jamais chez un participant', 'menu ⋮', !items.includes('visio-look'));
    items = await ouvrirMenu('hote');
    noter('Promotions live — action', 'clic → fenêtre hôte', (await clic('visio-promo-hote')).includes('promo:hote'));
    noter('Terminer — confirmation puis action', 'clic → « Terminer le Live pour tout le monde ? » → onTerminerLive',
      (await cliquerItemHote('visio-terminer-live')).includes('terminer') && dialogues.some((d) => /Terminer le Live/.test(d)), dialogues.join(' | '));
    noter('Mute/unmute — bouton de la barre', 'clic micro → gestionnaire', (await cliquerItemHote('visio-mic-toggle')).includes('micro'));
    noter('Prompteur — entrée hôte', 'clic → onTogglePrompteur', (await cliquerItemHote('visio-prompteur-toggle')).includes('prompteur'));
    noter('Sélecteur caméra — entrée hôte', 'clic → onSources', (await cliquerItemHote('visio-camera-menu')).includes('sources'));
    noter('Changement caméra — entrée hôte', 'clic → onFlipCamera', (await cliquerItemHote('visio-camera-flip')).includes('changer-camera'));

    // ── Chat / commentaires / questions → prompteur de l'hôte ──
    await page.evaluate(() => window.contrat.chat());
    await page.fill('input[aria-label="Écrire un commentaire"]', 'Super séance, merci !');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1300);                                   // anti-flood du chat : 1 message / 1,2 s
    await page.click('[aria-label="Marquer comme question"]');
    await page.fill('input[aria-label="Écrire un commentaire"]', 'Est-ce que le cours de samedi est maintenu ?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const texteChat = await page.textContent('[data-testid="live-chat-overlay"]');
    noter('Chat — message envoyé et affiché', 'saisie + Entrée → bulle visible', texteChat.includes('Super séance, merci !') && texteChat.includes('cours de samedi'), texteChat.slice(0, 120));
    const fileHote = await page.evaluate(() => window.contrat.questionsVuesParLHote());
    noter('Questions — « ? » → file du prompteur de l\'hôte', 'question seule (pas le commentaire)', fileHote.length === 1 && fileHote[0].includes('samedi'), JSON.stringify(fileHote));

    // ── Prompteur ──
    await page.evaluate(() => window.contrat.prompteur());
    await page.waitForTimeout(200);
    const txtPrompteur = await page.textContent('[data-testid="prompteur-overlay"]');
    await page.click('[data-testid="prompteur-overlay-play"]');
    let enLecture = 'false';
    for (let i = 0; i < 25 && enLecture !== 'true'; i++) { await page.waitForTimeout(200); enLecture = await page.textContent('[data-testid="lecture"]'); }   // décompte 3-2-1 éventuel
    noter('Prompteur — texte affiché, lecture', 'texte + clic Lecture', txtPrompteur.includes('Bienvenue dans le Live') && enLecture === 'true', `${txtPrompteur.slice(0, 80)} | lecture=${enLecture}`);

    // ── Droits des invités : Écoute uniquement / Accès visio ──
    await page.evaluate(() => window.contrat.acces('account'));
    await page.click('text=Écoute uniquement');
    const a1 = await page.evaluate(() => [...window.contrat.appels]);
    await page.evaluate(() => window.contrat.acces('guest'));
    await page.click('text=Accès visio');
    const a2 = await page.evaluate(() => [...window.contrat.appels]);
    noter('Écoute uniquement / Accès visio — sélecteur', 'clic → guest / account', a1.includes('acces:guest') && a2.includes('acces:account'));

    // ── Invitation : QR = lien de partage, décodé ──
    const q = await page.evaluate(() => window.contrat.qr('QRTEST12-ABCDEF'));
    noter('Invitation — QR décodé = lien de la session', q.detecteur ? 'BarcodeDetector' : 'BarcodeDetector ABSENT', q.detecteur && q.decode === q.lien && /\/promo\/QRTEST12-ABCDEF$/.test(q.lien), `${q.lien} → ${q.decode}`);

    // ── Micro : vrai composant, AEC/NS/AGC réellement actifs, mute/unmute ──
    await page.evaluate(() => window.contrat.micro());
    await page.click('[data-testid="mic-toggle-btn"]');
    await page.waitForTimeout(800);
    const m1 = await page.evaluate(() => ({ e: window.contrat.etatMicro(), a: [...window.contrat.appels] }));
    noter('Audio — AEC + NS + AGC actifs sur la piste réelle', 'getSettings() du micro', m1.e.piste && m1.e.echoCancellation === true && m1.e.noiseSuppression === true && m1.e.autoGainControl === true, JSON.stringify(m1.e));
    await page.click('[data-testid="mic-toggle-btn"]');
    await page.waitForTimeout(500);
    const m2 = await page.evaluate(() => ({ e: window.contrat.etatMicro(), a: [...window.contrat.appels] }));
    noter('Mute/unmute — micro réel', 'clic → on, re-clic → off (piste libérée)', m1.a.includes('micro:on') && m2.a.includes('micro:off') && !m2.e.vivante, `${m2.a.join(',')} vivante=${m2.e.vivante}`);

    // ── Caméra + embellissement (vrai hook + vrai bouton) en 1080p / 1440p / 4K ──
    for (const [h, w] of [[1080, 1920], [1440, 2560], [2160, 3840]]) {
      const r = await page.evaluate((x) => window.contrat.pipelineBeaute(x), h);
      const nom = h === 2160 ? '4K' : `${h}p`;
      noter(`Caméra ${nom} — capturée`, `source ${w}×${h}`, r.off1.w === w && r.off1.h === h, `${r.off1.w}×${r.off1.h}`);
      noter(`Beauté OFF ${nom} — piste brute`, 'aucun processeur, pleine résolution, non noire', !r.off1.processeur && r.off1.w === w && r.off1.luma > 10 && r.off1.variation > 3,
        JSON.stringify(r.off1));
      noter(`Beauté ON ${nom} — pleine résolution`, 'sortie = source, couleur, non noire', !!r.on && r.on.actif && r.on.w === w && r.on.h === h && r.on.ecartCouleur > 2 && r.on.luma > 10,
        JSON.stringify(r.on));
      noter(`Beauté retour OFF ${nom}`, 'processeur retiré, piste brute', !r.off2.processeur && r.off2.w === w && r.off2.luma > 10, JSON.stringify(r.off2));
    }
    // ── 🎨 Looks vidéo : le VRAI shader pixel par pixel, puis chaque look mesuré en 1080p / 1440p / 4K ──
    const gpu = await page.evaluate(() => window.contrat.looksGpu());
    const g = Object.fromEntries(gpu.map((x) => [x.id, x]));
    noter('Look Original — identité (shader)', 'mire de couleurs : sortie = entrée', g.original.errMax <= 1, JSON.stringify(g.original));
    noter('Look Noir & blanc — vrai monochrome (shader)', 'R=G=B sur chaque pixel', g.noir_blanc.rgbMax <= 1 && g.noir_blanc.errMax <= 2, JSON.stringify(g.noir_blanc));
    const autres = gpu.filter((x) => !['original', 'noir_blanc'].includes(x.id));
    noter('Looks — rendu = formule de référence (shader)', 'Cinéma chaud/froid, Teal & Orange, Contraste doux : écart ≤ 2/255, image réellement modifiée',
      autres.every((x) => x.errMax <= 2 && x.diffSource >= 2), JSON.stringify(autres));
    for (const [h, w] of [[1080, 1920], [1440, 2560], [2160, 3840]]) {
      const c = await page.evaluate((o) => window.contrat.chronoGpu(o), { largeur: w, hauteur: h });
      chronos.push({ hauteur: h, c });
      if (h === 2160) noter('Looks 4K — coût GPU réel', `embellissement + look ≤ ${BUDGET_MS_4K} ms par image 4K (synchronisé)`,
        c.every((x) => x.ms <= BUDGET_MS_4K), c.map((x) => `${x.beaute}/${x.look}:${x.ms}`).join(' '));
      for (const b of ['off', 'moyen']) {
        const r = await page.evaluate((o) => window.contrat.mesurerLooks(o), { hauteur: h, beaute: b });
        mesuresLooks.push(r);
        const nom = `${h === 2160 ? '4K' : `${h}p`} beauté ${b === 'off' ? 'OFF' : 'ON'}`;
        const L = Object.fromEntries(r.lignes.map((x) => [x.look, x]));
        noter(`Looks ${nom} — chacun sélectionnable, pleine résolution`, `6 looks ; sortie = source ${w}×${h}`,
          r.brut.w === w && r.brut.h === h && r.lignes.length === 6 && r.lignes.every((x) => x.w === w && x.h === h && x.taille.largeur === w), r.lignes.map((x) => `${x.look}:${x.sortie}`).join(' '));
        noter(`Looks ${nom} — changement sans coupure`, 'même piste vivante, aucune image noire, aucun palier ni coupure',
          r.lignes.every((x) => x.memePiste && x.noires === 0) && r.paliers.length === 0 && !r.coupure, JSON.stringify({ paliers: r.paliers, coupure: r.coupure, noires: r.lignes.map((x) => x.noires) }));
        noter(`Looks ${nom} — fluidité`, `chaque look ≥ ${RATIO_IPS_LOOK * 100} % des i/s de la source (${r.brut.ips}) et ≥ ${IPS_MIN_LOOK} i/s`,
          r.lignes.every((x) => x.ipsSortie >= Math.max(IPS_MIN_LOOK, r.brut.ips * RATIO_IPS_LOOK)), r.lignes.map((x) => `${x.look}:${x.ipsSortie}`).join(' '));
        noter(`Look Noir & blanc ${nom} — piste de sortie R=G=B`, 'écart couleur ≈ 0 (source colorée)', L.noir_blanc.ecartCouleur <= 1 && L.noir_blanc.ecartSource > 4,
          `sortie ${L.noir_blanc.ecartCouleur} / source ${L.noir_blanc.ecartSource}`);
        if (b === 'off') noter(`Look Original ${nom} — intact`, 'sortie ≈ source au même instant',
          Math.abs(L.original.ecartCouleur - L.original.ecartSource) <= Math.max(3, L.original.ecartSource * 0.1) && Math.abs(L.original.luma - L.original.lumaSource) <= 4,
          `sortie ${L.original.ecartCouleur}/${L.original.luma} source ${L.original.ecartSource}/${L.original.lumaSource}`);
      }
    }
    await page.close();

    // ── Banc LiveKit LOCAL ──
    const bin = trouverLiveKit();
    if (!bin) {
      noter('Banc LiveKit local', 'livekit-server introuvable', false, 'poser LIVEKIT_SERVER, ou : brew fetch livekit puis extraire bin/livekit-server dans ~/.cache/livekit/');
    } else {
      const lk = await demarrerLiveKit(bin);
      try {
        await bancLiveKit(lk, nouvellePage);
      } catch (e) {
        noter('Banc LiveKit local', 'exécution', false, `${String(e && e.message || e).slice(0, 300)} | ${lk.journal().slice(-200)}`);
      } finally { lk.arreter(); }
    }
    noter('Harnais — aucune erreur JS', 'pageerror', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  } catch (e) {
    noter('Harnais navigateur', 'exécution', false, String(e && e.message || e).slice(0, 300));
  } finally {
    await nav.close(); serveur.close(); fs.rmSync(dist, { recursive: true, force: true });
  }
}

async function bancLiveKit(lk, nouvellePage) {
  const hote = await nouvellePage();
  // Spectateur sur un écran 4K : adaptiveStream choisit la couche selon la taille CSS de la vidéo.
  const spect = await nouvellePage({ viewport: { width: 3840, height: 2160 } });
  const jH = jetonLiveKit(lk.cle, lk.secret, 'hote', true), jS = jetonLiveKit(lk.cle, lk.secret, 'spectateur', false);
  try {
    const h = await hote.evaluate((o) => window.contrat.lk.hotePublier(o), { url: lk.url, jeton: jH, hauteur: 2160, beaute: 'moyen' });
    noter('Room — adaptiveStream + dynacast', 'options de la Room réelle (hôte)', h.options.adaptiveStream && h.options.dynacast, JSON.stringify(h.options));
    noter('Caméra 4K — publiée', 'piste 3840×2160@30 publiée', h.w === 3840 && h.h === 2160 && (h.fps || 0) >= 29, `${h.w}×${h.h}@${h.fps}`);
    noter('Simulcast — 3 couches', 'encodages q/h/f de l\'émetteur', h.simulcast === 3 && ['q', 'h', 'f'].every((k) => h.couches[k]), JSON.stringify(h.couches));
    noter('Débit 4K non plafonné', 'couche « f » = 8 Mbit/s (préréglage 4K)', (h.couches.f || {}).debitMax === 8000000, JSON.stringify(h.couches.f));
    noter('Beauté ON publiée', 'processeur posé sur la piste publiée', h.processeur);

    const grand = await spect.evaluate((o) => window.contrat.lk.spectateurRejoindre(o), { url: lk.url, jeton: jS, largeur: 1920, hauteur: 1080 });
    noter('Réception — grand écran', 'reçu ≥ 1080p, non noir, ≥ 10 i/s', grand.h >= 1080 && grand.luma > 10 && grand.variation > 3 && grand.imagesParSeconde >= 10, JSON.stringify(grand));
    // 4K REÇUE : l'estimation de bande passante de WebRTC monte par paliers ; on laisse le temps à la couche « f ».
    const recu4k = await spect.evaluate(() => window.contrat.lk.spectateurTaille(3840, 2160, 25000));
    const hote4k = await hote.evaluate(() => window.contrat.lk.etatHote());
    noter('Réception 4K — écran 4K plein écran', 'couche « f » 3840×2160 envoyée et reçue', recu4k.w === 3840 && recu4k.h === 2160 && recu4k.luma > 10,
      `${recu4k.w}×${recu4k.h} ; hôte f=${JSON.stringify(hote4k.couches.f)}`);
    const petit = await spect.evaluate(() => window.contrat.lk.spectateurTaille(320, 180, 5000));
    noter('adaptiveStream — vignette', 'petite vidéo → petite couche reçue', petit.h > 0 && petit.h <= 540 && petit.luma > 10, `${petit.w}×${petit.h}`);
    await hote.waitForTimeout(3000);
    const hd = await hote.evaluate(() => window.contrat.lk.etatHote());
    noter('Dynacast — couche haute coupée si personne ne la regarde', 'encodage « f » inactif chez l\'hôte', (hd.couches.f || {}).actif === false, JSON.stringify(hd.couches));
    const grand2 = await spect.evaluate(() => window.contrat.lk.spectateurTaille(1920, 1080, 6000));
    noter('adaptiveStream — retour plein écran', 'grande vidéo → couche haute reçue de nouveau', grand2.h > petit.h && grand2.h >= 1080, `${grand2.w}×${grand2.h}`);

    const chg = await hote.evaluate(() => window.contrat.lk.hoteChangerCamera(1440));
    noter('Changement caméra — même piste publiée', '2 caméras ; restartTrack ; même trackSid ; 1440p', chg.cameras >= 2 && chg.cible && chg.sid === h.sid && chg.w === 2560 && chg.h === 1440,
      JSON.stringify({ c: chg.cameras, cible: chg.cible, sid: chg.sid === h.sid, w: chg.w, h: chg.h, d: chg.debug }));
    noter('Changement caméra — débits recalculés', '4K → 1440p : couche « f » 8 → 5 Mbit/s', chg.ajuste && (chg.couches || {}).f?.debitMax === 5000000, JSON.stringify(chg.couches));
    const apresChg = await spect.evaluate(() => window.contrat.lk.spectateurTaille(1920, 1080, 4000));
    noter('Changement caméra — spectateur jamais noir', 'image reçue, non noire', apresChg.luma > 10 && apresChg.imagesParSeconde >= 10, JSON.stringify(apresChg));

    await hote.evaluate(() => window.contrat.lk.hoteCamera(false));
    await spect.waitForTimeout(1500);
    await hote.evaluate(() => window.contrat.lk.hoteCamera(true));
    const rallume = await spect.evaluate(() => window.contrat.lk.spectateurTaille(1920, 1080, 4000));
    noter('Caméra coupée puis rallumée', 'muted → unmuted chez le spectateur, image revenue', rallume.evenements.includes('muted') && rallume.evenements.includes('unmuted') && rallume.luma > 10 && rallume.imagesParSeconde >= 10, JSON.stringify(rallume));

    const rec = await spect.evaluate(() => window.contrat.lk.spectateurReconnexion());
    noter('Reconnexion — spectateur', 'coupure complète simulée → reconnecté, image revenue', rec.evenements.includes('reconnected') && rec.etat === 'connected' && rec.luma > 10 && rec.imagesParSeconde >= 10, JSON.stringify(rec));

    // ── 🎨 Looks : l'hôte clique le VRAI sélecteur ; le spectateur REÇOIT (piste publiée → SFU → décodée) ──
    const couleurAvant = await spect.evaluate(() => window.contrat.lk.spectateurTaille(1920, 1080, 2000));
    const [nb, vuNb] = await Promise.all([
      hote.evaluate(() => window.contrat.lk.hoteLook('noir_blanc')),
      spect.evaluate(() => window.contrat.lk.spectateurRafale(2500)),
    ]);
    const recuNb = await spect.evaluate(() => window.contrat.lk.spectateurTaille(1920, 1080, 1500));
    noter('Look Noir & blanc — REÇU par le spectateur', 'piste publiée décodée : R=G=B', recuNb.ecartCouleur <= 1.5 && couleurAvant.ecartCouleur > 4 && recuNb.luma > 10,
      `reçu ${recuNb.ecartCouleur} (avant ${couleurAvant.ecartCouleur}) ${recuNb.w}×${recuNb.h}`);
    noter('Look — changement sans coupure (banc)', 'même trackSid, spectateur jamais noir pendant la bascule', nb.sid === h.sid && nb.processeur && vuNb.noires === 0 && vuNb.ips >= 10,
      JSON.stringify({ sid: nb.sid === h.sid, vu: vuNb }));
    const sansBeaute = await hote.evaluate(() => window.contrat.lk.hoteBeaute('off'));
    const recuSb = await spect.evaluate(() => window.contrat.lk.spectateurTaille(1920, 1080, 1500));
    noter('Look — survit à l\'embellissement coupé', 'beauté OFF : processeur gardé, look gardé, toujours R=G=B reçu',
      sansBeaute.look === 'noir_blanc' && sansBeaute.processeur && recuSb.ecartCouleur <= 1.5 && sansBeaute.sid === h.sid, JSON.stringify({ look: sansBeaute.look, p: sansBeaute.processeur, recu: recuSb.ecartCouleur }));
    const chg4k = await hote.evaluate(() => window.contrat.lk.hoteChangerCamera(2160));
    const recuChg = await spect.evaluate(() => window.contrat.lk.spectateurTaille(1920, 1080, 3000));
    noter('Look — survit au changement de caméra, 4K publiée', 'restartTrack : même trackSid, 3840×2160 publiée, toujours R=G=B reçu',
      chg4k.cible && chg4k.sid === h.sid && chg4k.w === 3840 && chg4k.h === 2160 && chg4k.processeur && recuChg.ecartCouleur <= 1.5 && recuChg.luma > 10,
      JSON.stringify({ cible: chg4k.cible, sid: chg4k.sid === h.sid, w: chg4k.w, h: chg4k.h, recu: recuChg.ecartCouleur }));
    const [to, vuTo] = await Promise.all([
      hote.evaluate(() => window.contrat.lk.hoteLook('teal_orange')),
      spect.evaluate(() => window.contrat.lk.spectateurRafale(2500)),
    ]);
    const recuTo = await spect.evaluate(() => window.contrat.lk.spectateurTaille(1920, 1080, 1500));
    noter('Look Teal & Orange — publié et reçu', 'couleur revenue chez le spectateur, même trackSid, jamais noir', to.sid === h.sid && recuTo.ecartCouleur > recuNb.ecartCouleur + 2 && vuTo.noires === 0,
      JSON.stringify({ recu: recuTo.ecartCouleur, vu: vuTo }));
    const [orig, vuOrig] = await Promise.all([
      hote.evaluate(() => window.contrat.lk.hoteLook('original')),
      spect.evaluate(() => window.contrat.lk.spectateurRafale(2500)),
    ]);
    noter('Look Original + beauté OFF — piste brute', 'processeur retiré, même trackSid, réglage effacé, spectateur jamais noir pendant la bascule',
      !orig.processeur && orig.sid === h.sid && orig.stockage === null && vuOrig.noires === 0 && vuOrig.images > 0, JSON.stringify({ p: orig.processeur, st: orig.stockage, vu: vuOrig }));
    // La bascule vers la piste brute 4K relance l'encodeur (replaceTrack) : la cadence reçue peut fléchir
    // une seconde ; elle doit être revenue une fois l'encodeur stabilisé.
    const recuOrig = await spect.evaluate(() => window.contrat.lk.spectateurTaille(1920, 1080, 3000));
    noter('Look Original — image d\'origine revenue', 'couleur, ≥ 10 i/s reçues après stabilisation', recuOrig.ecartCouleur > 4 && recuOrig.luma > 10 && recuOrig.imagesParSeconde >= 10,
      JSON.stringify(recuOrig));
  } finally {
    await spect.evaluate(() => window.contrat.lk.quitter()).catch(() => {});
    await hote.evaluate(() => window.contrat.lk.quitter()).catch(() => {});
    await spect.close(); await hote.close();
  }
}
await harnaisNavigateur();

// ── 4. Tests serveur du Live ──────────────────────────────────────────────────────────────────────
const TESTS_SERVEUR = ['test_preferences_live.py', 'test_preferences_live_parcours.py', 'test_preferences_live_securite.py', 'test_live_promo.py', 'test_live_promo_persistance.py',
  'test_promo_acces.py', 'test_souffleur_hote.py', 'test_live_invite.py', 'test_fin_live.py', 'test_live_acces_et_vente.py', 'test_outils_coach.py'];
if (!args.has('--sans-serveur')) {
  const r = lancer('python3', ['-m', 'pytest', '-q', '-p', 'no:warnings', '-p', 'no:cacheprovider', ...TESTS_SERVEUR.map((f) => `backend/tests/${f}`)], RACINE);
  const m = r.sortie.match(/(\d+) passed/); const f = r.sortie.match(/(\d+) failed/);
  noter('Serveur Live (préférences, promo, invité, fin)', `${m ? m[1] : 0} réussis / ${f ? f[1] : 0} échoués`, r.code === 0,
    [...r.sortie.matchAll(/^FAILED (.+)$/gm)].map((x) => x[1]).slice(0, 5).join(' | ') || r.sortie.slice(-300));
}

// ── 5. Build de production ────────────────────────────────────────────────────────────────────────
if (!args.has('--sans-build')) {
  const sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'contrat-build-'));
  const r = lancer('npx', ['vite', 'build', '--outDir', sortie, '--emptyOutDir'], FRONT);
  noter('Build de production', 'vite build', r.code === 0, r.code === 0 ? '' : r.sortie.slice(-300));
  fs.rmSync(sortie, { recursive: true, force: true });
}

// ── 6. Fumée production (LECTURE SEULE : GET de pages publiques, après un déploiement) ───────────
if (args.has('--prod')) {
  const pw = trouverPlaywright();
  const nav = await pw.chromium.launch();
  for (const [site, chemin] of [['https://boosttribe.pro', '/'], ['https://afroboost.com', '/live/'], ['https://afroboost.com', '/live/session/ZZZZZZZZ-ZZZZZZ']]) {
    const p = await nav.newPage(); const err = []; let cinqCents = 0;
    p.on('pageerror', (e) => err.push(e.message)); p.on('response', (r) => { if (r.status() >= 500) cinqCents++; });
    await p.goto(site + chemin, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(5000);
    const texte = await p.evaluate(() => (document.body.innerText || '').trim().length);
    noter(`Prod ${site.replace('https://', '')}${chemin}`, 'pas d\'écran noir, pas de 500, pas d\'erreur JS', texte > 40 && cinqCents === 0 && err.length === 0,
      `texte=${texte} 5xx=${cinqCents} js=${err.length}`);
    await p.close();
  }
  await nav.close();
}

// ── Tableau ───────────────────────────────────────────────────────────────────────────────────────
const largeur = Math.max(...resultats.map((r) => r.fonction.length));
console.log('\n🛡️  CONTRAT LIVE\n');
for (const r of resultats) console.log(`${r.ok ? 'OK    ' : 'ÉCHEC '} ${r.fonction.padEnd(largeur)}  ${r.preuve}${r.detail && (!r.ok || process.env.CONTRAT_DETAIL) ? `  → ${r.detail}` : ''}`);
if (mesuresLooks.length) {
  console.log('\n🎨 Looks vidéo — mesures (vrai GPU, caméra factice ; ms = temps CPU du dessin par image)\n');
  console.log(`${'config'.padEnd(18)} ${'look'.padEnd(15)} ${'entrée'.padEnd(10)} ${'sortie'.padEnd(10)} ${'i/s sortie'.padStart(10)} ${'i/s trait.'.padStart(10)} ${'ms/image'.padStart(9)}`);
  for (const r of mesuresLooks) {
    const cfg = `${r.hauteur === 2160 ? '4K' : `${r.hauteur}p`} beauté ${r.beaute === 'off' ? 'OFF' : 'ON'}`;
    console.log(`${cfg.padEnd(18)} ${'(source brute)'.padEnd(15)} ${`${r.brut.w}×${r.brut.h}`.padEnd(10)} ${'—'.padEnd(10)} ${String(r.brut.ips).padStart(10)}`);
    for (const x of r.lignes) console.log(`${cfg.padEnd(18)} ${x.look.padEnd(15)} ${x.entree.padEnd(10)} ${x.sortie.padEnd(10)} ${String(x.ipsSortie).padStart(10)} ${String(x.ipsTraitement).padStart(10)} ${String(x.msImage).padStart(9)}`);
    if (r.paliers.length || r.coupure) console.log(`  ⚠ repli : paliers=${r.paliers.join(',')} coupure=${r.coupure}`);
  }
  console.log('\n🎨 Coût GPU synchronisé par image (ms ; téléversement + rendu, source canvas = pessimiste)\n');
  for (const { hauteur, c } of chronos) for (const bt of ['off', 'moyen']) {
    console.log(`${`${hauteur === 2160 ? '4K' : `${hauteur}p`} beauté ${bt === 'off' ? 'OFF' : 'ON'}`.padEnd(18)} ${c.filter((x) => x.beaute === bt).map((x) => `${x.look}=${x.ms}`).join('  ')}`);
  }
  if (process.env.CONTRAT_MESURES) fs.writeFileSync(process.env.CONTRAT_MESURES, JSON.stringify({ mesuresLooks, chronos }, null, 1));
}
const ko = resultats.filter((r) => !r.ok).length;
console.log(`\n${ko === 0 ? '✅ CONTRAT VERT' : `❌ CONTRAT ROUGE — ${ko} échec(s) : NI push NI déploiement`} (${resultats.length} vérifications)\n`);
process.exit(ko === 0 ? 0 : 1);
