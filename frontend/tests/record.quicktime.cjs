/**
 * PREUVE RÉELLE — enregistrement local du Programme → fichier MP4 lisible par QuickTime.
 *
 * Vrai Google Chrome (channel 'chrome', FENÊTRÉ : c'est LUI qui a le muxeur MP4 de l'hôte, pas le
 * headless shell), vrai pipeline (useStudio → useProgramStream → useProgramRecorder + RecordPanel,
 * via tests/.harnais/qa-rec.html), sources A/V synthétiques. Aucun réseau, aucun upload.
 *
 * Pré-requis : `cd frontend && yarn dev --port 5181`   puis
 *   PW_PATH=~/.claude/skills/gstack/node_modules/playwright node tests/record.quicktime.cjs <scénario> [durée s]
 * Scénarios :
 *   terrain       rien à l'antenne (câblage SessionPage corrigé) → fichier non vide attendu ;
 *   terrain-hook  rien à l'antenne + ANCIEN câblage → le hook doit passer en « erreur », jamais un 0 octet « prêt » ;
 *   opfs          scène à l'antenne, OPFS + « Enregistrer sur mon appareil » (téléchargement capturé) ;
 *   fsa           File System Access : le sélecteur (geste requis, non automatisable) est remplacé par un
 *                 handle OPFS injecté — même API createWritable()/close() ; le fichier est ramené sur le Bureau ;
 *   unmount       démontage du hook pendant l'enregistrement → le fichier doit être FERMÉ (non vide).
 *   resolution    PREUVE résolution affichée = résolution encodée (terrain 20/09 : panneau « 1920×1080 »,
 *                 ffprobe 1280×720). Query libre via QS (ex. QS='?antenne=0&resolution=session&source=720'
 *                 = câblage EXACT de SessionPage), qualité via QUALITE=720p|1080p. Le script imprime
 *                 `getSettings()` de la piste encodée à la finalisation, le texte du panneau
 *                 (`data-testid=record-resolution`) et le fichier à passer à ffprobe.
 * Serveur : URL_BASE (défaut http://localhost:5181 ; les ports 5181-5183 peuvent être réservés → 5184).
 * Sortie : ~/Desktop/<NOM_SORTIE | qa-<scénario>.mp4>. Puis QuickTime :
 *   osascript -e 'tell application "QuickTime Player" to open POSIX file "…"' -e 'tell application "QuickTime Player" to tell document 1 to return {duration, natural dimensions, data size}'
 *
 * Fait terrain (17/09) : Afroboost-Live-2026-09-17-1200.mp4 = 0 octet (ffprobe « moov atom not found »).
 * Reproduit ici AVANT correctif (scénario terrain, ancien code) : MediaRecorder `inactive` à ~1,1 s (pistes
 * du Programme finies par l'effet « rien à l'antenne → programme.arreter() »), 1 dataavailable de 0 octet,
 * compteur qui tourne, « Arrêter » → fichier de 0 octet annoncé « prêt ».
 */
const path = require('path'); const fs = require('fs'); const os = require('os');
const { chromium } = require(process.env.PW_PATH || 'playwright');
const scenario = process.argv[2] || 'opfs'; const DUREE = Number(process.argv[3] || 25);
const URL_BASE = (process.env.URL_BASE || 'http://localhost:5181') + '/tests/.harnais/qa-rec.html';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text()); });
  const q = scenario === 'terrain' ? '?antenne=0' : scenario === 'terrain-hook' ? '?antenne=0&fixAntenne=0' : scenario === 'fsa' ? '?fsa=1' : scenario === 'resolution' ? (process.env.QS || '') : '';
  if (scenario === 'fsa') {
    // Le sélecteur FSA exige un geste : on le remplace par un handle OPFS injecté (même API createWritable).
    await p.addInitScript(() => {
      window.showSaveFilePicker = async (o) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('qa-fsa', { create: true });
        window.__fsaNom = o.suggestedName; return dir.getFileHandle(o.suggestedName, { create: true });
      };
    });
  }
  await p.addInitScript(() => {
    const MR = window.MediaRecorder; window.__recs = [];
    const W = function (stream, opts) { const r = new MR(stream, opts); window.__recs.push(r); try { const s = stream.getVideoTracks()[0].getSettings(); r.__settingsAuStart = { width: s.width, height: s.height }; } catch { r.__settingsAuStart = null; } r.addEventListener('stop', () => { r.__stoppedAt = performance.now(); }); r.addEventListener('dataavailable', (e) => { r.__chunks = (r.__chunks || 0) + 1; r.__bytes = (r.__bytes || 0) + e.data.size; }); return r; };
    W.isTypeSupported = MR.isTypeSupported.bind(MR); W.prototype = MR.prototype; window.MediaRecorder = W;
  });
  await p.goto(URL_BASE + q);
  await p.waitForFunction(() => window.__h && window.__h.recorder);
  await p.waitForTimeout(800);
  console.log('capacite', JSON.stringify(await p.evaluate(() => window.__h.recorder.capacite)));
  console.log('userAgent', await p.evaluate(() => navigator.userAgent));
  if (scenario === 'resolution' && process.env.QUALITE) {
    await p.click(`[data-testid=record-qualite-${process.env.QUALITE}]`);
    console.log('qualité choisie', await p.evaluate(() => window.__h.recorder.qualite), '| compositeur au départ', JSON.stringify(await p.evaluate(() => window.__h.programme.stats.resolution)), '| programme actif', await p.evaluate(() => window.__h.programme.actif));
  }
  await p.click('[data-testid=record-start]');
  await p.waitForFunction(() => ['enregistrement', 'erreur'].includes(window.__h.recorder.etat), null, { timeout: 10000 });
  await p.waitForTimeout(1500);
  if (scenario === 'terrain-hook') {
    await p.waitForFunction(() => window.__h.recorder.etat !== 'enregistrement', null, { timeout: 10000 });
    console.log('hook seul →', JSON.stringify(await p.evaluate(() => ({ etat: window.__h.recorder.etat, avis: window.__h.recorder.avis, resultat: window.__h.recorder.resultat }))));
    console.log('MediaRecorder', JSON.stringify(await p.evaluate(() => { const r = window.__recs[0]; return { state: r.state, chunks: r.__chunks || 0, bytes: r.__bytes || 0 }; })));
    console.log('panneau', await p.evaluate(() => (document.querySelector('[data-testid=record-erreur]') || {}).textContent || null));
    const opfs = await p.evaluate(async () => { const root = await navigator.storage.getDirectory(); try { const d = await root.getDirectoryHandle('afroboost-enregistrements'); const out = []; for await (const [n, h] of d.entries()) { const f = await h.getFile(); out.push({ n, size: f.size }); } return out; } catch { return []; } });
    console.log('OPFS restant', JSON.stringify(opfs));
    await b.close(); return;
  }
  console.log('recorder réel', JSON.stringify(await p.evaluate(() => { const r = window.__recs[0]; return r ? { mimeType: r.mimeType, state: r.state, pistes: r.stream.getTracks().map((t) => t.kind + ':' + t.readyState) } : null; })));
  console.log('programme actif', await p.evaluate(() => window.__h.programme.actif));
  await p.waitForTimeout(DUREE * 1000);
  const enCours = await p.evaluate(() => ({ duree: window.__h.recorder.dureeSec, taille: window.__h.recorder.tailleOctets, etat: window.__h.recorder.etat, avis: window.__h.recorder.avis }));
  console.log('en cours', JSON.stringify(enCours));
  if (scenario === 'unmount') {
    await p.evaluate(() => window.__demonter());
    await p.waitForTimeout(2000);
    const opfs = await p.evaluate(async () => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('afroboost-enregistrements'); const out = []; for await (const [n, h] of d.entries()) { const f = await h.getFile(); out.push({ n, size: f.size }); } return out; });
    console.log('OPFS après unmount', JSON.stringify(opfs));
    await b.close(); return;
  }
  await p.click('[data-testid=record-stop]');
  await p.waitForFunction(() => ['pret', 'erreur'].includes(window.__h.recorder.etat), null, { timeout: 30000 });
  const res = await p.evaluate(() => { const r = window.__h.recorder; return { etat: r.etat, avis: r.avis, resultat: r.resultat && { nom: r.resultat.nom, dureeSec: r.resultat.dureeSec, taille: r.resultat.tailleOctets, dejaEcrit: r.resultat.dejaEcrit, format: r.resultat.format, resolution: r.resultat.resolution, resolutionSource: r.resultat.resolutionSource } }; });
  console.log('résultat', JSON.stringify(res));
  if (scenario === 'resolution') {
    // Source de vérité imposée : la piste RÉELLEMENT encodée par le MediaRecorder, lue à la finalisation.
    console.log('track.getSettings() à new MediaRecorder (start)', JSON.stringify(await p.evaluate(() => window.__recs[0].__settingsAuStart)));
    console.log('track.getSettings() à la finalisation', JSON.stringify(await p.evaluate(() => { const t = window.__recs[0].stream.getVideoTracks()[0]; const s = t.getSettings(); return { width: s.width, height: s.height, frameRate: s.frameRate, readyState: t.readyState }; })));
    console.log('compositeur (stats.resolution) à la finalisation', JSON.stringify(await p.evaluate(() => window.__h.programme.stats.resolution)));
    console.log('panneau [record-resolution]', JSON.stringify(await p.evaluate(() => (document.querySelector('[data-testid=record-resolution]') || {}).textContent || null)));
    if (process.env.CAPTURE) await p.locator('[data-testid=record-panel]').screenshot({ path: process.env.CAPTURE });
  }
  console.log('MediaRecorder final', JSON.stringify(await p.evaluate(() => { const r = window.__recs[0]; return { state: r.state, chunks: r.__chunks || 0, bytes: r.__bytes || 0, stoppedAt: r.__stoppedAt }; })));
  const dest = path.join(os.homedir(), 'Desktop', process.env.NOM_SORTIE || `qa-${scenario}.mp4`);
  if (scenario === 'fsa') {
    const b64 = await p.evaluate(async () => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('qa-fsa'); const h = await d.getFileHandle(window.__fsaNom); const f = await h.getFile(); const buf = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return { size: f.size, b64: btoa(s) }; });
    fs.writeFileSync(dest, Buffer.from(b64.b64, 'base64')); console.log('fichier FSA (handle OPFS injecté) taille', b64.size, '→', dest);
  } else if (res.etat === 'pret') {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('[data-testid=record-save]')]);
    await dl.saveAs(dest); console.log('téléchargé', dl.suggestedFilename(), '→', dest, fs.statSync(dest).size, 'octets');
  }
  await b.close();
})().catch((e) => { console.error('QA ÉCHOUÉE', e); process.exit(1); });
