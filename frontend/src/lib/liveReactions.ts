/**
 * ❤ RÉACTIONS LIVE — logique pure (aucun React, aucun timer, aucune base de données).
 *
 * Les réactions sont des événements broadcast ÉPHÉMÈRES sur le canal `playback:<sessionId>`.
 * Deux règles de conception :
 *  1. L'animation est LOCALE et IMMÉDIATE ; le réseau est AGRÉGÉ (1 envoi max par intervalle
 *     et par client) — 20 clics en une seconde = UN seul événement `{ counts: { like: 20 } }`.
 *  2. Plafonds aux DEUX bouts : à l'émission (`maxParEnvoi`) ET à la réception (`MAX_PAR_LOT`),
 *     car un client modifié peut envoyer ce qu'il veut.
 *
 * L'horloge est toujours injectée (`maintenantMs`) : la lib est testable sans faux timers.
 */

export type TypeReaction = 'like' | 'bravo' | 'feu';
export const TYPES_REACTION: readonly TypeReaction[] = ['like', 'bravo', 'feu'];

/** Événement broadcast : un lot agrégé de réactions d'un client. */
export const EVT_REACTIONS = 'LIVE_REACTIONS';
/** Événement broadcast : l'hôte ré-annonce le total pour les retardataires. */
export const EVT_TOTAL = 'LIVE_REACTIONS_TOTAL';

export type Comptes = Partial<Record<TypeReaction, number>>;
export type Totaux = Record<TypeReaction, number>;

/** Payload de `EVT_REACTIONS`. `seq` est croissant par émetteur (initialisé sur l'horloge). */
export interface LotReactions {
  from: string;
  counts: Comptes;
  seq: number;
}

/** Payload de `EVT_TOTAL`. */
export interface AnnonceTotal {
  from: string;
  totaux: Totaux;
}

export interface EtatReactions {
  totaux: Totaux;
  /** Dernier `seq` accepté par émetteur (rejeu / doublon ignoré). */
  vus: Record<string, number>;
  /** Heure du dernier lot accepté par émetteur (anti-rafale à la réception). */
  derniers: Record<string, number>;
}

/** Plafond d'un lot à la réception, par émetteur. */
export const MAX_PAR_LOT = 60;
/** Écart minimal entre deux lots acceptés d'un même émetteur (un client honnête envoie ≤ 1 / 1,5 s). */
export const ECART_MIN_RECEPTION_MS = 700;
/** Borne haute d'un total annoncé (un total absurde est ignoré). */
export const MAX_TOTAL = 1_000_000_000;

export const ETAT_INITIAL: EtatReactions = Object.freeze({
  totaux: Object.freeze({ like: 0, bravo: 0, feu: 0 }) as Totaux,
  vus: Object.freeze({}) as Record<string, number>,
  derniers: Object.freeze({}) as Record<string, number>,
}) as EtatReactions;

const entierPositif = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

export const totalDe = (t: Partial<Totaux>): number =>
  TYPES_REACTION.reduce((s, k) => s + entierPositif(t[k]), 0);

/* ───────────────────────────── ÉMISSION ───────────────────────────── */

export interface OptionsTampon {
  /** Identifiant de l'émetteur (mis dans `from`). */
  from: string;
  envoyer: (lot: LotReactions) => void;
  intervalleMs?: number;
  maxParEnvoi?: number;
  /**
   * Premier `seq` émis. Le hook passe `Date.now()` : après un rechargement de page, les `seq`
   * repartent AU-DESSUS des anciens et ne sont pas pris pour des rejeux.
   */
  seqInitial?: number;
}

export interface TamponReactions {
  /** Ajoute un clic. `false` = tronqué (plafond de l'envoi en cours atteint). */
  ajouter: (type: TypeReaction, maintenantMs: number) => boolean;
  /** Envoie le lot si l'intervalle est écoulé (ou si `forcer`). Renvoie le lot envoyé, sinon null. */
  vider: (maintenantMs: number, forcer?: boolean) => LotReactions | null;
  /** Heure à laquelle `vider` enverra, ou null s'il n'y a rien en attente. */
  prochainVidage: () => number | null;
  enAttente: () => number;
}

export function creerTamponReactions({
  from,
  envoyer,
  intervalleMs = 1500,
  maxParEnvoi = 30,
  seqInitial = 1,
}: OptionsTampon): TamponReactions {
  let comptes: Comptes = {};
  let nb = 0;
  let debutFenetre: number | null = null;
  let dernierEnvoi = -Infinity;
  let seq = Math.floor(seqInitial);

  const prochainVidage = () =>
    nb === 0 || debutFenetre === null ? null : Math.max(debutFenetre + intervalleMs, dernierEnvoi + intervalleMs);

  return {
    ajouter(type, maintenantMs) {
      if (!TYPES_REACTION.includes(type)) return false;
      if (nb >= maxParEnvoi) return false;
      if (debutFenetre === null) debutFenetre = maintenantMs;
      comptes[type] = (comptes[type] ?? 0) + 1;
      nb += 1;
      return true;
    },
    vider(maintenantMs, forcer = false) {
      const echeance = prochainVidage();
      if (echeance === null) return null;
      if (!forcer && maintenantMs < echeance) return null;
      const lot: LotReactions = { from, counts: comptes, seq };
      seq += 1;
      comptes = {};
      nb = 0;
      debutFenetre = null;
      dernierEnvoi = maintenantMs;
      envoyer(lot);
      return lot;
    },
    prochainVidage,
    enAttente: () => nb,
  };
}

/* ───────────────────────────── RÉCEPTION ───────────────────────────── */

/** Normalise et plafonne les comptes d'un lot (total ≤ max, dans l'ordre like → bravo → feu). */
export function plafonnerComptes(c: unknown, max = MAX_PAR_LOT): Totaux {
  const src = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
  const out: Totaux = { like: 0, bravo: 0, feu: 0 };
  let reste = max;
  for (const k of TYPES_REACTION) {
    const n = Math.min(entierPositif(src[k]), reste);
    out[k] = n;
    reste -= n;
  }
  return out;
}

/**
 * Applique un lot reçu. Renvoie LA MÊME RÉFÉRENCE si rien ne change (doublon, rejeu, lot vide,
 * rafale, payload invalide) — règle projet : jamais de setState d'un objet identique.
 */
export function appliquerLot(etat: EtatReactions, lot: unknown, maintenantMs: number): EtatReactions {
  if (!lot || typeof lot !== 'object') return etat;
  const { from, seq, counts } = lot as Partial<LotReactions>;
  if (typeof from !== 'string' || !from || typeof seq !== 'number' || !Number.isFinite(seq)) return etat;
  const dejaVu = etat.vus[from];
  if (dejaVu !== undefined && seq <= dejaVu) return etat;
  const dernier = etat.derniers[from];
  if (dernier !== undefined && maintenantMs - dernier < ECART_MIN_RECEPTION_MS) return etat;
  const c = plafonnerComptes(counts);
  if (totalDe(c) === 0) return etat;
  return {
    totaux: {
      like: etat.totaux.like + c.like,
      bravo: etat.totaux.bravo + c.bravo,
      feu: etat.totaux.feu + c.feu,
    },
    vus: { ...etat.vus, [from]: seq },
    derniers: { ...etat.derniers, [from]: maintenantMs },
  };
}

/** Ajoute ses PROPRES clics (le broadcast ne renvoie pas l'écho à l'émetteur). */
export function ajouterLocal(etat: EtatReactions, type: TypeReaction, n = 1): EtatReactions {
  if (!TYPES_REACTION.includes(type) || n <= 0) return etat;
  return { ...etat, totaux: { ...etat.totaux, [type]: etat.totaux[type] + Math.floor(n) } };
}

/** Total ré-annoncé par l'hôte : on garde le MAX par type. Même référence si rien n'augmente. */
export function synchroTotal(etat: EtatReactions, totalAnnonce: unknown): EtatReactions {
  if (!totalAnnonce || typeof totalAnnonce !== 'object') return etat;
  const src = totalAnnonce as Record<string, unknown>;
  let change = false;
  const t: Totaux = { ...etat.totaux };
  for (const k of TYPES_REACTION) {
    const v = entierPositif(src[k]);
    if (v > MAX_TOTAL) continue;
    if (v > t[k]) { t[k] = v; change = true; }
  }
  return change ? { ...etat, totaux: t } : etat;
}

/** L'hôte annonce-t-il le total ? Au plus toutes les `periodeMs`, et seulement s'il a changé. */
export function doitAnnoncerTotal(
  dernierAnnonce: Totaux | null,
  totaux: Totaux,
  dernierMs: number,
  maintenantMs: number,
  periodeMs = 10_000,
): boolean {
  if (maintenantMs - dernierMs < periodeMs) return false;
  if (totalDe(totaux) === 0) return false;
  if (!dernierAnnonce) return true;
  return TYPES_REACTION.some((k) => dernierAnnonce[k] !== totaux[k]);
}

/* ───────────────────────────── AFFICHAGE ───────────────────────────── */

export const MAX_BULLES_PAR_LOT = 8;
export const MAX_BULLES_SIMULTANEES = 24;

/** Nombre de bulles animées pour n réactions reçues. */
export function bullesAAfficher(n: number, reducedMotion: boolean): number {
  const v = entierPositif(n);
  if (v === 0) return 0;
  return reducedMotion ? 1 : Math.min(v, MAX_BULLES_PAR_LOT);
}

/** Paramètres d'animation déterministes d'une bulle (pas de hasard dans l'état React). */
export function parametresBulle(index: number): { deriveePx: number; dureeMs: number; delaiMs: number; echelle: number } {
  const h = Math.abs(Math.imul(index + 1, 2654435761) | 0);
  return {
    deriveePx: (h % 41) - 20,            // -20 … +20 px
    dureeMs: 1800 + (h % 5) * 100,       // 1,8 … 2,2 s
    delaiMs: (index % MAX_BULLES_PAR_LOT) * 70,
    echelle: 0.85 + ((h >> 3) % 4) * 0.08,
  };
}

/** 999 → « 999 » ; 1 234 → « 1,2 k » ; 2 500 000 → « 2,5 M » (espace insécable, arrondi inférieur). */
export function formaterCompteur(n: number): string {
  const v = entierPositif(n);
  if (v < 1000) return String(v);
  const [div, unite] = v < 1_000_000 ? [1000, 'k'] : [1_000_000, 'M'];
  const x = Math.floor((v / div) * 10) / 10;
  const txt = Number.isInteger(x) ? String(x) : x.toFixed(1).replace('.', ',');
  return `${txt} ${unite}`;
}
