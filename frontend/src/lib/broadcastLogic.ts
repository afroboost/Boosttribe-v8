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

/**
 * État du COMPTE, par plateforme, tel que le serveur le calcule (`GET /social/destinations/status`) :
 * - Facebook / YouTube (OAuth) : config_required → not_connected → connected | reauth ;
 * - Instagram / TikTok (URL RTMPS + clé) : config_required → not_configured → configured.
 * Diffusion : starting / live / error / off.
 */
export type StatutCompte = 'connected' | 'not_connected' | 'reauth' | 'unavailable' | 'config_required' | 'not_configured' | 'configured';
export type StatutDestination = StatutCompte | 'starting' | 'live' | 'error' | 'off';

/** Comment on relie la plateforme : parcours OAuth (FB/YT) ou saisie RTMPS + clé (IG/TikTok). */
export type GenreDestination = 'oauth' | 'manual';

export interface Destination {
  platform: Plateforme;
  label: string;
  status: StatutDestination;
  selected: boolean;
  error?: string;
  /** État du COMPTE, conservé pendant la diffusion pour savoir où revenir à l'arrêt. */
  compte: StatutCompte;
  kind: GenreDestination;
  /** `config_required` : NOMS des variables serveur manquantes (jamais des valeurs). */
  missing: string[];
  /** `configured` : la clé est enregistrée côté serveur ; seuls ses 4 derniers caractères reviennent. */
  keyHint: string | null;
  accountLabel: string | null;
}

export const GENRE_PAR_PLATEFORME: Record<Plateforme, GenreDestination> = { instagram: 'manual', facebook: 'oauth', youtube: 'oauth', tiktok: 'manual' };

export interface EtatBroadcast {
  destinations: Destination[];
  live: boolean;
  demarreLe: number | null;   // epoch ms
}

export const BROADCAST_INITIAL: EtatBroadcast = {
  destinations: PLATEFORMES.map((p) => ({
    platform: p, label: LIBELLES[p], status: 'unavailable', selected: false, compte: 'unavailable',
    kind: GENRE_PAR_PLATEFORME[p], missing: [], keyHint: null, accountLabel: null,
  })),
  live: false,
  demarreLe: null,
};

/** Ce que le serveur dit d'un compte (jamais de secret dedans) : un simple statut, ou le détail. */
export interface InfoCompteServeur {
  status: StatutCompte;
  kind?: GenreDestination;
  missing?: string[];
  key_hint?: string | null;
  key_saved?: boolean;
  account_label?: string | null;
}
export type ComptesServeur = Partial<Record<Plateforme, StatutCompte | InfoCompteServeur>>;

const STATUTS_COMPTE: StatutCompte[] = ['connected', 'not_connected', 'reauth', 'unavailable', 'config_required', 'not_configured', 'configured'];

/** Normalise une réponse serveur (`/social/destinations/status` OU `/live/broadcast/accounts`) en ComptesServeur. */
export function comptesDepuisServeur(json: unknown): ComptesServeur {
  const out: ComptesServeur = {};
  if (!json || typeof json !== 'object') return out;
  const j = json as { destinations?: unknown; accounts?: unknown };
  if (Array.isArray(j.destinations)) {
    for (const d of j.destinations as Array<Record<string, unknown>>) {
      const p = d.platform as Plateforme; const st = d.status as StatutCompte;
      if (!PLATEFORMES.includes(p) || !STATUTS_COMPTE.includes(st)) continue;
      out[p] = {
        status: st, kind: (d.kind as GenreDestination) || GENRE_PAR_PLATEFORME[p],
        missing: Array.isArray(d.missing) ? (d.missing as unknown[]).filter((x): x is string => typeof x === 'string') : [],
        key_hint: typeof d.key_hint === 'string' ? d.key_hint : null, key_saved: d.key_saved === true,
        account_label: typeof d.account_label === 'string' ? d.account_label : null,
      };
    }
    return out;
  }
  if (j.accounts && typeof j.accounts === 'object') {
    for (const [p, st] of Object.entries(j.accounts as Record<string, unknown>)) {
      if (PLATEFORMES.includes(p as Plateforme) && STATUTS_COMPTE.includes(st as StatutCompte)) out[p as Plateforme] = st as StatutCompte;
    }
  }
  return out;
}

/** Le direct réel est-il autorisé côté serveur ? (false = simulation, rien ne sort du serveur). */
export function directAutoriseDepuisServeur(json: unknown): boolean {
  return !!json && typeof json === 'object' && (json as { direct_reel_autorise?: unknown }).direct_reel_autorise === true;
}

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

/** Une destination peut être cochée seulement si son compte est relié (OAuth) ou configuré (RTMPS + clé). */
export function selectionnable(d: Destination): boolean { return d.compte === 'connected' || d.compte === 'configured'; }

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
          const brut = a.comptes[d.platform];
          const info: InfoCompteServeur | undefined = brut === undefined ? undefined : (typeof brut === 'string' ? { status: brut } : brut);
          const c = info?.status ?? d.compte;
          // En diffusion, le statut affiché reste celui de la diffusion ; sinon il suit le compte.
          const status = enDiffusion(d.status) ? d.status : c;
          const relie = c === 'connected' || c === 'configured';
          // Un compte qui n'est plus relié ne peut pas rester coché.
          return {
            ...d, compte: c, status, selected: relie ? d.selected : false,
            kind: info?.kind ?? d.kind,
            missing: info ? (info.missing ?? []) : d.missing,
            keyHint: info ? (info.key_hint ?? null) : d.keyHint,
            accountLabel: info ? (info.account_label ?? null) : d.accountLabel,
          };
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
      return { ...e, live: true, demarreLe: e.demarreLe ?? Date.now(), destinations: e.destinations.map((d) => d.platform === a.platform && selectionnable(d) ? { ...d, status: 'starting', error: undefined, selected: true } : d) };
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
