// Phase 4 — banc STRUCTUREL de l'enregistreur local : la vidéo ne part jamais au serveur,
// la source est le programme, l'écriture est progressive, un seul MediaRecorder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hook = readFileSync(new URL('../src/hooks/useProgramRecorder.ts', import.meta.url), 'utf8');
const logique = readFileSync(new URL('../src/lib/recordLogic.ts', import.meta.url), 'utf8');
const compositeur = readFileSync(new URL('../src/lib/programCompositor.ts', import.meta.url), 'utf8');
const programStream = readFileSync(new URL('../src/hooks/useProgramStream.ts', import.meta.url), 'utf8');
const ancien = readFileSync(new URL('../src/hooks/useSessionRecorder.ts', import.meta.url), 'utf8');

test('AUCUN envoi de la vidéo : ni fetch, ni upload, ni Supabase, ni S3/Cloudinary dans l’enregistreur', () => {
  for (const mot of ['fetch(', 'axios', 'XMLHttpRequest', 'upload', 'supabase', 'storage.from', 'cloudinary', 's3.', 'FormData', '/session/record']) {
    assert.equal(hook.toLowerCase().includes(mot.toLowerCase()), false, `interdit dans useProgramRecorder : ${mot}`);
    assert.equal(logique.toLowerCase().includes(mot.toLowerCase()), false, `interdit dans recordLogic : ${mot}`);
  }
});

test('source = programStream (option du hook), jamais getUserMedia / getDisplayMedia / 2ᵉ compositeur', () => {
  assert.match(hook, /programStream: MediaStream \| null/);
  assert.match(hook, /o\.programStream \?\? \(await o\.demarrerProgramme\(\)\)/);
  for (const mot of ['getUserMedia', 'getDisplayMedia', 'new ProgramCompositor', 'captureStream', 'AudioContext', 'BeauteProcessor', 'usePrompteur', 'Prompteur']) {
    assert.equal(hook.includes(mot), false, `interdit : ${mot}`);
  }
});

test('un seul MediaRecorder, tranche de 1 s, chaque morceau écrit immédiatement', () => {
  assert.equal((hook.match(/new MediaRecorder\(/g) || []).length, 1);
  assert.match(hook, /TIMESLICE_MS = 1000/);
  assert.match(hook, /rec\.start\(TIMESLICE_MS\)/);
  assert.match(hook, /ondataavailable = .*pousserEcriture\(ev\.data\)/);
  assert.match(hook, /await ecrivain\.ecrire\(data\)/);
});

test('trois destinations locales et rien d’autre : File System Access, OPFS, mémoire', () => {
  assert.match(hook, /showSaveFilePicker\(/);
  assert.match(hook, /storage\.getDirectory\(\)/);
  assert.match(hook, /ecrivainMemoire\(/);
  assert.match(logique, /'fsa' \| 'opfs' \| 'memoire' \| 'aucune'/);
});

test('changement de scène ≠ redémarrage : le compositeur redessine dans le même canvas, la piste survit', () => {
  // mettreAJour() ne recrée ni canvas ni captureStream ; changerResolution() redimensionne à chaud.
  const bloc = compositeur.slice(compositeur.indexOf('changerResolution('), compositeur.indexOf('mettreAJour('));
  assert.equal(bloc.includes('captureStream'), false);
  assert.match(bloc, /this\.canvas\.width = res\.largeur/);
  const maj = compositeur.slice(compositeur.indexOf('mettreAJour('), compositeur.indexOf('mettreAJour(') + 400);
  assert.equal(maj.includes('captureStream'), false);
  assert.equal(maj.includes('new MediaStream'), false);
  assert.match(programStream, /changerResolution: \(res: ResolutionProgramme\) => void/);
});

test('durée WebM corrigée en place (8 octets), jamais de réécriture complète du fichier', () => {
  assert.match(hook, /ecrivain\.corriger\(webmRef\.current\.offset, encoderDuree\(/);
  assert.match(hook, /\{ type: 'write', position, data: octets \}/);
});

test('crash : avertissement avant fermeture pendant l’enregistrement ; reprise OPFS proposée', () => {
  assert.match(hook, /beforeunload/);
  assert.match(hook, /export async function enregistrementsInterrompus/);
});

test('l’ancien enregistreur audio/transcription n’est pas touché par ce lot', () => {
  assert.equal(ancien.includes('useProgramRecorder'), false);
  assert.equal(hook.includes('useSessionRecorder'), false);
});

test('contrat exact du hook pour l’UI', () => {
  for (const cle of ['etat', 'capacite', 'qualite', 'choisirQualite', 'dureeSec', 'tailleOctets', 'demarrer', 'arreter', 'resultat', 'avis', 'fermerResultat']) {
    assert.match(hook, new RegExp(`\\b${cle}\\b`), `manque ${cle}`);
  }
  assert.match(hook, /'inactif' \| 'preparation' \| 'enregistrement' \| 'finalisation' \| 'pret' \| 'erreur'/);
  assert.match(hook, /sauvegarderSurAppareil: \(\) => Promise<void>/);
});
