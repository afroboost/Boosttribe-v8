/**
 * 💬 CHAT LIVE TRANSPARENT — les règles pures, sans React ni navigateur.
 *
 * IL N'Y A PAS DE SERVEUR DE CHAT. Un commentaire part en broadcast Supabase Realtime
 * (événement 'CHAT_GROUP', cf. SessionPage) et arrive tel quel chez les autres. La
 * seule protection contre le flood est donc ICI, côté client (`limiteurChat`), plus
 * les limites natives de Realtime (débit par canal). Un client modifié peut la
 * contourner : c'est un frein d'usage, pas une barrière de sécurité.
 */

export const LONGUEUR_MAX = 300;

/** Forme minimale lue par l'overlay — compatible avec `ChatMessage` de ChatPanel. */
export interface MessageLive {
  id: string;
  userId: string;
  name: string;
  photoUrl?: string | null;
  text: string;
  ts: number;
  question?: boolean;
}

/** Les `n` derniers messages, dans l'ordre d'arrivée. Ne modifie pas la liste. */
export function derniersMessages<T>(messages: readonly T[] | null | undefined, n: number): T[] {
  if (!messages || !messages.length || !(n > 0)) return [];
  return messages.slice(-Math.floor(n));
}

/** Trim, espaces/retours multiples → un espace, tronqué à 300 caractères. */
export function normaliserTexte(t: string | null | undefined): string {
  if (!t) return '';
  return String(t).replace(/\s+/g, ' ').trim().slice(0, LONGUEUR_MAX);
}

/** « Marie Curie » → « MC » ; vide → « ? ». Deux lettres au plus. */
export function initiales(nom: string | null | undefined): string {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return '?';
  return mots.slice(0, 2).map((m) => Array.from(m)[0].toUpperCase()).join('');
}

export interface OptionsLimiteur {
  /** Écart minimal entre deux messages (défaut 1 200 ms). */
  intervalleMinMs?: number;
  /** Nombre maximal de messages dans la fenêtre glissante (défaut 6). */
  maxParFenetre?: number;
  /** Largeur de la fenêtre glissante (défaut 15 000 ms). */
  fenetreMs?: number;
}

export type ResultatLimiteur = { ok: true } | { ok: false; attendreMs: number };

/**
 * 1 message / 1,2 s ET 6 messages / 15 s glissantes. Un refus ne consomme rien :
 * seul un envoi accepté entre dans l'historique.
 */
export function limiteurChat(opts: OptionsLimiteur = {}) {
  const intervalle = opts.intervalleMinMs ?? 1200;
  const max = opts.maxParFenetre ?? 6;
  const fenetre = opts.fenetreMs ?? 15000;
  let envois: number[] = [];

  return {
    essayer(maintenantMs: number): ResultatLimiteur {
      envois = envois.filter((t) => maintenantMs - t < fenetre);
      const dernier = envois[envois.length - 1];
      if (dernier !== undefined && maintenantMs - dernier < intervalle) {
        return { ok: false, attendreMs: intervalle - (maintenantMs - dernier) };
      }
      if (envois.length >= max) {
        return { ok: false, attendreMs: fenetre - (maintenantMs - envois[0]) };
      }
      envois.push(maintenantMs);
      return { ok: true };
    },
  };
}

/**
 * 🪪 05/10 — Un INVITÉ IDENTIFIÉ du Live Afroboost : entré sans compte plateforme, mais avec un
 * pseudo (et son e-mail / WhatsApp, gardés côté serveur — « Bon retour », cookie HttpOnly).
 * Ce n'est PAS un anonyme : il a passé l'écran d'identité. L'écran d'identité encore ouvert
 * (formulaire ou « Bon retour » en attente) = pas encore identifié.
 * boosttribe.pro, hôte, compte connecté : jamais « invité identifié » (règles existantes).
 */
export function inviteLiveIdentifie(p: {
  marque: string; estHote: boolean; connecte: boolean;
  pseudo: string | null | undefined; ecranIdentiteOuvert: boolean;
}): boolean {
  return p.marque === 'afroboost' && !p.estHote && !p.connecte && !p.ecranIdentiteOuvert
    && String(p.pseudo || '').trim().length >= 2;
}

/**
 * 💬 05/10 — Qui peut ÉCRIRE et LIRE le chat du Live ? (même règle à l'envoi et à la réception)
 * Avant : `isPro` SEUL (crédits / abonnement / admin). L'invité identifié d'un Live Afroboost n'a
 * jamais de compte, donc jamais `isPro` : son champ était désactivé (« réservés aux membres Pro »),
 * l'envoi sortait en silence (`if (!isPro) return`) et il ne recevait aucun message. Un Live ne
 * doit JAMAIS exiger un compte plateforme pour discuter : invité identifié = autorisé.
 */
export function droitChatLive(p: { estPro: boolean; inviteIdentifie: boolean; membreAfroboost?: boolean }): boolean {
  return p.estPro || p.inviteIdentifie || !!p.membreAfroboost;
}

/**
 * 🔗 06/10 — Bug terrain : l'abonné ou le coach qui entre dans un Live Afroboost par le PONT
 * (`/api/embed/verify`) reçoit un compte BoostTribe → `connecte = true` → jamais « invité
 * identifié » ; et ce compte n'a aucun crédit BoostTribe → jamais `isPro`. Résultat : champ de
 * chat bloqué pour lui, et un coach hôte non admin ne recevait AUCUN message. Dans un Live
 * Afroboost, un compte avec un pseudo validé (hôte compris) discute comme l'invité identifié.
 * boosttribe.pro : inchangé (le chat reste un avantage Pro).
 */
export function membreLiveAfroboost(p: {
  marque: string; connecte: boolean; pseudo: string | null | undefined; ecranIdentiteOuvert: boolean;
}): boolean {
  return p.marque === 'afroboost' && p.connecte && !p.ecranIdentiteOuvert
    && String(p.pseudo || '').trim().length >= 2;
}

/** Message SORTANT du chat de groupe (extraction de handleSendGroupMessage) ; null = rien ne part. */
export function messageChatSortant(p: {
  peutChatter: boolean; userId: string; pseudo: string | null | undefined; photoUrl?: string | null;
  texte: string; question?: boolean; ts: number; id: string;
}): MessageLive | null {
  const texte = String(p.texte || '').trim();
  if (!p.peutChatter || !texte) return null;
  return { id: p.id, userId: p.userId, name: p.pseudo || 'Invité', photoUrl: p.photoUrl || null, text: texte, ts: p.ts,
    ...(p.question ? { question: true } : {}) };
}

/** Message REÇU par le canal du Live : accepté ? (extraction de la réception CHAT_GROUP). */
export function accepterMessageChatRecu(p: {
  peutChatter: boolean; monId: string | null | undefined;
  message: { id?: string; text?: string; userId?: string } | null | undefined;
}): boolean {
  const m = p.message;
  if (!p.peutChatter || !m || !m.id || !m.text) return false;
  return m.userId !== p.monId;
}
