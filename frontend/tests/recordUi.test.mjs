/**
 * ⏺ « Enregistrer le Programme » — UI : banc STRUCTUREL (esbuild + node --test, même style
 * que broadcastUi.test.mjs) + banc LOGIQUE des helpers purs.
 *
 * Ce que Bassi a exigé (Phase 4) :
 *  - entrée = item ⋮ « Enregistrer » ; actif = « ● Enregistrement HH:MM:SS » / Arrêter ;
 *  - sur la vidéo : seulement un badge discret « ● REC » pendant l'enregistrement ;
 *  - panneau : qualité 720p/1080p selon capacité (1080p par défaut, 720p sur mobile), format
 *    réel jamais promis, avis (espace disque…), Démarrer ; pendant : durée + taille + Arrêter ;
 *    prêt : nom/durée/taille/résolution/format + « Enregistrer sur mon appareil » (ou
 *    « Fichier enregistré » si déjà écrit) ; erreur : message + Réessayer ;
 *  - non supporté (mobile) → item désactivé + motif ;
 *  - AUCUN upload, aucun fetch : le fichier reste sur l'appareil.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const PANEL = lire('components', 'session', 'RecordPanel.tsx');
const TYPES = lire('components', 'session', 'RecordTypes.ts');
const VISIO = lire('components', 'session', 'LiveVisioPanel.tsx');
const MENU = lire('components', 'session', 'MenuActions.tsx');
const CODE = codeSeul(PANEL);

// ── Contrat ──────────────────────────────────────────────────────────────────
test('contrat : états, capacité, qualités, résultat, rappels — exactement ceux du hook', () => {
  for (const s of ["'inactif'", "'preparation'", "'enregistrement'", "'finalisation'", "'pret'", "'erreur'"]) assert.ok(TYPES.includes(s), s);
  for (const s of ["'fsa'", "'opfs'", "'memoire'", "'aucune'"]) assert.ok(TYPES.includes(s), s);
  for (const f of ['choisirQualite:', 'demarrer:', 'arreter:', 'fermerResultat:', 'sauvegarderSurAppareil:', 'dejaEcrit:', 'emplacement?:']) assert.ok(TYPES.includes(f), f);
  assert.ok(TYPES.includes("'720p' | '1080p'"), 'qualités');
});

// ── Entrée ⋮ + badge ─────────────────────────────────────────────────────────
test('entrée : item ⋮ « Enregistrer » (Disc) après Diffuser, Arrêter (Square) en enregistrement, fermeture après clic', () => {
  const items = VISIO.slice(VISIO.indexOf('<MenuActions'), VISIO.indexOf("id: 'quitter'"));
  assert.ok(items.indexOf("id: 'broadcast'") < items.indexOf("id: 'record'"), 'après Diffuser en direct');
  assert.ok(items.indexOf("id: 'record'") < items.indexOf("id: 'embellir'"), 'avant Embellir');
  assert.ok(items.includes("testId: 'visio-record'"), 'data-testid conservé');
  assert.ok(items.includes("recordEtat === 'enregistrement' ? <Square"), 'icône Square quand ça tourne');
  assert.ok(items.includes('libelleItemRecord(recordEtat, recordDureeSec)'), 'libellé « Enregistrer » / « Enregistrement HH:MM:SS »');
  assert.ok(items.includes('fermeApres: true'), 'le menu se referme quand on ouvre le panneau');
  assert.ok(MENU.includes('if (!it.node || it.fermeApres) setOpen(false)'), 'MenuActions honore fermeApres');
});

test('badge : « ● REC HH:MM:SS » sur la vidéo, uniquement en enregistrement, jamais d’autre UI', () => {
  assert.ok(VISIO.includes('data-testid="record-badge"'), 'badge');
  assert.ok(VISIO.includes('{badgeVisible(recordEtat) && ('), 'conditionné à l’état enregistrement');
  assert.ok(VISIO.includes('REC {formatDureeRec(recordDureeSec)}'), 'durée dans le badge');
  assert.ok(VISIO.includes('{recordOpen && recordNode}'), 'panneau monté seulement si ouvert');
  const propsBloc = VISIO.slice(VISIO.indexOf('interface LiveVisioPanelProps'), VISIO.indexOf('type Layout'));
  for (const p of ['recordNode?: React.ReactNode', 'recordOpen?: boolean', 'recordEtat?: RecEtat', 'recordDureeSec?: number', 'recordSupporte?: boolean', 'recordMotif?: string', 'onToggleRecord?: () => void']) assert.ok(propsBloc.includes(p), p);
});

test('non supporté : item désactivé avec le motif, panneau explique — jamais un bouton mort', () => {
  assert.ok(VISIO.includes('data-testid="visio-record-indisponible"'), 'item indisponible');
  assert.ok(VISIO.includes("onSelect: recordSupporte ? onToggleRecord : () => {}"), 'aucune action si non supporté');
  assert.ok(CODE.includes('data-testid="record-indisponible"'), 'panneau : motif');
  assert.ok(CODE.includes('motifIndisponible(capacite)'), 'motif dérivé de la capacité');
});

// ── Panneau ──────────────────────────────────────────────────────────────────
test('panneau : fermé = rien ; qualités selon capacité ; format réel ; avis ; Démarrer', () => {
  assert.ok(CODE.includes('if (!open) return null;'), 'fermé = rien');
  assert.ok(CODE.includes("QUALITES.filter((q) => capacite.qualites.includes(q))"), 'seulement les qualités possibles');
  assert.ok(CODE.includes('data-testid={`record-qualite-${q}`}'), 'record-qualite-720p / -1080p');
  assert.ok(CODE.includes('libelleFormat(capacite)'), 'format déduit, jamais promis');
  assert.ok(CODE.includes('data-testid="record-avis"'), 'avis (espace disque, mémoire)');
  assert.ok(CODE.includes('data-testid="record-start"'), 'Démarrer');
  assert.ok(CODE.includes("void recorder.demarrer()"), 'Démarrer → demarrer()');
  assert.equal((CODE.match(/recorder\.demarrer\(\)/g) || []).length, 2, 'demarrer : Démarrer + Réessayer, rien d’autre');
  assert.ok(CODE.includes('data-record-mode="mobile"') && CODE.includes('data-record-mode="desktop"'), 'deux modes');
  assert.ok(CODE.includes('env(safe-area-inset-bottom)'), 'bouton principal en bas, zone sûre (mobile)');
});

test('pendant : durée + taille + « Arrêter l’enregistrement » ; finalisation occupée ; prêt : fiche + sauvegarde ou déjà écrit ; erreur : Réessayer', () => {
  assert.ok(CODE.includes('data-testid="record-duree"') && CODE.includes('data-testid="record-taille"'), 'durée + taille');
  assert.ok(CODE.includes('data-testid="record-stop"') && CODE.includes('void recorder.arreter()'), 'Arrêter → arreter()');
  assert.ok(CODE.includes('data-testid="record-finalisation"'), 'finalisation');
  assert.ok(CODE.includes('data-testid="record-ready"') && CODE.includes('data-testid="record-save"') && CODE.includes('data-testid="record-close"'), 'prêt / sauvegarder / fermer');
  assert.ok(CODE.includes("resultat.dejaEcrit ? 'Fichier enregistré' : 'Enregistrement prêt'"), 'déjà écrit vs prêt');
  assert.ok(CODE.includes('void resultat.sauvegarderSurAppareil()'), 'Enregistrer sur mon appareil');
  assert.ok(CODE.includes('data-testid="record-retry"'), 'erreur → Réessayer');
});

test('sécurité : aucun fetch/upload/stockage serveur dans l’UI d’enregistrement', () => {
  for (const f of [PANEL, TYPES, lire('lib', 'recordUi.ts')]) {
    assert.ok(!/fetch\(|axios|supabase|storage\.from|upload|XMLHttpRequest|\/api\//i.test(codeSeul(f)), 'aucun réseau');
  }
});

// ── Helpers purs (exécutés) ──────────────────────────────────────────────────
test('helpers : durée, taille, format, qualité par défaut (1080p desktop / 720p mobile), libellés', async () => {
  const { formatDureeRec, formatTaille, libelleFormat, qualiteParDefaut, libelleItemRecord, motifIndisponible, badgeVisible } = await import('./.build/recordUi.mjs');
  assert.equal(formatDureeRec(754), '00:12:34');
  assert.equal(formatDureeRec(3661), '01:01:01');
  assert.equal(formatTaille(0), '0 o');
  assert.equal(formatTaille(5 * 1024 * 1024), '5.0 Mo');
  assert.equal(formatTaille(2.5 * 1024 * 1024 * 1024), '2.50 Go');
  assert.equal(libelleFormat({ extension: 'mp4', codec: 'H.264/AAC', mime: 'video/mp4' }), 'MP4 (H.264/AAC)');
  assert.equal(libelleFormat({ extension: 'webm', codec: 'VP9/Opus', mime: 'video/webm' }), 'WebM (VP9/Opus)');
  assert.equal(qualiteParDefaut({ qualites: ['720p', '1080p'], mobile: false }), '1080p');
  assert.equal(qualiteParDefaut({ qualites: ['720p', '1080p'], mobile: true }), '720p');
  assert.equal(qualiteParDefaut({ qualites: ['720p'], mobile: false }), '720p');
  assert.equal(qualiteParDefaut({ qualites: [], mobile: false }), null);
  assert.equal(libelleItemRecord('inactif', 0), 'Enregistrer');
  assert.equal(libelleItemRecord('enregistrement', 754), 'Enregistrement 00:12:34');
  assert.equal(motifIndisponible({ supporte: true, mobile: true }), null);
  assert.equal(motifIndisponible({ supporte: false, mobile: true }), 'Enregistrement haute qualité disponible sur ordinateur');
  assert.equal(motifIndisponible({ supporte: false, mobile: false, motif: 'X' }), 'X');
  assert.equal(badgeVisible('enregistrement'), true);
  // Résolution + codec sur une seule ligne : « 1280 × 720 · H.264 + AAC » (ce qui est produit, jamais promis).
  const { libelleVideoResultat } = await import('./.build/recordUi.mjs');
  assert.equal(libelleVideoResultat('1280 × 720', 'H.264 + AAC'), '1280 × 720 · H.264 + AAC');
  assert.equal(libelleVideoResultat('1920 × 1080', ''), '1920 × 1080');
  for (const e of ['inactif', 'preparation', 'finalisation', 'pret', 'erreur']) assert.equal(badgeVisible(e), false, e);
});

// ── RÉSOLUTION AFFICHÉE (terrain 20/09) : le panneau montre resultat.resolution, mesuré sur la piste encodée ──
test('panneau prêt : la résolution vient de resultat.resolution (piste encodée), avec le codec, sous data-testid=record-resolution', () => {
  assert.ok(CODE.includes('data-testid="record-resolution"'), 'testid de preuve');
  assert.ok(CODE.includes('libelleVideoResultat(resultat.resolution, resultat.format)'), 'une ligne « résolution · codec »');
  assert.ok(!CODE.includes('recorder.qualite}</dd>') && !CODE.includes("qualite === '1080p' ? '1920"), 'jamais déduite de la qualité choisie');
});

/* ═══════════ ACCÈS DIRECT À L'ENREGISTREMENT DEPUIS LA VISIO (23/09/2026) ═══════════
   L'action existait déjà, mais seulement dans le menu ⋮ : trois gestes pendant un
   direct. On la remonte dans la barre ronde. Ces bancs verrouillent la seule chose qui
   compte : c'est la MÊME action et le MÊME état — pas un second enregistreur. */

test('le bouton direct appelle l’action EXISTANTE, et ne crée aucun second moteur', () => {
  const code = codeSeul(VISIO);
  assert.ok(code.includes('data-testid="visio-record-direct"'), 'le bouton existe');
  // Un seul déclencheur possible : la prop déjà utilisée par l'item du menu.
  assert.ok(code.includes('onClick={recordSupporte ? onToggleRecord : undefined}'));
  // Aucun état local d'enregistrement n'est introduit dans le panneau.
  assert.ok(!/useState[^\n]*record/i.test(code), 'pas de nouvel état d’enregistrement');
  assert.ok(!/MediaRecorder|useProgramRecorder|useSessionRecorder/.test(code),
    'le panneau n’enregistre rien lui-même');
  // L'item du menu ⋮ reste en place : on ajoute une porte, on n'en ferme aucune.
  assert.ok(code.includes("testId: 'visio-record'"), 'l’entrée du menu ⋮ est conservée');
});

test('réservé à l’hôte : un spectateur ne voit pas le bouton', () => {
  const code = codeSeul(VISIO);
  const i = code.indexOf('data-testid="visio-record-direct"');
  const bloc = code.slice(Math.max(0, i - 1800), i);
  assert.ok(/\{canManageStage && onToggleRecord && \(/.test(bloc),
    'le rendu est gardé par canManageStage');
});

test('l’état actif ne tient pas qu’à la couleur (accessibilité)', () => {
  const code = codeSeul(VISIO);
  const i = code.indexOf('data-testid="visio-record-direct"');
  const bloc = code.slice(i - 1400, i + 1400);
  assert.ok(/aria-pressed=\{recordEtat === 'enregistrement'\}/.test(bloc), 'aria-pressed');
  assert.ok(/aria-label=/.test(bloc), 'aria-label explicite');
  assert.ok(/formatDureeRec\(recordDureeSec\)/.test(bloc), 'la durée est annoncée');
  assert.ok(/animate-pulse/.test(bloc), 'un repère visuel non chromatique');
  assert.ok(/aria-disabled=\{!recordSupporte\}/.test(bloc), 'l’indisponibilité est dite');
});
