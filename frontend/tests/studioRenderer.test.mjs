/**
 * 🎬 Phase 2 mini studio — bancs STRUCTURELS du rendu de scène et du hook.
 *
 * Ce que l’on verrouille sans navigateur :
 *   - `SceneRenderer` est NU : aucun prompteur, chat, minuteur ni overlay n’y entre — c’est la
 *     maquette exacte du futur programStream, et le prompteur doit rester coach-only ;
 *   - une `<video>` muette par boîte, positionnée en %, cadre `data-studio-zone` ;
 *   - le rendu n’arrête jamais une piste (il détache seulement) ;
 *   - `useStudio` ne crée aucun flux : pas de getUserMedia / enumerateDevices, il lit
 *     `localStream` (piste déjà traitée par « Embellir »), les caméras secondaires, les
 *     participants et l’écran de l’existant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lire, codeSeul } from './lireSource.mjs';

const rendu = codeSeul(lire('components', 'session', 'SceneRenderer.tsx'));
const hook = codeSeul(lire('hooks', 'useStudio.ts'));

test('SceneRenderer : nu — ni prompteur, ni chat, ni minuteur, ni overlay', () => {
  for (const interdit of ['Prompteur', 'ChatPanel', 'chat', 'Timer', 'timer', 'Overlay', 'overlay', 'Interval']) {
    assert.ok(!rendu.includes(interdit), `« ${interdit} » ne doit pas apparaître dans SceneRenderer`);
  }
});
test('SceneRenderer : cadre data-studio-zone, une <video muted playsInline> par boîte, positions en %', () => {
  assert.ok(rendu.includes('data-studio-zone={zone}'));
  assert.ok(rendu.includes('data-studio-source={box.source.kind}'));
  assert.ok(rendu.includes('boxes.map((b) =>'));
  assert.ok(/<video[^>]*muted[^>]*playsInline[^>]*autoPlay/.test(rendu));
  assert.ok(rendu.includes('left: `${box.x * 100}%`') && rendu.includes('width: `${box.w * 100}%`'));
  assert.ok(rendu.includes('object-cover'));
});
test('SceneRenderer : détache au démontage, n’arrête jamais une piste', () => {
  assert.ok(rendu.includes('el.srcObject = null'));
  assert.ok(!rendu.includes('.stop()'), 'le rendu ne doit jamais arrêter une piste qui appartient à l’existant');
});
test('useStudio : aucun flux créé — pas de getUserMedia ni enumerateDevices ; lit l’existant', () => {
  assert.ok(!hook.includes('getUserMedia') && !hook.includes('enumerateDevices'));
  assert.ok(hook.includes("case 'coach': return o.localStream"));
  assert.ok(hook.includes("case 'coach2'") && hook.includes("case 'participant'") && hook.includes("case 'screen'"));
  assert.ok(hook.includes('useReducer(studioReducer, STUDIO_INITIAL)'));
});
test('useStudio : expose le contrat (preview / take / cut / setParticipant / setPip / clearPreview / boxes / resolveMedia)', () => {
  for (const nom of ['preview', 'take', 'cut', 'setParticipant', 'setPip', 'clearPreview', 'boxesPreview', 'boxesProgram', 'resolveMedia', 'scenes', 'sources']) {
    assert.ok(new RegExp(`\\b${nom}\\b`).test(hook), `useStudio doit exposer ${nom}`);
  }
});
