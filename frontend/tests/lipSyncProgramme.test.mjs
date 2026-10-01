// 🎯 01/10 — LIP-SYNC de l'enregistrement : la voix ne fait plus le détour MediaStream → 2ᵉ AudioContext.
// Mesure réelle (banc Chrome, chaîne programme, MP4 H.264+AAC) : ce détour retardait la voix de 60 à
// 90 ms sur l'image. Le bus vit désormais dans le contexte du MICRO et s'y branche par NŒUD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgramAudioBus } from './.build/programAudio.mjs';
import { lire, codeSeul } from './lireSource.mjs';

class Noeud {
  constructor(ctx, nom) { this.context = ctx; this.nom = nom; this.sorties = new Set(); }
  connect(n) { this.sorties.add(n); return n; }
  disconnect(n) { if (n) this.sorties.delete(n); else this.sorties.clear(); }
}
class FauxContexte {
  constructor() { this.state = 'running'; this.fermetures = 0; this.sourcesFlux = 0; this.currentTime = 0; }
  createMediaStreamDestination() { const d = new Noeud(this, 'dest'); d.stream = { getAudioTracks: () => [{}], getTracks: () => [{ stop() {} }] }; return d; }
  createDynamicsCompressor() { const n = new Noeud(this, 'lim'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = { value: 0 }; return n; }
  createGain() { const n = new Noeud(this, 'gain'); n.gain = { value: 1, setTargetAtTime() {} }; return n; }
  createMediaStreamSource() { this.sourcesFlux += 1; return new Noeud(this, 'source-flux'); }
  resume() { return Promise.resolve(); }
  close() { this.fermetures += 1; this.state = 'closed'; }
}
globalThis.window = globalThis.window || {};
globalThis.MediaStream = globalThis.MediaStream || class { constructor(t) { this.t = t; } };

test('ROUGE avant : le micro du mixeur entre par NŒUD dans le contexte du micro (aucune source MediaStream)', () => {
  const micCtx = new FauxContexte();
  const limiteurMixeur = new Noeud(micCtx, 'limiteur-mixeur');
  const diffusionWebRTC = new Noeud(micCtx, 'micDest'); limiteurMixeur.connect(diffusionWebRTC);
  const bus = new ProgramAudioBus();
  assert.ok(bus.demarrer(micCtx));
  assert.equal(bus.contexte, micCtx, 'même horloge que le micro');
  bus.synchroniser([{ id: 'mic', flux: { getAudioTracks: () => [{ readyState: 'live', clone() { return {}; } }] }, noeud: limiteurMixeur, gain: 1 }]);
  assert.equal(micCtx.sourcesFlux, 0, 'aucun détour MediaStream pour la voix');
  assert.equal(limiteurMixeur.sorties.size, 2, 'diffusion + bus');
  // Retrait : SEULE la liaison vers le bus est coupée — la diffusion WebRTC continue.
  bus.retirer('mic');
  assert.deepEqual([...limiteurMixeur.sorties], [diffusionWebRTC]);
  // Arrêt : le contexte du micro n'est JAMAIS fermé par le bus.
  bus.arreter();
  assert.equal(micCtx.fermetures, 0);
  assert.equal(micCtx.state, 'running');
});

test('sans contexte micro (micro pas encore branché) : comportement d’avant, contexte dédié + flux', () => {
  const crees = [];
  globalThis.window.AudioContext = class extends FauxContexte { constructor() { super(); crees.push(this); } };
  const bus = new ProgramAudioBus();
  assert.ok(bus.demarrer(null));
  bus.synchroniser([{ id: 'mic', flux: { getAudioTracks: () => [{ readyState: 'live', clone() { return {}; } }] }, noeud: null }]);
  assert.equal(crees.length, 1); assert.equal(crees[0].sourcesFlux, 1);
  bus.arreter();
  assert.equal(crees[0].fermetures, 1, 'son propre contexte est fermé, comme avant');
});

test('nœud d’un AUTRE contexte : refusé (jamais de liaison inter-contextes), repli sur le flux', () => {
  const micCtx = new FauxContexte(); const autre = new FauxContexte();
  const bus = new ProgramAudioBus(); bus.demarrer(micCtx);
  assert.equal(bus.ajouterNoeud('mic', new Noeud(autre, 'x')), false);
  bus.synchroniser([{ id: 'mic', flux: { getAudioTracks: () => [{ readyState: 'live', clone() { return {}; } }] }, noeud: new Noeud(autre, 'x') }]);
  assert.equal(micCtx.sourcesFlux, 1);
});

test('câblage : mixeur → useProgramStream → bus (mêmes pistes, MediaRecorder et timeslice inchangés)', () => {
  const ps = codeSeul(lire('hooks/useProgramStream.ts'));
  assert.match(ps, /bus\.demarrer\(o\.audio\.getMicNoeud\?\.\(\)\?\.ctx \?\? null\)/);
  assert.match(ps, /noeud: e\.id === 'mic' && micNoeud && micNoeud\.ctx === bus\.contexte \? micNoeud\.noeud : null/);
  const mx = codeSeul(lire('hooks/useAudioMixer.ts'));
  assert.match(mx, /const ctx = micCtxRef\.current; const noeud = micLimiterRef\.current;/);
  const sp = codeSeul(lire('pages/SessionPage.tsx'));
  assert.match(sp, /getMicNoeud: \(\) => getMicNoeud\(\),/);
  const rec = codeSeul(lire('hooks/useProgramRecorder.ts'));
  assert.match(rec, /const TIMESLICE_MS = 1000;/);
  assert.match(rec, /rec\.start\(TIMESLICE_MS\);/);
});
