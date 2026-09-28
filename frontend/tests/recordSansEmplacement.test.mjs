// UX REC — « Enregistrer » démarre IMMÉDIATEMENT : aucun choix d'emplacement avant la capture,
// aucun fichier 0 octet laissé, export proposé SEULEMENT après finalisation, option
// « Enregistrer dès le démarrage ». Logique pure (esbuild → tests/.build) + banc structurel du hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  choisirStrategie, detecterCapacite, exportAutorise, apresExport, lirePrefAuto, doitDemarrerAuto, etapesEnregistrement, CLE_PREF_AUTO,
} from './.build/recordLogic.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/128.0';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/605.1';
const env = (x) => ({ mediaRecorder: true, showSaveFilePicker: false, opfs: false, opfsWritable: false, userAgent: CHROME, ...x });

const HOOK = codeSeul(lire('hooks', 'useProgramRecorder.ts'));
const PANEL = codeSeul(lire('components', 'session', 'RecordPanel.tsx'));
const TYPES = lire('components', 'session', 'RecordTypes.ts');

/** Corps de `const demarrer = …` jusqu'à la déclaration suivante (fonction ou const de premier niveau du hook). */
function corpsDemarrer() {
  const i = HOOK.indexOf('const demarrer = ');
  assert.ok(i > 0, 'demarrer introuvable');
  const reste = HOOK.slice(i + 1);
  const fin = reste.search(/\n  (async function |function |const [a-zA-Z]+ = )/);
  return HOOK.slice(i, i + 1 + fin);
}

// ── 1. Stratégie de CAPTURE : jamais `fsa` ────────────────────────────────────
test('capture : showSaveFilePicker présent ne choisit JAMAIS fsa — OPFS écrivable sinon mémoire', () => {
  assert.equal(choisirStrategie(env({ showSaveFilePicker: true, opfs: true, opfsWritable: true })), 'opfs');
  assert.equal(choisirStrategie(env({ showSaveFilePicker: true, opfs: false, opfsWritable: false })), 'memoire');
  assert.equal(choisirStrategie(env({ showSaveFilePicker: true, opfs: true, opfsWritable: false })), 'memoire');
  assert.equal(choisirStrategie(env({ mediaRecorder: false, showSaveFilePicker: true, opfs: true, opfsWritable: true })), 'aucune');
});

test('Safari (OPFS sans createWritable) : mémoire, plus de fausse promesse OPFS', () => {
  const c = detecterCapacite({ ...env({ opfs: true, opfsWritable: false, userAgent: IOS }), isTypeSupported: (m) => m === 'video/mp4' });
  assert.equal(c.strategie, 'memoire');
});

test('étapes : aucune « choisir_emplacement » avant « capture »', () => {
  const cap = detecterCapacite({ ...env({ showSaveFilePicker: true, opfs: true, opfsWritable: true }), isTypeSupported: () => true });
  const e = etapesEnregistrement(cap);
  const iCapture = e.indexOf('capture');
  assert.ok(iCapture >= 0, 'capture présente');
  assert.equal(e.slice(0, iCapture).includes('choisir_emplacement'), false);
  assert.equal(e[0], 'capture', 'la capture est la PREMIÈRE étape');
  assert.ok(e.indexOf('export') > e.indexOf('finalisation'), 'export après finalisation');
  const non = detecterCapacite(env({ mediaRecorder: false }));
  assert.deepEqual(etapesEnregistrement(non), []);
});

// ── 2/3. Export seulement après finalisation, jamais 0 octet ─────────────────
test('exportAutorise : seulement « prêt » + fichier fermé + taille > 0', () => {
  assert.equal(exportAutorise({ etat: 'pret', fichierFerme: true, taille: 1024 }), true);
  assert.equal(exportAutorise({ etat: 'pret', fichierFerme: true, taille: 0 }), false);
  assert.equal(exportAutorise({ etat: 'pret', fichierFerme: false, taille: 1024 }), false);
  for (const etat of ['inactif', 'preparation', 'enregistrement', 'finalisation', 'erreur']) {
    assert.equal(exportAutorise({ etat, fichierFerme: true, taille: 1024 }), false, etat);
  }
});

// ── 4. Option « Enregistrer dès le démarrage » ───────────────────────────────
test('lirePrefAuto : « 1 » → vrai, tout le reste → faux', () => {
  assert.equal(CLE_PREF_AUTO, 'bt_rec_auto');
  assert.equal(lirePrefAuto('1'), true);
  for (const v of [null, undefined, '', '0', 'true', 'oui', '11']) assert.equal(lirePrefAuto(v), false, String(v));
});

test('doitDemarrerAuto : vrai seulement si auto + live_demarre + hôte + inactif + supporté', () => {
  const ok = { auto: true, evenement: 'live_demarre', estHote: true, recEtat: 'inactif', supporte: true };
  assert.equal(doitDemarrerAuto(ok), true);
  assert.equal(doitDemarrerAuto({ ...ok, auto: false }), false);
  assert.equal(doitDemarrerAuto({ ...ok, evenement: 'live_termine' }), false);
  assert.equal(doitDemarrerAuto({ ...ok, estHote: false }), false);
  assert.equal(doitDemarrerAuto({ ...ok, supporte: false }), false);
  for (const recEtat of ['preparation', 'enregistrement', 'finalisation', 'pret', 'erreur']) {
    assert.equal(doitDemarrerAuto({ ...ok, recEtat }), false, recEtat);
  }
});

// ── Banc structurel du hook ──────────────────────────────────────────────────
test('demarrer() n’ouvre AUCUN sélecteur de fichier (pas de fichier 0 octet au démarrage)', () => {
  const d = corpsDemarrer();
  assert.equal(d.includes('showSaveFilePicker('), false, 'showSaveFilePicker( dans demarrer');
  assert.equal(d.includes("'fsa'"), false, 'branche fsa dans demarrer');
});

test('showSaveFilePicker( n’existe QUE dans l’export, gardé par exportAutorise', () => {
  const n = (HOOK.match(/showSaveFilePicker\(/g) || []).length;
  assert.equal(n, 1, 'un seul appel');
  const i = HOOK.indexOf('showSaveFilePicker(');
  const fn = HOOK.lastIndexOf('async function exporterFichier', i);
  assert.ok(fn >= 0 && i - fn < 1500, 'appel situé dans exporterFichier');
  assert.match(HOOK, /exportAutorise\(\{/);
  assert.match(HOOK, /createWritable\(\)[\s\S]{0,200}\.close\(\)/, 'copie écrite puis fermée');
});

test('échec au démarrage : l’entrée OPFS est SUPPRIMÉE (abandonner puis supprimer)', () => {
  const d = corpsDemarrer();
  const c = d.slice(d.lastIndexOf('} catch (e) {'));
  assert.match(c, /abandonner\(\)/);
  assert.match(c, /supprimer\(\)/);
  assert.ok(c.indexOf('supprimer()') > c.indexOf('abandonner()'), 'supprimer après abandonner');
  assert.ok(c.indexOf('supprimer()') < c.indexOf('nettoyer()'), 'supprimer avant nettoyer (qui efface l’écrivain)');
});

test('hook : autoStart + setAutoStart, clé bt_rec_auto lue/écrite sous try/catch ; contrat UI', () => {
  assert.match(HOOK, /autoStart/);
  assert.match(HOOK, /setAutoStart/);
  assert.match(HOOK, /CLE_PREF_AUTO/);
  assert.match(HOOK, /try \{[^}]*localStorage\.getItem\(CLE_PREF_AUTO\)/);
  assert.match(HOOK, /try \{[^}]*localStorage\.(setItem|removeItem)\(CLE_PREF_AUTO/);
  assert.match(TYPES, /autoStart\??: boolean/);
  assert.match(TYPES, /setAutoStart\??: \(v: boolean\) => void/);
});

test('panneau : case « Enregistrer dès le démarrage » liée à autoStart/setAutoStart, sans emoji', () => {
  assert.ok(PANEL.includes('Enregistrer dès le démarrage'));
  assert.ok(PANEL.includes('type="checkbox"'));
  assert.ok(PANEL.includes('recorder.autoStart'));
  assert.ok(/recorder\.setAutoStart\??\.?\(/.test(PANEL));
  assert.ok(PANEL.includes('data-testid="record-auto"'));
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(PANEL), false, 'aucun emoji');
});

// ── Suite : après un export RÉUSSI, jamais un bouton qui ne fait rien ────────
test('apresExport : écrit / téléchargé → exporté, confirmation, plus de bouton ; annulé → bouton toujours là', () => {
  for (const issue of ['ecrit', 'telecharge']) {
    const r = apresExport({ exporte: false }, issue);
    assert.equal(r.exporte, true, issue);
    assert.equal(r.boutonExport, false, issue);
    assert.equal(r.message, 'Enregistré sur votre appareil', issue);
  }
  assert.deepEqual(apresExport({ exporte: false }, 'annule'), { exporte: false, boutonExport: true, message: null });
  // Déjà exporté (temporaire supprimé) : une annulation ultérieure ne ressuscite pas le bouton.
  assert.equal(apresExport({ exporte: true }, 'annule').boutonExport, false);
  assert.equal(apresExport({ exporte: true }, 'annule').exporte, true);
});

test('exportAutorise refuse un fichier déjà exporté (temporaire supprimé)', () => {
  assert.equal(exportAutorise({ etat: 'pret', fichierFerme: true, taille: 10, exporte: true }), false);
  assert.equal(exportAutorise({ etat: 'pret', fichierFerme: true, taille: 10, exporte: false }), true);
});

test('hook + panneau : l’issue de l’export met à jour le résultat ; confirmation affichée, bouton masqué', () => {
  assert.match(HOOK, /apresExport\(/);
  assert.match(HOOK, /setResultat\(\(r\) =>/);
  assert.match(TYPES, /exporte\?: boolean/);
  assert.ok(PANEL.includes('data-testid="record-exporte"'), 'confirmation');
  assert.ok(/resultat\.exporte/.test(PANEL), 'panneau lit resultat.exporte');
});

test('banc QuickTime : plus de scénario fsa', () => {
  const qt = lire('..', 'tests', 'record.quicktime.cjs');
  assert.equal(/'fsa'|\?fsa=1|__fsaNom/.test(qt), false);
});
