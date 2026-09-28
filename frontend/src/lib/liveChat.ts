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
