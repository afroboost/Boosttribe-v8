/**
 * 🎙️ 06/10 — « ÉCHANGER EN VISIO » : la voix du participant à l'écran devient UNE suggestion chez l'hôte.
 *  Règles PURES exécutées avec de vraies entrées + contrôles de source (branchement de la page) :
 *  - seule la voix du PARTICIPANT ciblé est écoutée, jamais celle de l'hôte, jamais sans avis affiché ;
 *  - le flux PeerJS n'est jamais modifié : on transcrit une COPIE (`clone()`), arrêtée seule ;
 *  - aucun micro supplémentaire ; rien n'est envoyé au participant ; le chat garde son chemin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cibleVoix, voixATranscrire, transcriptionAutorisee, segmentDepuisEvenement, creerChrono, latenceMoyenne,
  MSG_AVIS_VOIX, MSG_AVIS_VOIX_VU, TEXTE_AVIS_VOIX, lireMessageVoix, accuseValide, avisDeLHote, accuseFrais, avisEncoreActif,
  ACCUSE_MAX_MS, AVIS_EXPIRE_MS, BATTEMENT_AVIS_MS,
} from './.build/transcriptionVisio.mjs';
import { ETAT_INITIAL, recevoirTranscription, estQuestionPertinente } from './.build/prompteurSources.mjs';
import { questionAPreparer } from './.build/assistantHote.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));
const HOOK = codeSeul(lire('hooks', 'useTranscriptionVisio.ts'));
const LIB = codeSeul(lire('lib', 'transcriptionVisio.ts'));
const PEER = lire('hooks', 'usePeerAudio.ts');
const piste = (etat = 'live') => ({ readyState: etat });
const voix = (userId, etat = 'live') => ({ peerId: `p-${userId}`, userId, stream: { getAudioTracks: () => [piste(etat)] } });

test('cible : hôte + IA allumée + « Échanger en visio » + quelqu’un à l’écran — sinon personne', () => {
  const base = { estHote: true, assistantActif: true, mode: 'visio', inviteId: 'u_amina', moi: 'u_hote' };
  assert.equal(cibleVoix(base), 'u_amina');
  assert.equal(cibleVoix({ ...base, mode: 'chat' }), null, 'mode chat : aucune écoute');
  assert.equal(cibleVoix({ ...base, assistantActif: false }), null, 'IA éteinte : aucune écoute');
  assert.equal(cibleVoix({ ...base, estHote: false }), null, 'un participant n’écoute jamais personne');
  assert.equal(cibleVoix({ ...base, inviteId: null }), null);
  assert.equal(cibleVoix({ ...base, inviteId: 'u_hote' }), null, 'jamais la voix de l’hôte');
});

test('voix à transcrire : celle de la cible seulement, vivante ; jamais l’hôte', () => {
  const liste = [voix('u_bob'), voix('u_amina'), voix('u_hote')];
  assert.equal(voixATranscrire(liste, 'u_amina', 'u_hote').userId, 'u_amina');
  assert.equal(voixATranscrire(liste, 'u_hote', 'u_hote'), null);
  assert.equal(voixATranscrire([voix('u_amina', 'ended')], 'u_amina', 'u_hote'), null, 'piste terminée : rien');
  assert.equal(voixATranscrire([], 'u_amina', 'u_hote'), null, 'pas encore la parole : rien');
});

test('aucune écoute avant que l’avis soit AFFICHÉ sur l’appareil de la voix écoutée', () => {
  assert.equal(transcriptionAutorisee({ cible: 'u_amina', voixPeerId: 'p-amina', avisVuPar: null }), false);
  assert.equal(transcriptionAutorisee({ cible: 'u_amina', voixPeerId: 'p-amina', avisVuPar: 'p-bob' }), false, 'l’accusé d’un autre appareil ne vaut rien');
  assert.equal(transcriptionAutorisee({ cible: 'u_amina', voixPeerId: null, avisVuPar: 'p-amina' }), false, 'pas de voix : rien');
  assert.equal(transcriptionAutorisee({ cible: 'u_amina', voixPeerId: 'p-amina', avisVuPar: 'p-amina' }), true);
  assert.match(TEXTE_AVIS_VOIX, /transcription de ta voix aide le coach à te répondre/);
  assert.match(TEXTE_AVIS_VOIX, /Rien n’est enregistré/);
});

test('🔐 FAUX ACCUSÉ : seul l’appareil dont la voix est transcrite peut déclencher l’écoute', () => {
  assert.equal(accuseValide({ dePeerId: 'p-amina', voixPeerId: 'p-amina' }), true);
  assert.equal(accuseValide({ dePeerId: 'p-pirate', voixPeerId: 'p-amina' }), false, 'un autre participant');
  assert.equal(accuseValide({ dePeerId: 'p-amina', voixPeerId: null }), false, 'personne n’est écouté');
  assert.equal(accuseValide({ dePeerId: '', voixPeerId: '' }), false);
  assert.equal(accuseFrais(0, 10_000), false, 'jamais d’accusé : pas d’écoute');
  assert.equal(accuseFrais(1_000, 1_000 + ACCUSE_MAX_MS), true);
  assert.equal(accuseFrais(1_000, 1_001 + ACCUSE_MAX_MS), false, 'accusé périmé : l’écoute s’arrête');
});

test('🔐 AVIS MASQUÉ : seul l’hôte peut retirer l’avis ; il ne se retire seul qu’APRÈS l’arrêt de l’écoute', () => {
  assert.equal(avisDeLHote({ dePeerId: 'p-hote', hotePeerId: 'p-hote' }), true);
  assert.equal(avisDeLHote({ dePeerId: 'p-pirate', hotePeerId: 'p-hote' }), false, 'un tiers ne peut pas masquer l’avis');
  assert.equal(avisDeLHote({ dePeerId: 'p-hote', hotePeerId: null }), false);
  assert.ok(BATTEMENT_AVIS_MS < ACCUSE_MAX_MS && ACCUSE_MAX_MS < AVIS_EXPIRE_MS,
    'battement < arrêt de l’écoute < retrait de l’avis : l’avis survit toujours à l’écoute');
  assert.equal(avisEncoreActif(1_000, 1_000 + AVIS_EXPIRE_MS), true);
  assert.equal(avisEncoreActif(1_000, 1_001 + AVIS_EXPIRE_MS), false);
  assert.deepEqual(lireMessageVoix({ t: MSG_AVIS_VOIX, actif: true }), { t: 'avis_voix', actif: true });
  assert.deepEqual(lireMessageVoix({ t: MSG_AVIS_VOIX, actif: 'oui' }), { t: 'avis_voix', actif: false });
  assert.deepEqual(lireMessageVoix({ t: MSG_AVIS_VOIX_VU }), { t: 'avis_voix_vu' });
  assert.equal(lireMessageVoix({ t: 'autre' }), null);
  assert.equal(lireMessageVoix('avis_voix'), null);
});

test('événements du fournisseur : seul le texte FINAL d’une phrase devient un segment', () => {
  assert.deepEqual(segmentDepuisEvenement({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1',
    transcript: '  Est-ce que je peux participer   si je suis débutant ? ' }),
  { id: 'item_1', texte: 'Est-ce que je peux participer si je suis débutant ?' });
  assert.equal(segmentDepuisEvenement({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_1', delta: 'Est' }), null);
  assert.equal(segmentDepuisEvenement({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_2', transcript: '   ' }), null);
  assert.equal(segmentDepuisEvenement(null), null);
});

test('latence = fin de parole → texte final, par phrase', () => {
  const c = creerChrono();
  assert.equal(c.evenement({ type: 'input_audio_buffer.speech_stopped', item_id: 'i1' }, 1000), null);
  assert.equal(c.evenement({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'x' }, 1850), 850);
  assert.equal(c.evenement({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i9', transcript: 'x' }, 1900), null);
  assert.equal(latenceMoyenne([850, 1150]), 1000);
  assert.equal(latenceMoyenne([]), null);
});

test('les deux phrases de Bassi entrent dans la file ; « merci » n’y entre pas', () => {
  let e = recevoirTranscription(ETAT_INITIAL, { id: 'item_1', auteur: 'Amina', texte: 'Est-ce que je peux participer si je suis débutant ?' });
  e = recevoirTranscription(e, { id: 'item_2', auteur: 'Amina', texte: 'J’ai peur de ne pas suivre.' });
  assert.deepEqual(e.file.map((q) => [q.id, q.auteur]), [['voix-item_1', 'Amina'], ['voix-item_2', 'Amina']]);
  assert.equal(recevoirTranscription(ETAT_INITIAL, { id: 'item_3', texte: 'Merci.' }), ETAT_INITIAL);
  assert.equal(recevoirTranscription(e, { id: 'item_1', texte: 'Est-ce que je peux participer si je suis débutant ?' }), e, 'même phrase = rien');
  const q = questionAPreparer({ file: e.file, dejaDemandees: new Set(), suggestionEnAttente: false, actif: true, enCours: false,
    pertinente: estQuestionPertinente, maintenant: Date.now() });
  assert.equal(q && q.id, 'voix-item_1', 'UNE demande à la fois, la première phrase d’abord');
});

test('flux PeerJS intact : COPIE de la piste, seule la copie est arrêtée ; aucun micro demandé', () => {
  assert.match(HOOK, /const copie = piste\.clone\(\);/);
  assert.match(HOOK, /copie\.stop\(\)/);
  assert.doesNotMatch(HOOK, /piste\.stop\(\)|\.enabled\s*=|getUserMedia/);
  assert.doesNotMatch(LIB, /getUserMedia|\.enabled\s*=/);
  assert.match(PAGE, /voixATranscrire\(getTribeAudioStreams\(\), cibleEcoute, socket\.userId\)/);
  assert.doesNotMatch(PEER, /transcri/i, 'usePeerAudio ne transcrit rien');
  // Ajout DATA seulement : l'expéditeur vient de PeerJS (`dataConn.peer` / `hostId`), jamais du message.
  assert.match(PEER, /dataConn\.on\('data', \(d\) => \{ try \{ onMessageDonneesRef\.current\?\.\(dataConn\.peer, d\);/);
  assert.match(PEER, /dataConn\.on\('data', \(d\) => \{ try \{ onMessageDonneesRef\.current\?\.\(hostId, d\);/);
});

test('page : avis → accusé par le canal DATA PeerJS (jamais le broadcast) ; phrase dite en mode « voix »', () => {
  assert.doesNotMatch(PAGE, /'broadcast', \{ event: '?ASSISTANT_VOIX/, 'plus aucun avis/accusé par le broadcast non authentifié');
  assert.match(PAGE, /onMessageDonnees: \(de, m\) => voixDonneesRef\.current\(de, m\)/);
  assert.match(PAGE, /accuseValide\(\{ dePeerId: de, voixPeerId: voixPeerIdRef\.current \}\)/);
  assert.match(PAGE, /avisDeLHote\(\{ dePeerId: de, hotePeerId: peerState\.hostPeerId \}\)/);
  assert.match(PAGE, /envoyerDonnees\(vers, \{ t: MSG_AVIS_VOIX, actif: true \}\)/);
  assert.match(PAGE, /envoyerDonnees\('hote', \{ t: MSG_AVIS_VOIX_VU \}\)/);
  assert.match(PAGE, /actif: transcriptionAutorisee\(\{ cible: cibleEcoute, voixPeerId, avisVuPar: avisVoixVuPar \}\)/);
  assert.match(PAGE, /if \(cible && cible\.id\.startsWith\('voix-'\)\) \{\s*void demanderIA\(\{ session_id: sessionId, mode: 'voix', messages: \[\]/);
  assert.match(PAGE, /void demanderIA\(\{ session_id: sessionId, mode: assistantMode, messages: contexte,/, 'chemin du chat inchangé');
  assert.match(PAGE, /<AvisVoixParticipant visible=\{avisVoixVisible && !canShare\}/);
  assert.doesNotMatch(PAGE, /sendPlaybackEvent\('CHAT_GROUP'[^)]*voix/i, 'aucune réplique envoyée au chat');
});
