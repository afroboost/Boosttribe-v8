/**
 * Post-S0 (19/10/2026) — réglages de session écrits par le navigateur (is_private, média partagé,
 * description). Cause prouvée au banc infra/post-s0/banc_sessions.sh, schémas réels bt + live :
 * l'upsert (INSERT … ON CONFLICT DO UPDATE) sans host_id était REFUSÉ (42501) pour TOUS, hôte compris
 * (la ligne candidate doit être visible selon playlists_select). Correction : UPDATE ciblé + relecture.
 *  A. succès seulement si la base RELIT la valeur demandée (0 ligne / valeur neutralisée = échec) ;
 *  B. plus aucun upsert ni insert pour ces réglages : jamais de session créée ou revendiquée ici ;
 *  C. aucune colonne protégée S0 (host_id, mode, prix, co-hôtes, fin du Live…) dans ces écritures ;
 *  D. l'interface n'annonce la session privée qu'APRÈS confirmation, sinon elle revient en arrière.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ecritureSessionConfirmee } from './.build/accesSession.mjs';
import { lire, codeSeul } from './lireSource.mjs';

test('A. relecture : 0 ligne, erreur ou valeur différente = échec ; valeur relue identique = succès', () => {
  assert.equal(ecritureSessionConfirmee({ is_private: true }, []), false, 'RLS : aucune ligne modifiable');
  assert.equal(ecritureSessionConfirmee({ is_private: true }, null), false, 'erreur réseau / PostgREST');
  assert.equal(ecritureSessionConfirmee({ is_private: true }, [{ session_id: 'S', is_private: false }]), false, 'neutralisé par le verrou');
  assert.equal(ecritureSessionConfirmee({ is_private: true }, [{ session_id: 'S', is_private: true }]), true);
  assert.equal(ecritureSessionConfirmee({ is_private: false }, [{ session_id: 'S', is_private: false }]), true);
  assert.equal(ecritureSessionConfirmee({ description: 'x' }, [{ description: 'x' }, { description: 'y' }]), false, 'toutes les lignes');
});

test('A. média partagé : jsonb ne garde pas l’ordre des clés, le retrait (null) se confirme aussi', () => {
  const media = { url: 'https://exemple.invalid/v.mp4', type: 'video', isPlaying: false, currentTime: 0 };
  assert.equal(ecritureSessionConfirmee({ shared_media: media }, [{ shared_media: { currentTime: 0, isPlaying: false, type: 'video', url: media.url } }]), true);
  assert.equal(ecritureSessionConfirmee({ shared_media: media }, [{ shared_media: { ...media, url: 'autre' } }]), false);
  assert.equal(ecritureSessionConfirmee({ shared_media: null }, [{ shared_media: null }]), true);
  assert.equal(ecritureSessionConfirmee({ shared_media: null }, [{ shared_media: media }]), false);
});

test('A2. clés à undefined : absentes du JSON envoyé ET relu → ignorées à toute profondeur (plus de faux « non enregistré »)', () => {
  // Cas réel : SharedMedia construit avec des champs optionnels non renseignés (ex. startedAt, title).
  const envoye = { url: 'https://exemple.invalid/v.mp4', type: 'video', isPlaying: true, currentTime: 12, startedAt: undefined, title: undefined };
  const relu = JSON.parse(JSON.stringify(envoye));                    // ce que jsonb rend : clés undefined absentes
  assert.equal(Object.prototype.hasOwnProperty.call(relu, 'startedAt'), false);
  assert.equal(ecritureSessionConfirmee({ shared_media: envoye }, [{ shared_media: relu }]), true, 'niveau 1');
  const imbrique = { url: 'u', meta: { a: 1, b: undefined, c: { d: undefined, e: 'x' } }, pistes: [{ id: 1, x: undefined }] };
  assert.equal(ecritureSessionConfirmee({ shared_media: imbrique }, [{ shared_media: JSON.parse(JSON.stringify(imbrique)) }]), true, 'objets et tableaux imbriqués');
  // L'oubli n'excuse pas une vraie différence :
  assert.equal(ecritureSessionConfirmee({ shared_media: imbrique }, [{ shared_media: { url: 'u', meta: { a: 2, c: { e: 'x' } }, pistes: [{ id: 1 }] } }]), false, 'valeur réellement différente');
  assert.equal(ecritureSessionConfirmee({ shared_media: { url: 'u', b: undefined } }, [{ shared_media: { url: 'u', b: 'relu en plus' } }]), false, 'clé présente seulement à la relecture');
  // Tableau : undefined → null, comme JSON.stringify.
  assert.equal(ecritureSessionConfirmee({ shared_media: { l: [1, undefined] } }, [{ shared_media: { l: [1, null] } }]), true);
  assert.equal(ecritureSessionConfirmee({ shared_media: { l: [1, undefined] } }, [{ shared_media: { l: [1] } }]), false);
  // Colonne demandée à undefined : non envoyée → rien à confirmer → jamais un succès par défaut.
  assert.equal(ecritureSessionConfirmee({ description: undefined }, [{ description: 'ancienne' }]), false);
  assert.equal(ecritureSessionConfirmee({ description: 'x', shared_media: undefined }, [{ description: 'x', shared_media: { url: 'ancien' } }]), true, 'seule la colonne envoyée compte');
  // null reste une VALEUR (retrait du média), pas une absence.
  assert.equal(ecritureSessionConfirmee({ shared_media: { url: 'u', t: null } }, [{ shared_media: { url: 'u' } }]), false);
});

const client = codeSeul(lire('lib', 'supabaseClient.ts'));
const corps = (nom) => {
  const i = client.indexOf(`function ${nom}(`);
  assert.ok(i >= 0, `${nom} introuvable`);
  const j = client.indexOf('\nexport ', i + 1);
  return client.slice(i, j < 0 ? undefined : j);
};

test('B/C. description, média, confidentialité : UPDATE + relecture, ni upsert ni insert, aucune colonne protégée', () => {
  const ecrire = corps('ecrireReglageSession');
  assert.match(ecrire, /\.update\(/);
  assert.match(ecrire, /\.eq\('session_id', sessionId\)/);
  assert.match(ecrire, /\.select\(/, 'relecture RETURNING');
  assert.match(ecrire, /ecritureSessionConfirmee\(/);
  assert.doesNotMatch(ecrire, /\.upsert\(|\.insert\(/);
  for (const [nom, champ] of [['saveSessionDescription', 'description'], ['saveSharedMedia', 'shared_media'], ['saveSessionPrivacy', 'is_private']]) {
    const c = corps(nom);
    assert.match(c, /ecrireReglageSession\(/, `${nom} passe par l'écriture contrôlée`);
    assert.match(c, new RegExp(`\\{ ${champ}`), `${nom} n'écrit que ${champ}`);
    assert.doesNotMatch(c, /\.upsert\(|\.insert\(|host_id|cohosts|mode:|price_chf|live_ended_at|record_enabled/, `${nom} : rien de protégé`);
  }
});

test('D. session privée : annoncée seulement après confirmation, sinon retour arrière + message', () => {
  const page = codeSeul(lire('pages', 'SessionPage.tsx'));
  const i = page.indexOf('const handleTogglePrivacy');
  const bloc = page.slice(i, page.indexOf('}, [isPrivate, sessionId, showToast]);', i));
  assert.match(bloc, /await saveSessionPrivacy\(sessionId, next\)/);
  assert.match(bloc, /setIsPrivate\(!next\)/, 'retour arrière si refusé');
  assert.ok(bloc.indexOf("'error'") >= 0 && bloc.indexOf("'error'") < bloc.lastIndexOf('Session privée'), 'échec signalé avant tout message de succès');
});
