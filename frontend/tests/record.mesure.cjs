/**
 * MESURE RÉELLE (Chromium) — Phase 4 enregistrement local, sans UI ni serveur.
 *  A. OPFS 30 s : programStream factice (canvas + oscillateur) → MediaRecorder timeslice 1 s → écriture
 *     progressive OPFS → fichier lisible (durée ±1 s, résolution) — le même chemin d'écriture que le hook.
 *  B. RAM 30 min simulée : 1 800 morceaux de 1 s injectés → heap JS avec écriture OPFS vs accumulation mémoire.
 *  C. A/V sync : flash blanc + bip toutes les 5 s → décodage du fichier → écart flash/bip au début et à la fin.
 * Lancer : PW_PATH=~/.claude/skills/gstack/node_modules/playwright node tests/record.mesure.cjs
 * Aucun réseau. Aucun upload. Chromium headless : pas de File System Access (le picker exige un geste) → OPFS.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');
const webm = fs.readFileSync(path.join(__dirname, '.build', 'webmDuree.mjs'), 'utf8').replace(/^export /gm, '');
const DUREE_S = Number(process.env.REC_DUREE_S || 30);

const PAGE = `<!doctype html><html><body><canvas id=c width=1280 height=720></canvas><video id=v playsinline muted></video><script>${webm}
window.__webm = { preparerEnteteWebm, encoderDuree, dureeEnUnites };</script></body></html>`;

(async () => {
  const b = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  // OPFS exige une origine sécurisée non opaque : la page est servie sur https://mesure.local (interceptée, aucun réseau).
  await p.route('https://mesure.local/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
  await p.goto('https://mesure.local/');
  if (process.env.REC_WEBM) await p.evaluate(() => { window.__forceWebm = true; });

  // ── A + C : enregistrement OPFS réel ──────────────────────────────────────
  const resA = await p.evaluate(async (DUREE_S) => {
    const c = document.getElementById('c'); const g = c.getContext('2d');
    const ac = new AudioContext(); const dest = ac.createMediaStreamDestination();
    const gain = ac.createGain(); gain.gain.value = 0; gain.connect(dest);
    const osc = ac.createOscillator(); osc.frequency.value = 1000; osc.connect(gain); osc.start();
    // scène : fond sombre + carré mobile ; flash blanc + bip 100 ms toutes les 5 s
    let t0 = performance.now(); let flashes = [];
    function dessiner() {
      const t = (performance.now() - t0) / 1000;
      const flash = (t % 5) < 0.1;
      g.fillStyle = flash ? '#fff' : '#101018'; g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#d91cd2'; g.fillRect(100 + (t * 60) % 900, 300, 120, 120);
      gain.gain.value = flash ? 0.8 : 0;
      requestAnimationFrame(dessiner);
    }
    dessiner();
    const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = (window.__forceWebm ? ['video/webm;codecs=vp9,opus', 'video/webm'] : ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm']).find((m) => MediaRecorder.isTypeSupported(m));
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('afroboost-enregistrements', { create: true });
    const nom = 'mesure.' + (mime.startsWith('video/mp4') ? 'mp4' : 'webm');
    const h = await dir.getFileHandle(nom, { create: true });
    const w = await h.createWritable({ keepExistingData: false });
    let ecrit = 0, morceaux = 0, premier = true, offset = null, tcs = 1e6;
    let file = Promise.resolve();
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_500_000, audioBitsPerSecond: 128_000 });
    rec.ondataavailable = (ev) => { if (!ev.data.size) return; file = file.then(async () => {
      let data = ev.data;
      if (premier) { premier = false; if (!mime.startsWith('video/mp4')) { const prep = window.__webm.preparerEnteteWebm(new Uint8Array(await ev.data.arrayBuffer())); offset = prep.offsetDuree; tcs = prep.timecodeScale; data = new Blob([prep.octets.buffer.slice(prep.octets.byteOffset, prep.octets.byteOffset + prep.octets.byteLength)], { type: ev.data.type }); } }
      await w.write(data); ecrit += data.size; morceaux++;
    }); };
    const debut = performance.now(); rec.start(1000);
    await new Promise((r) => setTimeout(r, DUREE_S * 1000));
    const dureeMs = performance.now() - debut;
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    await file;
    if (offset != null) await w.write({ type: 'write', position: offset, data: window.__webm.encoderDuree(window.__webm.dureeEnUnites(dureeMs, tcs)) });
    await w.close();
    const f = await h.getFile();
    // lisibilité + durée
    const v = document.getElementById('v'); const url = URL.createObjectURL(f); v.src = url;
    const meta = await new Promise((res) => { v.onloadedmetadata = () => res({ duree: v.duration, w: v.videoWidth, h: v.videoHeight }); v.onerror = () => res({ erreur: v.error && v.error.message }); });
    // A/V : détecter flashs (luminance) et bips (énergie audio) sur le fichier décodé
    let sync = null;
    try {
      const buf = await f.arrayBuffer();
      const audio = await new AudioContext().decodeAudioData(buf.slice(0));
      const ch = audio.getChannelData(0); const sr = audio.sampleRate;
      const bips = []; let dans = false;
      for (let i = 0; i < ch.length; i += 128) { let e = 0; for (let j = 0; j < 128 && i + j < ch.length; j++) e += Math.abs(ch[i + j]); e /= 128; if (e > 0.1 && !dans) { dans = true; bips.push(i / sr); } if (e < 0.02) dans = false; }
      const flashesVus = [];
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 36; const cg = cv.getContext('2d', { willReadFrequently: true });
      const pas = 1 / 30; let dansF = false;
      for (let t = 0; t < meta.duree; t += pas) {
        v.currentTime = t; await new Promise((r) => { v.onseeked = r; });
        cg.drawImage(v, 0, 0, 64, 36); const d = cg.getImageData(0, 0, 64, 36).data; let l = 0; for (let k = 0; k < d.length; k += 4) l += d[k]; l /= (d.length / 4);
        if (l > 200 && !dansF) { dansF = true; flashesVus.push(t); } if (l < 100) dansF = false;
      }
      const paires = flashesVus.map((tf) => { const tb = bips.reduce((m, x) => Math.abs(x - tf) < Math.abs(m - tf) ? x : m, Infinity); return { flash: +tf.toFixed(3), bip: +tb.toFixed(3), ecartMs: Math.round((tb - tf) * 1000) }; }).filter((x) => isFinite(x.bip));
      sync = { flashs: flashesVus.length, bips: bips.length, debut: paires[0], fin: paires[paires.length - 1], maxAbsEcartMs: Math.max(...paires.map((x) => Math.abs(x.ecartMs))) };
    } catch (e) { sync = { erreur: String(e && e.message) }; }
    await dir.removeEntry(nom);
    return { mime, nom, morceaux, ecrit, dureeMs: Math.round(dureeMs), meta, offsetDuree: offset, sync };
  }, DUREE_S);
  console.log('A/C OPFS + lisibilité + A/V :', JSON.stringify(resA));

  // ── B : RAM 30 min simulée (1 800 morceaux d'1 s de ~560 Ko) ─────────────
  const resB = await p.evaluate(async () => {
    const taille = 560 * 1024; const N = 1800; const chunk = new Uint8Array(taille); for (let i = 0; i < taille; i += 4096) chunk[i] = i & 255;
    const heap = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
    const gc = async () => { await new Promise((r) => setTimeout(r, 50)); };
    // OPFS progressif
    const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('afroboost-enregistrements', { create: true });
    const h = await dir.getFileHandle('ram.bin', { create: true }); const w = await h.createWritable();
    await gc(); const h0 = heap(); let hMax = h0;
    for (let i = 0; i < N; i++) { await w.write(new Blob([chunk])); if (i % 100 === 0) { await gc(); hMax = Math.max(hMax, heap()); } }
    await w.close(); const f = await h.getFile(); await dir.removeEntry('ram.bin');
    await gc(); const hOpfs = heap();
    // mémoire (accumulation)
    const morceaux = []; await gc(); const m0 = heap();
    for (let i = 0; i < N; i++) { morceaux.push(new Blob([chunk])); }
    const blob = new Blob(morceaux); await gc(); const mFin = heap();
    return { N, tailleTotaleMo: Math.round(f.size / 1048576), opfs: { heapDebutMo: +(h0 / 1048576).toFixed(1), heapMaxMo: +(hMax / 1048576).toFixed(1), heapFinMo: +(hOpfs / 1048576).toFixed(1) }, memoire: { heapDebutMo: +(m0 / 1048576).toFixed(1), heapFinMo: +(mFin / 1048576).toFixed(1), blobMo: Math.round(blob.size / 1048576), note: 'les Blob vivent hors heap JS mais restent en RAM du processus' } };
  });
  console.log('B RAM 30 min simulée :', JSON.stringify(resB));
  await b.close();
})().catch((e) => { console.error('MESURE ÉCHOUÉE', e); process.exit(1); });
