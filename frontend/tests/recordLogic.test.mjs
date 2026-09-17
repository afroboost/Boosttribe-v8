// Phase 4 — logique pure de l'enregistrement local (esbuild → tests/.build/*.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detecterCapacite, choisirMime, choisirStrategie, nomFichier, bitratePour, estimerEspace,
  doitReplier720, minutesMaxMemoire, qualiteParDefaut, formaterDuree, formaterTaille, MIMES_PREFERES,
} from './.build/recordLogic.mjs';
import { preparerEnteteWebm, encoderDuree, dureeEnUnites } from './.build/webmDuree.mjs';

const supporte = (...ok) => (m) => ok.includes(m);
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/128.0';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S928B) Chrome/128.0 Mobile';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/605.1';

test('Chrome desktop récent : File System Access + H.264/AAC mp4', () => {
  const c = detecterCapacite({ mediaRecorder: true, isTypeSupported: supporte('video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus'), showSaveFilePicker: true, opfs: true, opfsWritable: true, userAgent: CHROME });
  assert.equal(c.supporte, true); assert.equal(c.strategie, 'fsa'); assert.equal(c.extension, 'mp4'); assert.equal(c.codec, 'H.264 + AAC');
  assert.deepEqual(c.qualites, ['1080p', '720p']); assert.equal(c.mobile, false); assert.equal(qualiteParDefaut(c), '1080p');
});

test('Chrome desktop sans mp4 : WebM VP9+Opus, jamais de fausse promesse H.264', () => {
  const c = detecterCapacite({ mediaRecorder: true, isTypeSupported: supporte('video/webm;codecs=vp9,opus', 'video/webm'), showSaveFilePicker: true, opfs: true, opfsWritable: true, userAgent: CHROME });
  assert.equal(c.extension, 'webm'); assert.equal(c.codec, 'VP9 + Opus'); assert.equal(c.mime, 'video/webm;codecs=vp9,opus');
});

test('Firefox : pas de File System Access → OPFS, VP8/VP9 WebM', () => {
  const c = detecterCapacite({ mediaRecorder: true, isTypeSupported: supporte('video/webm;codecs=vp8,opus', 'video/webm'), showSaveFilePicker: false, opfs: true, opfsWritable: true, userAgent: 'Mozilla/5.0 Firefox/130.0' });
  assert.equal(c.strategie, 'opfs'); assert.equal(c.codec, 'VP8 + Opus');
});

test('Android Chrome : OPFS, mobile, 720p par défaut mais 1080p proposé', () => {
  const c = detecterCapacite({ mediaRecorder: true, isTypeSupported: supporte('video/webm;codecs=vp9,opus'), showSaveFilePicker: false, opfs: true, opfsWritable: true, userAgent: ANDROID });
  assert.equal(c.supporte, true); assert.equal(c.strategie, 'opfs'); assert.equal(c.mobile, true);
  assert.deepEqual(c.qualites, ['720p', '1080p']); assert.equal(qualiteParDefaut(c), '720p');
});

test('iOS Safari : OPFS + mp4 (H.264/AAC natif)', () => {
  const c = detecterCapacite({ mediaRecorder: true, isTypeSupported: supporte('video/mp4'), showSaveFilePicker: false, opfs: true, opfsWritable: false, userAgent: IOS });
  assert.equal(c.strategie, 'opfs'); assert.equal(c.extension, 'mp4'); assert.equal(c.mobile, true);
});

test('navigateur ancien sans MediaRecorder : non supporté, motif clair', () => {
  const c = detecterCapacite({ mediaRecorder: false, showSaveFilePicker: false, opfs: false, opfsWritable: false, userAgent: IOS });
  assert.equal(c.supporte, false); assert.equal(c.strategie, 'aucune'); assert.match(c.motif, /ordinateur/);
  const d = detecterCapacite({ mediaRecorder: false, showSaveFilePicker: false, opfs: false, opfsWritable: false, userAgent: CHROME });
  assert.match(d.motif, /ne sait pas/);
});

test('mémoire = dernier recours, avec avertissement', () => {
  assert.equal(choisirStrategie({ mediaRecorder: true, showSaveFilePicker: false, opfs: false, opfsWritable: false, userAgent: CHROME }), 'memoire');
  const c = detecterCapacite({ mediaRecorder: true, isTypeSupported: supporte('video/webm'), showSaveFilePicker: false, opfs: false, opfsWritable: false, userAgent: CHROME });
  assert.match(c.motif, /mémoire/);
  assert.ok(minutesMaxMemoire('1080p', 8) > minutesMaxMemoire('1080p', 2));
  assert.ok(minutesMaxMemoire('720p', 4) > minutesMaxMemoire('1080p', 4));
});

test('ordre des codecs : H.264/AAC avant WebM ; isTypeSupported qui jette est toléré', () => {
  assert.equal(MIMES_PREFERES[0].extension, 'mp4');
  assert.equal(choisirMime(() => { throw new Error('x'); }), null);
  assert.equal(choisirMime(undefined), null);
});

test('nom de fichier Afroboost-Live-AAAA-MM-JJ-HHMM.ext', () => {
  assert.equal(nomFichier(new Date(2026, 8, 17, 18, 30), 'mp4'), 'Afroboost-Live-2026-09-17-1830.mp4');
  assert.equal(nomFichier(new Date(2026, 0, 5, 7, 5), 'webm'), 'Afroboost-Live-2026-01-05-0705.webm');
});

test('débits : 1080p ≈ 8 Mb/s, 720p ≈ 4,5 Mb/s, audio 128 kb/s', () => {
  assert.deepEqual(bitratePour('1080p'), { video: 8_000_000, audio: 128_000 });
  assert.deepEqual(bitratePour('720p'), { video: 4_500_000, audio: 128_000 });
});

test('espace disque : insuffisant sous 5 min, limité sous 60 min, ok sinon, inconnu = ok', () => {
  const b = 8_128_000;
  assert.equal(estimerEspace(undefined, undefined, b).suffisant, true);
  const peu = estimerEspace(200e6, 0, b); assert.equal(peu.suffisant, false); assert.match(peu.message, /insuffisant/);
  const limite = estimerEspace(2e9, 0, b); assert.equal(limite.suffisant, true); assert.match(limite.message, /limité/);
  const ok = estimerEspace(200e9, 10e9, b); assert.equal(ok.suffisant, true); assert.equal(ok.message, null);
});

test('repli 720p : seulement en 1080p, après 5 s sous 24 i/s, une seule fois', () => {
  let e = { sousSeuilDepuis: null, replie: false };
  e = doitReplier720(e, 20, 1000, '1080p'); assert.equal(e.replier, false);
  e = doitReplier720(e, 20, 4000, '1080p'); assert.equal(e.replier, false);
  e = doitReplier720(e, 20, 6100, '1080p'); assert.equal(e.replier, true); assert.equal(e.replie, true);
  e = doitReplier720(e, 20, 9000, '1080p'); assert.equal(e.replier, false);
  let f = doitReplier720({ sousSeuilDepuis: 0, replie: false }, 30, 9000, '1080p'); assert.equal(f.sousSeuilDepuis, null);
  assert.equal(doitReplier720({ sousSeuilDepuis: null, replie: false }, 10, 99999, '720p').replier, false);
  assert.equal(doitReplier720({ sousSeuilDepuis: null, replie: false }, 0, 1, '1080p').replier, false, 'fps=0 = pas encore mesuré');
});

test('formats humains', () => {
  assert.equal(formaterDuree(754), '00:12:34'); assert.equal(formaterDuree(3661), '01:01:01');
  assert.equal(formaterTaille(500 * 1024), '500 Ko'); assert.equal(formaterTaille(1.5 * 1048576), '1.5 Mo'); assert.equal(formaterTaille(2 * 1073741824), '2.00 Go');
});

// ── WebM : insertion de la durée dans le premier morceau, en place ──────────
function vint(n) { return [0x80 | n]; }
function webmMinimal() {
  // EBML header (id 1A45DFA3, taille 3, contenu factice) + Segment (taille inconnue 0x01FFFFFFFFFFFFFF) + Info (TimecodeScale 1e6) + Cluster factice
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, ...vint(3), 1, 2, 3];
  const seg = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const tcs = [0x2a, 0xd7, 0xb1, ...vint(3), 0x0f, 0x42, 0x40]; // 1 000 000
  const info = [0x15, 0x49, 0xa9, 0x66, ...vint(tcs.length), ...tcs];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, ...vint(2), 0xe7, 0x81];
  return new Uint8Array([...ebml, ...seg, ...info, ...cluster]);
}

test('WebM : Duration inséré dans Info, offset exact, reste du fichier intact', () => {
  const src = webmMinimal();
  const r = preparerEnteteWebm(src);
  assert.notEqual(r.offsetDuree, null);
  assert.equal(r.octets.length, src.length + 11 + 7, '11 octets Duration + taille Info passée de 1 à 8 octets');
  assert.equal(r.timecodeScale, 1_000_000);
  // les 8 octets réservés sont à 0 et précédés de l'id 44 89 + taille 88
  assert.deepEqual([...r.octets.subarray(r.offsetDuree - 3, r.offsetDuree)], [0x44, 0x89, 0x88]);
  assert.deepEqual([...r.octets.subarray(r.offsetDuree, r.offsetDuree + 8)], [0, 0, 0, 0, 0, 0, 0, 0]);
  // le Cluster suit, inchangé
  const cl = [...r.octets.subarray(r.offsetDuree + 8, r.offsetDuree + 8 + 4)];
  assert.deepEqual(cl, [0x1f, 0x43, 0xb6, 0x75]);
  // idempotence : un second passage retrouve le Duration existant sans le réinsérer
  const r2 = preparerEnteteWebm(r.octets);
  assert.equal(r2.octets.length, r.octets.length); assert.equal(r2.offsetDuree, r.offsetDuree);
});

test('WebM : structure inattendue → octets inchangés, offset null (fichier toujours lisible)', () => {
  const brut = new Uint8Array([1, 2, 3, 4, 5]);
  const r = preparerEnteteWebm(brut); assert.equal(r.offsetDuree, null); assert.equal(r.octets, brut);
  const mp4 = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70]); assert.equal(preparerEnteteWebm(mp4).offsetDuree, null);
});

test('durée : float64 big-endian, unités = TimecodeScale', () => {
  const b = encoderDuree(1234.5); assert.equal(b.length, 8);
  assert.equal(new DataView(b.buffer).getFloat64(0, false), 1234.5);
  assert.equal(dureeEnUnites(5000, 1_000_000), 5000); assert.equal(dureeEnUnites(5000, 500_000), 10000);
});
