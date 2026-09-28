/**
 * ❤ COMPTEUR DE LIKES — banc déterministe « bout en bout » (sans React, sans réseau réel).
 *
 * `Client` reproduit À L'IDENTIQUE le câblage de `hooks/useLiveReactions.ts` :
 *   - reagir   : tampon.ajouter → ajouterLocal (compte local immédiat)
 *   - tick     : tampon.vider à l'échéance (timer 1,5 s du hook)
 *   - annoncer : hôte, toutes les ≤ periodeTotalMs → EVT_TOTAL { from, totaux: totauxAnnoncables(...) }
 *   - recevoirLot   : ignore from === soi, puis appliquerLot
 *   - recevoirTotal : synchroTotal (max par type)
 * Le « réseau » est un bus : `self: false` (défaut realtime-js 2.108, vérifié dans
 * node_modules/@supabase/realtime-js/src/RealtimeChannel.ts) → pas d'écho, SAUF quand un cas
 * l'injecte explicitement (repli REST de `send()` quand le canal n'est pas joint).
 *
 * Anomalie prod 28/09 : +20 exact juste après la rafale, puis +2 / +4 / +11 quelques secondes plus
 * tard. Cause : l'hôte annonçait un total qui contenait déjà des clics ENCORE EN TAMPON ; un autre
 * client alignait son total dessus (max), puis recevait le lot de ces mêmes clics et les ajoutait
 * UNE DEUXIÈME FOIS ; s'il est lui aussi hôte (2e appareil admin), il ré-annonce ce total gonflé et
 * l'émetteur s'aligne dessus → surplus = nombre de clics en tampon au moment de l'annonce (0 à 20).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creerTamponReactions, appliquerLot, ajouterLocal, synchroTotal, doitAnnoncerTotal, totauxAnnoncables,
  ETAT_INITIAL, EVT_REACTIONS, EVT_TOTAL,
} from './.build/liveReactions.mjs';
import { lire, codeSeul } from './lireSource.mjs';

class Bus {
  constructor() { this.clients = []; this.journal = []; }
  brancher(c) { this.clients.push(c); c.bus = this; return c; }
  emettre(source, event, payload) {
    this.journal.push({ from: source.id, event, payload });
    for (const c of this.clients) if (c !== source) c.recevoir(event, payload);
  }
}

class Client {
  constructor(id, { estHote = false, seqInitial = 1_000_000, periodeTotalMs = 10_000 } = {}) {
    this.id = id;
    this.estHote = estHote;
    this.periodeTotalMs = periodeTotalMs;
    this.etat = ETAT_INITIAL;
    this.maintenant = 0;
    this.dernierAnnonce = null;
    this.dernierAnnonceMs = -Infinity;
    this.tampon = creerTamponReactions({
      from: id, intervalleMs: 1500, seqInitial,
      envoyer: (lot) => this.bus?.emettre(this, EVT_REACTIONS, lot),
    });
  }
  reagir(type, now) {
    this.maintenant = now;
    if (this.tampon.ajouter(type, now)) this.etat = ajouterLocal(this.etat, type);
  }
  tick(now) {
    this.maintenant = now;
    const e = this.tampon.prochainVidage();
    if (e !== null && now >= e) this.tampon.vider(now);
  }
  annoncer(now) {
    if (!this.estHote) return;
    const t = totauxAnnoncables(this.etat.totaux, this.tampon.comptesEnAttente());
    if (!doitAnnoncerTotal(this.dernierAnnonce, t, this.dernierAnnonceMs, now, this.periodeTotalMs)) return;
    this.dernierAnnonce = t;
    this.dernierAnnonceMs = now;
    this.bus?.emettre(this, EVT_TOTAL, { from: this.id, totaux: t });
  }
  recevoir(event, payload) {
    if (event === EVT_REACTIONS) {
      if (!payload || payload.from === this.id) return;
      this.etat = appliquerLot(this.etat, payload, this.maintenant);
    } else if (event === EVT_TOTAL) {
      if (!payload) return;
      this.etat = synchroTotal(this.etat, payload.totaux);
    }
  }
  get likes() { return this.etat.totaux.like; }
}

/** Fait avancer l'horloge commune de `de` à `a` par pas de 50 ms (timers du hook : 1,5 s / 2 s). */
function avancer(clients, de, a, { annonceToutesMs = 2000 } = {}) {
  for (let t = de; t <= a; t += 50) {
    for (const c of clients) { c.maintenant = t; c.tick(t); }
    if (t % annonceToutesMs === 0) for (const c of clients) c.annoncer(t);
  }
}
function rafale(c, debut, n = 20, pasMs = 50, type = 'like') {
  for (let i = 0; i < n; i++) c.reagir(type, debut + i * pasMs);
  return debut + (n - 1) * pasMs;
}

test('A seul : 20 clics → +20 exactement, 1 seul lot réseau', () => {
  const bus = new Bus();
  const A = bus.brancher(new Client('A', { estHote: true }));
  rafale(A, 100);
  assert.equal(A.likes, 20);
  avancer([A], 100, 30_000);
  assert.equal(A.likes, 20);
  assert.equal(bus.journal.filter((j) => j.event === EVT_REACTIONS).length, 1);
  assert.deepEqual(bus.journal.find((j) => j.event === EVT_REACTIONS).payload.counts, { like: 20 });
});

test('A reçoit son propre écho LIVE_REACTIONS (repli REST) → reste +20', () => {
  const bus = new Bus();
  const A = bus.brancher(new Client('A', { estHote: true }));
  rafale(A, 100);
  avancer([A], 100, 3000);
  const lot = bus.journal.find((j) => j.event === EVT_REACTIONS).payload;
  A.recevoir(EVT_REACTIONS, lot);
  A.recevoir(EVT_REACTIONS, { ...lot });
  assert.equal(A.likes, 20);
});

test('A reçoit son propre LIVE_REACTIONS_TOTAL, annoncé PENDANT la rafale puis rejoué → reste +20', () => {
  const bus = new Bus();
  const A = bus.brancher(new Client('A', { estHote: true }));
  const echos = [];
  // Annonce au milieu de la rafale (10 clics en tampon), puis écho, puis rejeu tardif.
  for (let i = 0; i < 10; i++) A.reagir('like', 100 + i * 50);
  A.annoncer(600);
  const annonce = bus.journal.find((j) => j.event === EVT_TOTAL);
  if (annonce) echos.push(annonce.payload);
  for (let i = 10; i < 20; i++) A.reagir('like', 100 + i * 50);
  for (const e of echos) A.recevoir(EVT_TOTAL, e);
  avancer([A], 1100, 25_000);
  for (const j of bus.journal.filter((x) => x.event === EVT_TOTAL)) A.recevoir(EVT_TOTAL, j.payload);
  assert.equal(A.likes, 20);
});

test('B 20 clics → A voit exactement +20 (et B aussi)', () => {
  const bus = new Bus();
  const A = bus.brancher(new Client('A', { estHote: true }));
  const B = bus.brancher(new Client('B'));
  rafale(B, 100);
  avancer([A, B], 100, 30_000);
  assert.equal(A.likes, 20);
  assert.equal(B.likes, 20);
});

test('annonce de l’hôte PENDANT sa rafale : aucun client ne compte en double', () => {
  // Reproduction prod : A (hôte) + un 2e client hôte H2 (autre appareil admin, id différent).
  for (const clicsAvantAnnonce of [2, 4, 11, 0, 20]) {
    const bus = new Bus();
    const A = bus.brancher(new Client('A', { estHote: true }));
    const H2 = bus.brancher(new Client('H2', { estHote: true }));
    const S = bus.brancher(new Client('S')); // spectateur
    const tous = [A, H2, S];
    const t0 = 20_000 - clicsAvantAnnonce * 50 + 50; // l'annonce de 20 000 ms tombe au milieu
    avancer(tous, 0, t0 - 50);
    for (let i = 0; i < 20; i++) {
      const now = t0 + i * 50;
      A.reagir('like', now);
      for (const c of tous) { c.maintenant = now; c.tick(now); }
      if (now % 2000 === 0) for (const c of tous) c.annoncer(now);
    }
    avancer(tous, t0 + 20 * 50, 60_000);
    assert.equal(A.likes, 20, `A (annonce après ${clicsAvantAnnonce} clics)`);
    assert.equal(H2.likes, 20, `H2 (annonce après ${clicsAvantAnnonce} clics)`);
    assert.equal(S.likes, 20, `spectateur (annonce après ${clicsAvantAnnonce} clics)`);
  }
});

test('plusieurs rafales successives (4 × 20), annonces à toutes les phases → +80 partout', () => {
  const bus = new Bus();
  const A = bus.brancher(new Client('A', { estHote: true }));
  const H2 = bus.brancher(new Client('H2', { estHote: true }));
  const S = bus.brancher(new Client('S'));
  const tous = [A, H2, S];
  let t = 0;
  for (const debut of [9_400, 21_700, 31_000, 43_300]) {
    avancer(tous, t, debut - 50);
    // Rafale entrelacée avec le temps (les annonces peuvent tomber au milieu).
    for (let i = 0; i < 20; i++) {
      const now = debut + i * 50;
      A.reagir('like', now);
      for (const c of tous) { c.maintenant = now; c.tick(now); }
      if (now % 2000 === 0) for (const c of tous) c.annoncer(now);
    }
    t = debut + 20 * 50;
  }
  avancer(tous, t, 80_000);
  assert.deepEqual([A.likes, H2.likes, S.likes], [80, 80, 80], `A=${A.likes} H2=${H2.likes} S=${S.likes}`);
});

test('événement dupliqué et hors ordre (seq plus petit après plus grand) → ignoré', () => {
  let e = ETAT_INITIAL;
  e = appliquerLot(e, { from: 'B', seq: 10, counts: { like: 5 } }, 0);
  e = appliquerLot(e, { from: 'B', seq: 10, counts: { like: 5 } }, 5000); // doublon
  e = appliquerLot(e, { from: 'B', seq: 12, counts: { like: 3 } }, 10_000);
  e = appliquerLot(e, { from: 'B', seq: 11, counts: { like: 7 } }, 15_000); // hors ordre
  assert.equal(e.totaux.like, 8);
});

test('rechargement de B (nouveau seqInitial, même userId) → ses nouveaux lots comptent, une fois', () => {
  const bus = new Bus();
  const A = bus.brancher(new Client('A', { estHote: true }));
  const B1 = bus.brancher(new Client('B', { seqInitial: 1_000 }));
  rafale(B1, 100);
  avancer([A, B1], 100, 5000);
  bus.clients = bus.clients.filter((c) => c !== B1);
  const B2 = bus.brancher(new Client('B', { seqInitial: 9_000 })); // Date.now() plus grand
  rafale(B2, 6000, 5);
  avancer([A, B2], 6000, 30_000);
  assert.equal(A.likes, 25);
  assert.equal(B2.likes, 25, 'B2 rattrape le total par l’annonce de l’hôte');
});

test('changement de session : un NOUVEAU client (état initial) repart de 0', () => {
  // Le hook est monté dans SessionPage ; une autre session = autre montage = ETAT_INITIAL.
  const C = new Client('A', { estHote: true });
  assert.equal(C.likes, 0);
  assert.deepEqual(ETAT_INITIAL.totaux, { like: 0, bravo: 0, feu: 0, pouce: 0, main: 0, rire: 0 });
});

test('l’hôte reçoit un TOTAL plus élevé d’un autre émetteur → s’aligne (max), sans cumuler', () => {
  let e = ajouterLocal(ETAT_INITIAL, 'like', 20);
  e = synchroTotal(e, { like: 35, bravo: 0, feu: 0 });
  e = synchroTotal(e, { like: 35, bravo: 0, feu: 0 });
  e = synchroTotal(e, { like: 30, bravo: 0, feu: 0 });
  assert.equal(e.totaux.like, 35);
});

test('totauxAnnoncables retire les clics encore en tampon (jamais négatif)', () => {
  assert.deepEqual(totauxAnnoncables({ like: 30, bravo: 2, feu: 0 }, { like: 11 }), { like: 19, bravo: 2, feu: 0 });
  assert.deepEqual(totauxAnnoncables({ like: 3, bravo: 0, feu: 0 }, { like: 9 }), { like: 0, bravo: 0, feu: 0 });
  const t = { like: 4, bravo: 0, feu: 0 };
  assert.equal(totauxAnnoncables(t, {}), t, 'rien en tampon → même référence');
});

test('le hook annonce le total SANS les clics en tampon (câblage source)', () => {
  const src = codeSeul(lire('hooks', 'useLiveReactions.ts'));
  assert.match(src, /totauxAnnoncables\(\s*etatRef\.current\.totaux\s*,\s*tamponRef\.current\?\.comptesEnAttente\(\)/);
});
