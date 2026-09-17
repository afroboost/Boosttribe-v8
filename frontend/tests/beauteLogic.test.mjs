/**
 * ✨ Embellir le visage — la logique PURE, prouvée sans navigateur.
 *   - niveaux → paramètres : off = brut ; léger < moyen ; lissage jamais > 0,5 (rendu naturel) ;
 *   - persistance : absent/inconnu = off, écriture/effacement ;
 *   - résolution de traitement plafonnée à 720 px, proportions et parité conservées ;
 *   - garde de performance : < 20 fps pendant 3 s → coupure UNE fois ; retour au-dessus = reset ;
 *   - support : WebGL + captureStream requis ;
 *   - désactivation = paramètres neutres (la piste brute est republiée par LiveKit).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parametresBeaute, LISSAGE_MAX, lireNiveauBeaute, ecrireNiveauBeaute, CLE_STOCKAGE_BEAUTE,
  resolutionTraitement, GardePerformance, supportBeaute, niveauSuivant, estNiveauBeaute, NIVEAUX_BEAUTE,
} from './.build/beauteLogic.mjs';

test('off = image brute, sans aucune correction', () => {
  const p = parametresBeaute('off');
  assert.equal(p.lissage, 0); assert.equal(p.rayon, 0); assert.equal(p.eclaircissement, 0); assert.equal(p.contraste, 1);
});

test('léger < moyen, et le lissage ne dépasse jamais 0,5 (jamais plastique)', () => {
  const l = parametresBeaute('leger'), m = parametresBeaute('moyen');
  assert.ok(l.lissage > 0 && l.lissage < m.lissage);
  assert.ok(l.rayon < m.rayon);
  assert.ok(m.lissage <= LISSAGE_MAX && LISSAGE_MAX <= 0.5);
  // touche finale très légère : pas de délavage
  assert.ok(m.eclaircissement <= 0.03 && m.contraste >= 0.98);
});

test('niveau inconnu → paramètres off', () => {
  assert.equal(parametresBeaute('fort').lissage, 0);
  assert.equal(estNiveauBeaute('fort'), false);
  assert.deepEqual([...NIVEAUX_BEAUTE], ['off', 'leger', 'moyen']);
});

test('persistance : absent/inconnu = off ; écriture ; off efface la clé', () => {
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(lireNiveauBeaute(st), 'off');
  mem.set(CLE_STOCKAGE_BEAUTE, 'nimporte'); assert.equal(lireNiveauBeaute(st), 'off');
  ecrireNiveauBeaute(st, 'moyen'); assert.equal(lireNiveauBeaute(st), 'moyen');
  ecrireNiveauBeaute(st, 'off'); assert.equal(mem.has(CLE_STOCKAGE_BEAUTE), false);
  assert.equal(lireNiveauBeaute(null), 'off');
  assert.equal(lireNiveauBeaute({ getItem: () => { throw new Error('privé'); } }), 'off');
});

test('résolution de traitement : plafond 720 sur le grand côté, proportions, dimensions paires', () => {
  assert.deepEqual(resolutionTraitement(1920, 1080), { largeur: 720, hauteur: 406 });
  assert.deepEqual(resolutionTraitement(1080, 1920), { largeur: 406, hauteur: 720 });
  assert.deepEqual(resolutionTraitement(640, 480), { largeur: 640, hauteur: 480 });
  const r = resolutionTraitement(1279, 719); assert.equal(r.largeur % 2, 0); assert.equal(r.hauteur % 2, 0);
  assert.deepEqual(resolutionTraitement(0, 0), { largeur: 2, hauteur: 2 });
});

test('garde de performance : 30 fps stable → jamais de coupure', () => {
  const g = new GardePerformance();
  let coupe = false;
  for (let t = 0; t <= 6000; t += 33) coupe = g.enregistrer(t) || coupe;
  assert.equal(coupe, false);
  assert.ok(g.fps(6000) > 28);
});

test('garde de performance : 12 fps pendant 3 s → coupure UNE seule fois', () => {
  const g = new GardePerformance();
  const coupures = [];
  for (let t = 0; t <= 8000; t += 83) if (g.enregistrer(t)) coupures.push(t);
  assert.equal(coupures.length, 1);
  assert.ok(coupures[0] >= 4000 && coupures[0] <= 4300, `coupure à ${coupures[0]} ms (attendu ≈ 1 s d'échauffement + 3 s)`);
});

test('garde de performance : une chute brève (< 3 s) puis retour → pas de coupure', () => {
  const g = new GardePerformance();
  let coupe = false;
  for (let t = 0; t < 2000; t += 33) coupe = g.enregistrer(t) || coupe;   // 30 fps
  for (let t = 2000; t < 4000; t += 100) coupe = g.enregistrer(t) || coupe; // 10 fps pendant 2 s
  for (let t = 4000; t < 8000; t += 33) coupe = g.enregistrer(t) || coupe;  // retour 30 fps
  assert.equal(coupe, false);
});

test('support : WebGL ET captureStream obligatoires', () => {
  assert.equal(supportBeaute({ captureStream: true, webgl: true }), true);
  assert.equal(supportBeaute({ captureStream: false, webgl: true }), false);
  assert.equal(supportBeaute({ captureStream: true, webgl: false }), false);
  assert.equal(supportBeaute(null), false);
});

test('rotation off → léger → moyen → off', () => {
  assert.equal(niveauSuivant('off'), 'leger'); assert.equal(niveauSuivant('leger'), 'moyen'); assert.equal(niveauSuivant('moyen'), 'off');
});
