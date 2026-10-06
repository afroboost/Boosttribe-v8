/**
 * 🛡️ 05/10 — INVITÉ IDENTIFIÉ DU LIVE (pseudo + e-mail / WhatsApp, sans compte plateforme) :
 *   A/B chat envoyé ET reçu chez l'hôte ; C/D/E/F une question → UNE suggestion IA, chez l'hôte seul ;
 *   G/I « Faire la promo » sans reconnexion ni 2e saisie ; J session invité expirée → refus +
 *   réidentification ; K « Échanger en visio » (IA) n'est pas présenté comme opérationnel.
 * Règles PURES exécutées avec de vraies entrées ; contrôles de source = branchement de la page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteLiveIdentifie, membreLiveAfroboost, droitChatLive, messageChatSortant, accepterMessageChatRecu } from './.build/liveChat.mjs';
import { actionPromoParticipant } from './.build/livePromo.mjs';
import { questionAPreparer, modeAutomatique, VISIO_IA_DISPONIBLE } from './.build/assistantHote.mjs';
import { ETAT_INITIAL, recevoirMessages, estQuestionPertinente, recevoirSuggestionAuto, utiliserSuggestion, ignorerSuggestion } from './.build/prompteurSources.mjs';
import { creerFournisseurJetonInvite } from './.build/inviteLive.mjs';
import { lire, codeSeul } from './lireSource.mjs';

const PAGE = codeSeul(lire('pages', 'SessionPage.tsx'));
const INVITE_TEST = { marque: 'afroboost', estHote: false, connecte: false, pseudo: 'Test', ecranIdentiteOuvert: false };

test('invité identifié : Afroboost, sans compte, pseudo donné, écran d’identité refermé', () => {
  assert.equal(inviteLiveIdentifie(INVITE_TEST), true);
  assert.equal(inviteLiveIdentifie({ ...INVITE_TEST, pseudo: '' }), false);                  // anonyme : rien saisi
  assert.equal(inviteLiveIdentifie({ ...INVITE_TEST, ecranIdentiteOuvert: true }), false);   // formulaire / Bon retour encore ouvert
  assert.equal(inviteLiveIdentifie({ ...INVITE_TEST, connecte: true }), false);              // compte : règles du compte
  assert.equal(inviteLiveIdentifie({ ...INVITE_TEST, estHote: true }), false);
  assert.equal(inviteLiveIdentifie({ ...INVITE_TEST, marque: 'boosttribe' }), false);        // boosttribe.pro : inchangé
});

/* ═══ 06/10 — bug terrain : le participant arrivé par le PONT Afroboost a un compte (embed/verify) ═══ */
const MEMBRE_PONT = { marque: 'afroboost', connecte: true, pseudo: 'Amina', ecranIdentiteOuvert: false };
test('membre connecté par le pont Afroboost (0 crédit) : peut discuter dans un Live Afroboost', () => {
  assert.equal(membreLiveAfroboost(MEMBRE_PONT), true);
  assert.equal(droitChatLive({ estPro: false, inviteIdentifie: false, membreAfroboost: membreLiveAfroboost(MEMBRE_PONT) }), true);
  assert.equal(membreLiveAfroboost({ ...MEMBRE_PONT, ecranIdentiteOuvert: true }), false);  // pseudo pas encore validé
  assert.equal(membreLiveAfroboost({ ...MEMBRE_PONT, pseudo: '' }), false);
  assert.equal(membreLiveAfroboost({ ...MEMBRE_PONT, connecte: false }), false);             // sans compte : règle invité
  assert.equal(membreLiveAfroboost({ ...MEMBRE_PONT, marque: 'boosttribe' }), false);        // boosttribe.pro : gate Pro inchangé
});
test('coach hôte NON admin et sans crédit d’un Live Afroboost : reçoit le message de l’invité', () => {
  const peutChatterHote = droitChatLive({ estPro: false, inviteIdentifie: false,
    membreAfroboost: membreLiveAfroboost({ marque: 'afroboost', connecte: true, pseudo: 'Coach Léa', ecranIdentiteOuvert: false }) });
  assert.equal(accepterMessageChatRecu({ peutChatter: peutChatterHote, monId: 'hote',
    message: { id: 'invite-1', text: 'Bonjour', userId: 'invite' } }), true);
});
test('page : la règle « membre Afroboost » est branchée sur peutChatter', () => {
  assert.match(PAGE, /const membreAfroboost = membreLiveAfroboost\(\{/);
  assert.match(PAGE, /droitChatLive\(\{ estPro: isPro, inviteIdentifie, membreAfroboost \}\)/);
});

/* ═══ A + B : le message de l'invité part, et l'hôte le reçoit ═══ */
test('A — un invité identifié (non Pro) peut ÉCRIRE dans le chat ; un anonyme non Pro, non', () => {
  assert.equal(droitChatLive({ estPro: false, inviteIdentifie: true }), true);
  assert.equal(droitChatLive({ estPro: false, inviteIdentifie: false }), false);
  assert.equal(droitChatLive({ estPro: true, inviteIdentifie: false }), true);
  const m = messageChatSortant({ peutChatter: droitChatLive({ estPro: false, inviteIdentifie: inviteLiveIdentifie(INVITE_TEST) }),
    userId: 'user_invite', pseudo: 'Test', photoUrl: null, texte: '  Bonjour coach  ', ts: 1, id: 'user_invite-1-a' });
  assert.ok(m, 'le message de l’invité identifié doit partir');
  assert.equal(m.text, 'Bonjour coach');
  assert.equal(m.name, 'Test');
  assert.equal('email' in m || 'whatsapp' in m, false);                                     // jamais une coordonnée dans le chat
  assert.equal(messageChatSortant({ peutChatter: false, userId: 'x', pseudo: 'X', texte: 'a', ts: 1, id: 'x-1' }), null);
});

test('B — l’hôte REÇOIT le message de l’invité ; l’invité reçoit aussi les messages des autres', () => {
  const m = messageChatSortant({ peutChatter: true, userId: 'user_invite', pseudo: 'Test', texte: 'Coucou', ts: 1, id: 'user_invite-1-a' });
  assert.equal(accepterMessageChatRecu({ peutChatter: true, monId: 'user_hote', message: m }), true);   // chez l'hôte
  assert.equal(accepterMessageChatRecu({ peutChatter: droitChatLive({ estPro: false, inviteIdentifie: true }), monId: 'user_invite',
    message: { ...m, id: 'h-1', userId: 'user_hote' } }), true);                                       // chez l'invité
  assert.equal(accepterMessageChatRecu({ peutChatter: true, monId: 'user_invite', message: m }), false); // écho de soi-même
  assert.equal(accepterMessageChatRecu({ peutChatter: true, monId: 'h', message: { id: '', text: 'x', userId: 'a' } }), false);
});

test('A/B branchement : la page envoie et reçoit avec CES règles (plus `isPro` seul)', () => {
  assert.match(PAGE, /const peutChatter = droitChatLive\(\{ estPro: isPro, inviteIdentifie, membreAfroboost \}\);/);
  assert.match(PAGE, /const inviteIdentifie = inviteLiveIdentifie\(\{/);
  assert.match(PAGE, /messageChatSortant\(\{ peutChatter,/);
  assert.match(PAGE, /accepterMessageChatRecu\(\{ peutChatter: peutChatterRef\.current,/);
  assert.match(PAGE, /desactive=\{!peutChatter\}/);
  assert.doesNotMatch(PAGE, /if \(!isPro \|\| !text\.trim\(\)\) return;/);
  assert.doesNotMatch(PAGE, /if \(!isProRef\.current \|\| !payload\.payload\) return;/);
});

/* ═══ C + D + E + F : question de l'invité → UNE suggestion, chez l'hôte seul ═══ */
test('C — « Est-ce que je peux participer si je débute ? » de l’invité → UNE seule demande d’IA', () => {
  const texte = 'Est-ce que je peux participer si je débute ?';
  const m = messageChatSortant({ peutChatter: true, userId: 'user_invite', pseudo: 'Test', texte, ts: 5, id: 'user_invite-5-q' });
  assert.ok(accepterMessageChatRecu({ peutChatter: true, monId: 'user_hote', message: m }));
  let etat = recevoirMessages(ETAT_INITIAL, [m], 'user_hote');
  etat = recevoirMessages(etat, [m, m], 'user_hote');                                // double réception : rien de plus
  assert.equal(etat.file.length, 1);
  assert.equal(etat.file[0].auteur, 'Test');
  const deja = new Set();
  const q = questionAPreparer({ file: etat.file, dejaDemandees: deja, suggestionEnAttente: false, actif: true, enCours: false,
    pertinente: estQuestionPertinente, maintenant: 10_000 });
  assert.ok(q && q.id === 'user_invite-5-q');
  deja.add(q.id);
  assert.equal(questionAPreparer({ file: etat.file, dejaDemandees: deja, suggestionEnAttente: false, actif: true, enCours: false,
    pertinente: estQuestionPertinente, maintenant: 20_000 }), null);                 // même message_id : jamais 2 appels
  // D/E/F : la suggestion vit dans l'état du PROMPTEUR DE L'HÔTE ; Utiliser → « Mon texte » ; Ignorer → supprimée.
  const avec = recevoirSuggestionAuto(etat, 'Oui ! Viens, tout est adapté aux débutants.', q);
  assert.equal(avec.suggestion, 'Oui ! Viens, tout est adapté aux débutants.');
  assert.match(utiliserSuggestion(avec).brouillon, /débutants/);
  assert.equal(ignorerSuggestion(avec).suggestion, null);
});

test('D branchement : l’IA reste chez l’hôte (canShare) et n’écrit jamais dans le chat', () => {
  assert.match(PAGE, /const assistantNode: React\.ReactNode = canShare \? \(/);
  assert.match(PAGE, /setEtatPrompteur\(\(e\) => recevoirMessages\(e, groupMessages, socket\.userId\)\);/);
  assert.doesNotMatch(PAGE, /sendPlaybackEvent\('CHAT_GROUP', [^)]*suggestion/);
});

/* ═══ G + I : « Faire la promo » pour l'invité identifié ═══ */
test('G — invité IDENTIFIÉ → la fenêtre promo s’ouvre (plus d’écran de connexion) ; anonyme → connexion', () => {
  const ouverte = { enabled: true, offres: [{ id: 'a' }] };
  assert.equal(actionPromoParticipant({ estProprietaire: false, connecte: false, inviteIdentifie: true, config: ouverte }), 'ouvrir');
  assert.equal(actionPromoParticipant({ estProprietaire: false, connecte: false, inviteIdentifie: false, config: ouverte }), 'connexion');
  assert.equal(actionPromoParticipant({ estProprietaire: true, connecte: false, inviteIdentifie: true, config: ouverte }), null);
  assert.equal(actionPromoParticipant({ estProprietaire: false, connecte: false, inviteIdentifie: true, config: { enabled: false, offres: [] } }), null);
});

test('G/I branchement : la page passe l’identité invité et réutilise SA session (jeton serveur)', () => {
  assert.match(PAGE, /actionPromoParticipant\(\{ estProprietaire: estProprietaireSession, connecte: !!user, inviteIdentifie, config: livePromo\.config \}\)/);
  assert.match(PAGE, /definirSessionInvitePromo\(creerFournisseurJetonInvite\(sessionId\)\)/);
  assert.match(PAGE, /onSessionExpiree=\{/);
});

/* ═══ J : session invité — le jeton vient du SERVEUR (cookie HttpOnly), jamais d'un e-mail du front ═══ */
test('J — jeton invité : demandé avec le cookie, mis en cache, refusé (401) = null → réidentification', async () => {
  const appels = [];
  let statut = 200;
  const faux = async (url, init) => {
    appels.push({ url, init });
    return { ok: statut === 200, status: statut, json: async () => ({ jeton: `j${appels.length}`, expire_dans: 600 }) };
  };
  let t = 1_000_000;
  const f = creerFournisseurJetonInvite('ABCDEFGH-ABCDEF', faux, () => t);
  assert.equal(await f(), 'j1');
  assert.equal(await f(), 'j1');                                              // en cache
  assert.equal(appels.length, 1);
  assert.equal(appels[0].url, '/api/live-guest/jeton');
  assert.equal(appels[0].init.credentials, 'same-origin');                    // le cookie HttpOnly part, rien d'autre
  const corps = JSON.parse(appels[0].init.body);
  assert.deepEqual(Object.keys(corps), ['session_code']);                    // ni e-mail, ni WhatsApp, ni pseudo
  t += 9 * 60_000 + 1;                                                        // proche de l'expiration → renouvelé
  assert.equal(await f(), 'j2');
  statut = 401; t += 10 * 60_000;
  assert.equal(await f(), null);                                              // session expirée / révoquée
  assert.equal(await creerFournisseurJetonInvite('', faux, () => t)(), null);
});

/* ═══ K : « Échanger en visio » — mode de l'IA qui n'entend pas la voix ═══ */
test('K — « visio » écoute la voix : disponible (06/10), mais JAMAIS activé d’elle-même par l’IA', () => {
  assert.equal(VISIO_IA_DISPONIBLE, true);
  assert.equal(modeAutomatique('Julie'), 'chat');
  assert.equal(modeAutomatique(null), 'chat');
  const panneau = codeSeul(lire('components', 'session', 'AssistantHotePanel.tsx'));
  assert.match(panneau, /Transcription vocale bientôt disponible/);
  assert.match(panneau, /disabled=\{m === 'visio' && \(!VISIO_IA_DISPONIBLE \|\| !invite\)\}/);
});
