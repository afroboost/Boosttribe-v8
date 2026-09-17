/**
 * ✨ Embellir le visage — MESURE navigateur (Chromium headless, aucune webcam réelle).
 * Source synthétique : fond couleur peau + bruit fin (pores/ridules) + contours nets (yeux/bouche),
 * animée. On compare BRUT vs TRAITÉ (moyen) sur 10 s :
 *   - fps traité ≥ 20 (garde) ; ms/image ;
 *   - luminance moyenne : écart < 8 % (pas de délavage) ;
 *   - bruit sur la peau : écart-type réduit (le lissage agit) ;
 *   - netteté des contours (variance du laplacien sur la zone des yeux) conservée ≥ 70 %.
 * Lancer : node tests/beaute.mesure.cjs   (après `npx esbuild … tests/.build/beaute.bundle.js`)
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');
const bundle = fs.readFileSync(path.join(__dirname, '.build', 'beaute.bundle.js'), 'utf8');

const PAGE = `<!doctype html><html><body style="background:#000"><canvas id=src width=640 height=480></canvas>
<canvas id=cmp width=640 height=480></canvas><script>${bundle}</script></body></html>`;

(async () => {
  const b = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.setContent(PAGE);
  const res = await p.evaluate(async () => {
    const src = document.getElementById('src'); const g = src.getContext('2d');
    const W = src.width, H = src.height;
    // bruit fixe (pores) pour comparer les mêmes pixels
    const bruit = new Float32Array(W * H); for (let i = 0; i < bruit.length; i++) bruit[i] = (Math.random() - 0.5) * 28;
    let t = 0;
    const dessinerSource = () => {
      const img = g.createImageData(W, H); const d = img.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x); const n = bruit[i];
        // peau (carnation moyenne) + léger dégradé animé
        let r = 205 + n + Math.sin((x + t) / 90) * 6, gg = 160 + n * 0.9, bb = 135 + n * 0.8;
        // « yeux » : deux disques sombres nets ; « bouche » : trait sombre
        const dy1 = Math.hypot(x - 220, y - 200), dy2 = Math.hypot(x - 420, y - 200);
        if (dy1 < 18 || dy2 < 18) { r = 30; gg = 25; bb = 25; }
        if (Math.abs(y - 340) < 4 && x > 250 && x < 390) { r = 120; gg = 40; bb = 50; }
        d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = bb; d[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0); t += 2;
    };
    dessinerSource();
    const anim = setInterval(dessinerSource, 33);
    const track = src.captureStream(30).getVideoTracks()[0];
    const mesures = [];
    const proc = new Beaute.BeauteProcessor('moyen', { onMesure: (fps, ms) => mesures.push({ fps, ms }) });
    await proc.init({ kind: 'video', track });
    await new Promise((r) => setTimeout(r, 10000));
    // image traitée : on lit le canvas interne (même taille que la source ici : 640x480 ≤ 720)
    const canvasTraite = proc.rendu ? proc.rendu.canvas : null;
    const cmp = document.getElementById('cmp'); const cg = cmp.getContext('2d');
    cg.drawImage(canvasTraite, 0, 0, W, H);
    const traite = cg.getImageData(0, 0, W, H).data;
    clearInterval(anim);
    const brut = g.getImageData(0, 0, W, H).data;
    const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // zone peau (haut gauche, loin des yeux/bouche) ; zone contour = autour de l'œil gauche
    const stats = (d, x0, y0, x1, y1) => {
      let s = 0, s2 = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const l = lum(d, (y * W + x) * 4); s += l; s2 += l * l; n++; }
      const m = s / n; return { m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)) };
    };
    const laplace = (d, x0, y0, x1, y1) => {
      let s = 0, s2 = 0, n = 0;
      for (let y = y0 + 1; y < y1 - 1; y++) for (let x = x0 + 1; x < x1 - 1; x++) {
        const L = (xx, yy) => lum(d, (yy * W + xx) * 4);
        const v = 4 * L(x, y) - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1);
        s += v; s2 += v * v; n++;
      }
      const m = s / n; return s2 / n - m * m;
    };
    const peauB = stats(brut, 40, 40, 160, 140), peauT = stats(traite, 40, 40, 160, 140);
    const globB = stats(brut, 0, 0, W, H), globT = stats(traite, 0, 0, W, H);
    const lapB = laplace(brut, 190, 170, 250, 230), lapT = laplace(traite, 190, 170, 250, 230);
    await proc.destroy();
    return { mesures, peauB, peauT, globB, globT, lapB, lapT, taille: canvasTraite ? [canvasTraite.width, canvasTraite.height] : null };
  });
  await b.close();
  const fps = res.mesures.map((m) => m.fps).filter((f) => f > 0);
  const fpsMoy = fps.reduce((a, b) => a + b, 0) / Math.max(1, fps.length);
  const msMoy = res.mesures.reduce((a, m) => a + m.ms, 0) / Math.max(1, res.mesures.length);
  const dLum = Math.abs(res.globT.m - res.globB.m) / res.globB.m;
  const bruitRatio = res.peauT.sd / res.peauB.sd;
  const netteteRatio = res.lapT / res.lapB;
  console.log(`fps traité (moyen) = ${fpsMoy.toFixed(1)} | ms/image = ${msMoy.toFixed(2)} | canvas ${res.taille}`);
  console.log(`luminance moyenne brut ${res.globB.m.toFixed(1)} → traité ${res.globT.m.toFixed(1)} (écart ${(dLum * 100).toFixed(1)} %)`);
  console.log(`bruit peau (écart-type) brut ${res.peauB.sd.toFixed(2)} → traité ${res.peauT.sd.toFixed(2)} (ratio ${bruitRatio.toFixed(2)})`);
  console.log(`netteté contours (laplacien) brut ${res.lapB.toFixed(0)} → traité ${res.lapT.toFixed(0)} (ratio ${netteteRatio.toFixed(2)})`);
  const ok = fpsMoy >= 20 && dLum < 0.08 && bruitRatio < 0.9 && netteteRatio >= 0.7;
  console.log(ok ? 'VERDICT : OK — naturel (bruit réduit, contours conservés, pas de délavage)' : 'VERDICT : KO');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ROUGE:', e.message); process.exit(1); });
