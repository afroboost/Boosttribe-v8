/**
 * 🎙️ MESURE RÉELLE — « Échanger en visio » de bout en bout, avec le VRAI fournisseur (payant, ~0,01 $).
 *
 *   OPENAI_API_KEY=sk-… node tests/voix-reelle/mesurer.mjs        (ou clé dans ~/.config/boosttribe/openai.env)
 *
 * 1. Les deux phrases de Bassi sont dites par une voix de synthèse française (macOS `say`).
 * 2. Le VRAI serveur (routes réelles) fabrique le secret éphémère.
 * 3. Dans Chromium, la voix passe par une VRAIE piste WebRTC distante (comme PeerJS), on en prend une
 *    COPIE et `connecterOpenAI` (le code livré) l'envoie au fournisseur : transcription + latence mesurées.
 * 4. Chaque phrase transcrite passe par le VRAI mode « voix » du serveur : réplique + contrôle de style.
 * Rien n'est enregistré : les fichiers audio de synthèse sont effacés à la fin.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.join(ICI, '..', '..');
const RACINE = path.join(FRONT, '..');
const PHRASES = ['Est-ce que je peux participer si je suis débutant ?', 'J’ai peur de ne pas suivre.'];

function cle() {
  if ((process.env.OPENAI_API_KEY || '').startsWith('sk-')) return process.env.OPENAI_API_KEY;
  const f = path.join(os.homedir(), '.config/boosttribe/openai.env');
  if (fs.existsSync(f)) { const m = fs.readFileSync(f, 'utf8').match(/OPENAI_API_KEY=(sk-\S+)/); if (m) return m[1]; }
  return null;
}
const CLE = cle();
if (!CLE) { console.log('CLÉ ABSENTE — mesure réelle impossible (aucun appel fait).'); process.exit(2); }
const envPy = { ...process.env, OPENAI_API_KEY: CLE };
const aide = (...a) => JSON.parse(execFileSync('python3', [path.join(RACINE, 'backend/tests/voix_reelle_aide.py'), ...a], { env: envPy, cwd: RACINE }).toString().trim().split('\n').pop());

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voix-'));
try {
  const wavs = PHRASES.map((p, i) => {
    const aiff = path.join(tmp, `p${i}.aiff`), wav = path.join(tmp, `p${i}.wav`);
    execFileSync('say', ['-v', 'Thomas', '-o', aiff, p]);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@24000', aiff, wav]);
    return fs.readFileSync(wav).toString('base64');
  });
  const lib = path.join(tmp, 'tv.js');
  execFileSync(path.join(FRONT, 'node_modules/.bin/esbuild'), [path.join(FRONT, 'src/lib/transcriptionVisio.ts'),
    '--bundle', '--format=iife', '--global-name=TV', `--outfile=${lib}`, '--log-level=error']);

  const j = aide('jeton');
  if (!j.ok) { console.log('JETON REFUSÉ :', j.raison); process.exit(1); }

  const pw = [process.env.PLAYWRIGHT_DIR, FRONT, path.join(os.homedir(), '.claude/skills/gstack')].filter(Boolean)
    .map((l) => { try { return createRequire(path.join(l, 'package.json'))('playwright'); } catch { return null; } }).find(Boolean);
  const nav = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await nav.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: fs.readFileSync(lib, 'utf8') });
  const res = await page.evaluate(async ({ wavs, secret }) => {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const dest = ctx.createMediaStreamDestination();
    const [a, b] = [new RTCPeerConnection(), new RTCPeerConnection()];          // piste DISTANTE, comme PeerJS
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
    const recu = new Promise((r) => { b.ontrack = (e) => r(e.track); });
    a.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
    await a.setLocalDescription(await a.createOffer()); await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer()); await a.setRemoteDescription(b.localDescription);
    const originale = await recu;
    // Comme usePeerAudio chez l'hôte : la voix reçue est JOUÉE dans un <audio> (Chrome n'alimente une
    // piste WebRTC distante que si elle est consommée).
    const el = document.createElement('audio'); el.srcObject = new MediaStream([originale]); el.muted = true;
    document.body.appendChild(el); await el.play().catch(() => {});
    const copie = originale.clone();
    const chrono = TV.creerChrono();
    const segments = [], latences = [], evts = [], details = [];
    const cx = await TV.connecterOpenAI(copie, secret, (ev) => {
      evts.push(ev.type);
      if (ev.type === 'session.created' || ev.type === 'session.updated' || ev.type === 'error')
        details.push(JSON.stringify(ev.type === 'error' ? ev.error : (ev.session && ev.session.audio) || ev.session).slice(0, 700));
      const l = chrono.evenement(ev, performance.now());
      const s = TV.segmentDepuisEvenement(ev);
      if (s) { segments.push(s.texte); if (l !== null) latences.push(Math.round(l)); }
    }, () => {});
    await new Promise((r) => setTimeout(r, 1500));
    for (const w of wavs) {
      const buf = await ctx.decodeAudioData(Uint8Array.from(atob(w), (c) => c.charCodeAt(0)).buffer);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest); src.start();
      await new Promise((r) => setTimeout(r, buf.duration * 1000 + 2500));
    }
    for (let i = 0; i < 40 && segments.length < wavs.length; i++) await new Promise((r) => setTimeout(r, 250));
    cx.fermer(); copie.stop();
    const stats = []; (await cx.stats?.())?.forEach?.((r) => stats.push(r));
    return { ctxEtat: ctx.state, details, segments, latences, originaleVivante: originale.readyState === 'live', copie: copie.readyState,
      types: [...new Set(evts)] };
  }, { wavs, secret: j.client_secret });
  await nav.close();

  console.log('\n🎙️  MESURE RÉELLE — « Échanger en visio »\n');
  console.log('Transcriptions :', JSON.stringify(res.segments, null, 0));
  console.log('Latence fin de parole → texte (ms) :', res.latences.join(', ') || '—');
  console.log('Piste originale vivante après :', res.originaleVivante, '| copie :', res.copie);
  console.log('Événements reçus :', res.types.join(', '));
  console.log('AudioContext :', res.ctxEtat);
  for (const d of res.details) console.log('Détail :', d);
  for (const s of res.segments) {
    const t0 = Date.now();
    const d = aide('souffle', s);
    console.log(`\n« ${s} »\n  → ${d.ok ? `« ${d.suggestions[0]} »` : `rien (${d.raison})`}  [IA ${Date.now() - t0} ms, style ${d.style === null ? 'naturel' : d.style}]`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });                         // aucun fichier audio conservé
}
