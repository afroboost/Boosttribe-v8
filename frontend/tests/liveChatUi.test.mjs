/**
 * 💬 CHAT LIVE TRANSPARENT — bancs STRUCTURELS des deux composants.
 *
 * Ce qui est demandé est une forme : des messages POSÉS sur la vidéo (pas de carte
 * opaque), qui ne volent aucun clic, annoncés sans bavardage aux lecteurs d'écran,
 * sans animation pour qui l'a refusée — et un champ qui ne fait pas zoomer iOS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const OVERLAY = codeSeul(lire('components', 'session', 'LiveChatOverlay.tsx'));
const INPUT = codeSeul(lire('components', 'session', 'LiveCommentInput.tsx'));

test('overlay : aucune carte opaque', () => {
  assert.ok(!/bg-\[rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0?\.(9|8|7|6|5)/.test(OVERLAY), 'pas de fond rgba opaque');
  assert.ok(!/bg-black\/([4-9]\d|100)\b/.test(OVERLAY), 'pas de bg-black/40+');
  assert.ok(!/bg-(zinc|neutral|gray|slate|stone)-\d{3}\b(?!\/)/.test(OVERLAY), 'pas de fond gris plein');
  assert.ok(!/rounded-(xl|2xl)[^"']*\bp-[3-9]/.test(OVERLAY), 'pas de carte par message');
});

test('overlay : lisibilité par text-shadow', () => {
  assert.ok(OVERLAY.includes('0 1px 2px rgba(0,0,0,.9)'));
});

test('overlay : pointer-events-none, aria-live polite sur un annonceur caché', () => {
  assert.ok(OVERLAY.includes('pointer-events-none'));
  assert.ok(OVERLAY.includes('aria-live="polite"'));
  assert.ok(OVERLAY.includes('sr-only'));
});

test('overlay : seuls les N derniers, 6 par défaut', () => {
  assert.ok(OVERLAY.includes('derniersMessages('));
  assert.ok(/maxVisibles = 6/.test(OVERLAY));
});

test('overlay : animation désactivée si prefers-reduced-motion', () => {
  assert.ok(OVERLAY.includes('motion-safe:animate-in'));
  assert.ok(!/(?<!motion-safe:)\banimate-in\b/.test(OVERLAY), 'toute animation est sous motion-safe');
});

test('overlay : le haut s estompe (mask-image)', () => {
  assert.ok(/maskImage/.test(OVERLAY));
});

test('overlay : masques → rien de visible, sans démonter', () => {
  assert.ok(/masques/.test(OVERLAY));
  assert.ok(OVERLAY.includes('invisible'));
});

test('overlay : badges Hôte et Question, 3 lignes max', () => {
  assert.ok(OVERLAY.includes('Hôte'));
  assert.ok(OVERLAY.includes('Question'));
  assert.ok(OVERLAY.includes('line-clamp-3'));
});

test('aucune couleur codée en dur dans les deux composants', () => {
  for (const [nom, src] of [['overlay', OVERLAY], ['input', INPUT]]) {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), `${nom} : pas d hex`);
    assert.ok(!/\b(pink|fuchsia|purple|violet|rose|indigo|blue|red|green)-\d{3}\b/.test(src), `${nom} : pas de palette tailwind colorée`);
  }
});

test('input : pas de position fixed, police ≥ 16 px, maxLength 300, enterKeyHint', () => {
  assert.ok(!/\bfixed\b/.test(INPUT), 'jamais fixed (clavier mobile)');
  assert.ok(INPUT.includes('text-base'), '16 px : pas de zoom iOS');
  assert.ok(INPUT.includes('maxLength={LONGUEUR_MAX}'));
  assert.ok(INPUT.includes('enterKeyHint="send"'));
});

test('input : limiteur client, refus discret, Échap retire le focus', () => {
  assert.ok(INPUT.includes('limiteurChat('));
  assert.ok(INPUT.includes('Doucement'));
  assert.ok(INPUT.includes("'Escape'"));
  assert.ok(INPUT.includes('.blur()'));
});

test('input : bascule Question accessible, envoi nommé', () => {
  assert.ok(INPUT.includes('aria-pressed={question}'));
  assert.ok(INPUT.includes('peutPoserQuestion'));
  assert.ok(/aria-label="Envoyer/.test(INPUT));
  assert.ok(INPUT.includes('slotDroite'));
});
