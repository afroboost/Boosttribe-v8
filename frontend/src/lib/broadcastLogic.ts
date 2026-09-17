/**
 * 📡 Multistream — LOGIQUE PURE du « Diffuser en direct » (aucun React, aucun réseau).
 *
 * Une destination = une plateforme sociale avec SON état, indépendant des autres :
 * une panne TikTok n'arrête ni Facebook, ni YouTube, ni Live Visio. Rien n'est jamais
 * présélectionné : c'est l'hôte qui coche.
 */

export type Plateforme = 'instagram' | 'facebook' | 'youtube' | 'tiktok';
export const PLATEFORMES: Plateforme[] = ['instagram', 'facebook', 'youtube', 'tiktok'];
export const LIBELLES: Record<Plateforme, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' };

/** Compte : connected / not_connected / reauth / unavailable ; diffusion : starting / live / error / off. */
export type StatutDestination = 'connected' | 'not_connected' | 'reauth' | 'unavailable' | 'starting' | 'live' | 'error' | 'off';

export interface Destination {
  platform: Plateforme;
  label: string;
  status: StatutDestination;
  selected: boolean;
  error?: string;
  /** État du COMPTE, conservé pendant la diffusion pour savoir où revenir à l'arrêt. */
  compte: 'connected' | 'not_connected' | 'reauth' | 'unavailable';
}

export interface EtatBroadcast {
  destinations: Destination[];
  live: boolean;
  demarreLe: number | null;   // epoch ms
}

export const BROADCAST_INITIAL: EtatBroadcast = {
  destinations: PLATEFORMES.map((p) => ({ platform: p, label: LIBELLES[p], status: 'unavailable', selected: false, compte: 'unavailable' })),
  live: false,
  demarreLe: null,
};

/** Statuts de compte renvoyés par le serveur (jamais de secret dedans). */
export type ComptesServeur = Partial<Record<Plateforme, 'connected' | 'not_connected' | 'reauth' | 'unavailable'>>;

/** Statuts de diffusion renvoyés par le serveur pendant un direct. */
export interface StatutServeur {
  live: boolean;
  elapsedSec: number;
  destinations: { platform: Plateforme; status: 'live' | 'error' | 'off' | 'starting'; error?: string }[];
}

export type ActionBroadcast =
  | { type: 'comptes'; comptes: ComptesServeur }
  | { type: 'select'; platform: Plateforme; on: boolean }
  | { type: 'start'; maintenant: number }
  | { type: 'statut'; statut: StatutServeur; maintenant: number }
  | { type: 'stop'; platform: Plateforme }
  | { type: 'stop_all' }
  | { type: 'retry'; platform: Plateforme }
  | { type: 'echec_demarrage'; platform: Plateforme; error: string };

const enDiffusion = (s: StatutDestination) => s === 'starting' || s === 'live' || s === 'error';

/** Une destination peut être cochée seulement si son compte est connecté. */
export function selectionnable(d: Destination): boolean { return d.compte === 'connected'; }

/** Celles qui partiront au clic « Démarrer le direct ». */
export function destinationsADemarrer(e: EtatBroadcast): Plateforme[] {
  return e.destinations.filter((d) => d.selected && selectionnable(d) && !enDiffusion(d.status)).map((d) => d.platform);
}

export function broadcastReducer(e: EtatBroadcast, a: ActionBroadcast): EtatBroadcast {
  switch (a.type) {
    case 'comptes':
      return {
        ...e,
        destinations: e.destinations.map((d) => {
          const c = a.comptes[d.platform] ?? d.compte;
          // En diffusion, le statut affiché reste celui de la diffusion ; sinon il suit le compte.
          const status = enDiffusion(d.status) ? d.status : c;
          // Un compte qui n'est plus connecté ne peut pas rester coché.
          return { ...d, compte: c, status, selected: c === 'connected' ? d.selected : false };
        }),
      };
    case 'select':
      return { ...e, destinations: e.destinations.map((d) => d.platform === a.platform ? { ...d, selected: a.on && selectionnable(d) } : d) };
    case 'start': {
      const cibles = destinationsADemarrer(e);
      if (!cibles.length) return e;
      return {
        ...e, live: true, demarreLe: e.demarreLe ?? a.maintenant,
        destinations: e.destinations.map((d) => cibles.includes(d.platform) ? { ...d, status: 'starting', error: undefined } : d),
      };
    }
    case 'statut': {
      const parPlateforme = new Map(a.statut.destinations.map((s) => [s.platform, s]));
      const destinations = e.destinations.map((d) => {
        const s = parPlateforme.get(d.platform);
        if (!s) return d;
        if (s.status === 'off') return { ...d, status: d.compte, error: undefined };
        return { ...d, status: s.status, error: s.error };
      });
      const live = destinations.some((d) => d.status === 'live' || d.status === 'starting');
      return { ...e, destinations, live, demarreLe: live ? (e.demarreLe ?? a.maintenant) : null };
    }
    case 'echec_demarrage':
      return { ...e, destinations: e.destinations.map((d) => d.platform === a.platform ? { ...d, status: 'error', error: a.error } : d) };
    case 'stop': {
      const destinations = e.destinations.map((d) => d.platform === a.platform ? { ...d, status: d.compte, error: undefined, selected: false } : d);
      const live = destinations.some((d) => d.status === 'live' || d.status === 'starting');
      return { ...e, destinations, live, demarreLe: live ? e.demarreLe : null };
    }
    case 'stop_all':
      return { ...e, live: false, demarreLe: null, destinations: e.destinations.map((d) => ({ ...d, status: d.compte, error: undefined })) };
    case 'retry':
      return { ...e, live: true, demarreLe: e.demarreLe ?? Date.now(), destinations: e.destinations.map((d) => d.platform === a.platform && d.compte === 'connected' ? { ...d, status: 'starting', error: undefined, selected: true } : d) };
    default:
      return e;
  }
}

export function dureeSec(e: EtatBroadcast, maintenant: number): number {
  return e.live && e.demarreLe ? Math.max(0, Math.floor((maintenant - e.demarreLe) / 1000)) : 0;
}

export function formatDuree(sec: number): string {
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}
