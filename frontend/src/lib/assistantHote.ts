/**
 * 🤖 LE SOUFFLEUR — règles PURES de l'assistant privé de l'hôte.
 *
 * Il souffle, il ne parle pas. Tout ce qu'il produit est une PROPOSITION que le coach
 * lit, choisit, modifie ou ignore. Rien ici n'envoie quoi que ce soit : ce module ne
 * décide que trois choses, et chacune parce que son absence coûterait cher.
 *
 *  1. CE QUI PART (`messagesPourIA`). Un message de chat porte bien plus que son texte :
 *     un `userId`, un avatar, un horodatage, parfois une photo. Rien de tout cela n'aide
 *     à formuler une réponse, donc rien de tout cela ne sort. On garde le prénom affiché
 *     et la phrase — c'est le strict nécessaire, et c'est une liste BLANCHE : un champ
 *     ajouté un jour au chat ne partira pas tout seul chez un tiers.
 *
 *  2. QUAND ÇA PART (`doitAppeler`). Un appel par caractère tapé, ou par message reçu
 *     dans un direct animé, c'est une facture et une latence pour rien. Deux garde-fous
 *     qui se complètent : un délai minimum entre deux appels, et une EMPREINTE du
 *     contexte — si rien n'a changé, on ne redemande pas la même chose. Le bouton
 *     « Actualiser » force, lui, parce que c'est un geste humain délibéré.
 *
 *  3. DE QUOI ON PARLE (`modeAutomatique`). Quelqu'un est à l'écran avec le coach : les
 *     bonnes suggestions sont des questions, pas des réponses de chat. Et sans invité,
 *     on ne propose JAMAIS de relances adressées à un invité qui n'existe pas.
 */

export type ModeSouffleur = 'chat' | 'visio';

/** Délai minimum entre deux appels automatiques. Un direct bavard ne doit pas coûter cher. */
export const DELAI_MIN_MS = 6000;

/** Fenêtre de contexte : les derniers messages, et rien de plus (le serveur re-tronque). */
export const MESSAGES_CONTEXTE = 8;

export interface MessageChat {
  id?: string;
  name?: string;
  text?: string;
  userId?: string;
  [k: string]: unknown;
}

export interface MessagePourIA { nom: string; texte: string }

/**
 * Liste BLANCHE : prénom affiché + texte. Les messages vides disparaissent, et tout autre
 * champ (identifiant, avatar, horodatage…) reste ici.
 */
export function messagesPourIA(messages: MessageChat[] | null | undefined): MessagePourIA[] {
  return (messages || [])
    .slice(-MESSAGES_CONTEXTE)
    .map((m) => ({ nom: String((m && m.name) || 'Participant').slice(0, 40), texte: String((m && m.text) || '').trim() }))
    .filter((m) => m.texte.length > 0);
}

/** Le mode qui a du sens maintenant : quelqu'un à l'écran → on prépare l'échange. */
/**
 * 05/10 — « Échanger en visio » (mode de l'assistant IA) : NON OPÉRATIONNEL tant qu'aucune
 * transcription vocale en direct n'existe. Ce mode promet des « relances sur ce que la personne
 * vient de DIRE » ; or l'IA ne reçoit que le TEXTE du chat (aucun speech-to-text temps réel :
 * seul l'enregistrement est transcrit APRÈS coup). Le choix reste visible, désactivé, avec
 * « Transcription vocale bientôt disponible » ; l'IA ne bascule plus d'elle-même en « visio »
 * quand quelqu'un monte à l'écran. La visio elle-même (caméra / micro de l'invité) n'est pas concernée.
 * Brancher un moteur (entrée prête : `recevoirTranscription`) puis passer ceci à true = décision de Bassi.
 */
export const VISIO_IA_DISPONIBLE = true; // 06/10 : transcription en direct branchée (lib/transcriptionVisio), GO de Bassi

export function modeAutomatique(inviteEnVisio?: string | null): ModeSouffleur {
  // 06/10 : « Échanger en visio » ÉCOUTE la personne : c'est un CHOIX de l'hôte, jamais une bascule
  //   automatique quand quelqu'un monte à l'écran (l'avis de transcription suit ce choix).
  void inviteEnVisio;
  return 'chat';
}

/** Signature du contexte : deux contextes identiques ne méritent pas deux appels. */
export function empreinteContexte(
  mode: ModeSouffleur,
  messages: MessagePourIA[],
  invite?: string | null,
): string {
  const dernier = messages.length ? messages[messages.length - 1] : null;
  return [mode, invite || '', String(messages.length),
    dernier ? `${dernier.nom}:${dernier.texte}` : ''].join('|');
}

export interface EtatRelance {
  /** Horodatage du dernier appel lancé (0 = jamais). */
  dernierAppelMs: number;
  /** Empreinte du contexte de ce dernier appel. */
  derniereEmpreinte: string;
}

export interface DemandeRelance {
  etat: EtatRelance;
  empreinte: string;
  maintenant: number;
  /** L'assistant est-il allumé ? Éteint, on n'appelle rien, jamais. */
  actif: boolean;
  /** Clic sur « Actualiser » : un geste humain passe devant le délai. */
  forcer?: boolean;
  /** Un appel est déjà en vol. */
  enCours?: boolean;
}

/**
 * Faut-il (re)demander des suggestions ?
 *
 * Éteint ou appel déjà en vol → non, toujours. Sinon « Actualiser » passe devant tout
 * (c'est un clic volontaire). Un contexte inchangé ne vaut pas un second appel. Et un
 * contexte qui bouge attend quand même `DELAI_MIN_MS` : dans un direct bavard, les
 * messages arrivent en rafale, la facture aussi.
 */
export function doitAppeler(d: DemandeRelance): boolean {
  if (!d.actif || d.enCours) return false;
  if (!d.empreinte) return false;
  if (d.forcer) return true;
  if (d.empreinte === d.etat.derniereEmpreinte) return false;
  return d.maintenant - d.etat.dernierAppelMs >= DELAI_MIN_MS;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 05/10 — PRÉPARATION AUTOMATIQUE : une question PERTINENTE arrive dans le chat → une suggestion
 * est préparée pour l'HÔTE (jamais envoyée au participant). Chaque garde-fou ci-dessous est un
 * coût évité ; tous sont des fonctions pures, testées sans réseau.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** Calme demandé après l'arrivée d'une question avant d'appeler (une rafale = un seul appel). */
export const DEBOUNCE_MS = 1500;
/** Une question plus vieille que ça (ex. relue après un rechargement) ne déclenche rien. */
export const AGE_MAX_AUTO_MS = 10 * 60_000;
/** Plafond client des demandes AUTOMATIQUES par fenêtre glissante (le serveur a le sien). */
export const MAX_AUTO_PAR_FENETRE = 10;
export const FENETRE_AUTO_MS = 5 * 60_000;
/** Au-delà, on abandonne l'attente : le Live continue, l'hôte voit « indisponible ». */
export const DELAI_REPONSE_MS = 15_000;
export const DELAI_REDACTION_MS = 35_000;
/** Contexte envoyé avec une question : la question + les 4 derniers messages, rien de plus. */
export const MESSAGES_CONTEXTE_QUESTION = 4;
/** Mémoire des questions déjà demandées (bornée). */
export const MEMOIRE_DEMANDEES = 200;

export interface QuestionAuto { id: string; texte: string; ts?: number }

/**
 * La prochaine question à préparer, ou `null`. Une question = AU PLUS une demande automatique
 * (`dejaDemandees`) ; rien tant qu'une suggestion attend la décision de l'hôte, ni pendant un
 * appel en vol ; assistant éteint → rien, jamais ; bruit (bonjour, merci, emoji…) → rien ;
 * question trop ancienne → rien. La plus ANCIENNE question pertinente passe d'abord.
 */
export function questionAPreparer<Q extends QuestionAuto>(p: {
  file: Q[]; dejaDemandees: ReadonlySet<string> | string[]; suggestionEnAttente: boolean;
  actif: boolean; enCours: boolean; pertinente: (texte: string) => boolean; maintenant?: number;
}): Q | null {
  if (!p.actif || p.enCours || p.suggestionEnAttente) return null;
  const deja = p.dejaDemandees instanceof Set ? p.dejaDemandees : new Set(p.dejaDemandees);
  return p.file.find((q) => !!q && !!q.id && !deja.has(q.id) && p.pertinente(q.texte)
    && !(typeof q.ts === 'number' && typeof p.maintenant === 'number' && p.maintenant - q.ts > AGE_MAX_AUTO_MS)) ?? null;
}

/** Plafond client : vrai si une demande automatique est permise maintenant (sans rien compter). */
export function quotaAutoPermis(historique: readonly number[], maintenant: number): boolean {
  return historique.filter((t) => maintenant - t < FENETRE_AUTO_MS).length < MAX_AUTO_PAR_FENETRE;
}

/** Ajoute un appel à l'historique (copie bornée à la fenêtre). */
export function compterAppelAuto(historique: readonly number[], maintenant: number): number[] {
  return [...historique.filter((t) => maintenant - t < FENETRE_AUTO_MS), maintenant];
}

/** Ce qui part avec une question : la question elle-même + les derniers messages, bornés. */
export function contextePourQuestion(
  messages: MessageChat[] | null | undefined,
  q: { id?: string; auteur?: string; texte?: string } | null | undefined,
): { messages: MessagePourIA[]; question: MessagePourIA | null } {
  const ctx = messagesPourIA(messages).slice(-MESSAGES_CONTEXTE_QUESTION);
  const texte = String((q && q.texte) || '').trim().slice(0, 500);
  return { messages: ctx, question: texte ? { nom: String((q && q.auteur) || 'Participant').slice(0, 40), texte } : null };
}

/**
 * Attendre une promesse, mais pas plus de `ms`. Le délai dépassé ou une exception deviennent
 * une valeur de REPLI : jamais de rejet non géré, jamais d'attente infinie de l'hôte.
 */
export function avecDelai<T>(p: Promise<T>, ms: number, repli: T, siErreur: T = repli): Promise<T> {
  return new Promise<T>((resolve) => {
    let fini = false;
    const t = setTimeout(() => { if (!fini) { fini = true; resolve(repli); } }, ms);
    Promise.resolve(p).then(
      (v) => { if (!fini) { fini = true; clearTimeout(t); resolve(v); } },
      () => { if (!fini) { fini = true; clearTimeout(t); resolve(siErreur); } },
    );
  });
}

/** Mémoire des questions demandées : relue (liste blanche de chaînes), bornée. */
export function lireDemandees(brut: string | null | undefined): Set<string> {
  try {
    const v = JSON.parse(String(brut || '[]'));
    return new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x.length <= 200).slice(-MEMOIRE_DEMANDEES));
  } catch { return new Set(); }
}
export function ecrireDemandees(s: ReadonlySet<string>): string {
  return JSON.stringify([...s].slice(-MEMOIRE_DEMANDEES));
}

/** Que faire quand le calme (debounce) est écoulé ? Décision pure, testée. */
export type DecisionAuto = { action: 'appeler' } | { action: 'quota' } | { action: 'attendre'; ms: number };
export function decisionAuto(p: { historique: readonly number[]; maintenant: number; dernierAppelMs: number }): DecisionAuto {
  if (!quotaAutoPermis(p.historique, p.maintenant)) return { action: 'quota' };
  const reste = DELAI_MIN_MS - (p.maintenant - p.dernierAppelMs);
  return reste > 0 ? { action: 'attendre', ms: Math.max(500, reste) } : { action: 'appeler' };
}

/**
 * DEBOUNCE : chaque `planifier` annule le précédent ; seul le dernier part, après `ms` de calme.
 * Une rafale de messages (ou de re-rendus) = UNE exécution. Minuterie injectable (tests).
 */
export interface Debounce { planifier(fn: () => void): void; annuler(): void }
export function creerDebounce(
  ms: number,
  minuterie: { poser: (fn: () => void, ms: number) => unknown; retirer: (h: unknown) => void } = {
    poser: (fn, d) => setTimeout(fn, d), retirer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): Debounce {
  let h: unknown = null;
  return {
    planifier(fn) {
      if (h !== null) minuterie.retirer(h);
      h = minuterie.poser(() => { h = null; fn(); }, ms);
    },
    annuler() { if (h !== null) { minuterie.retirer(h); h = null; } },
  };
}
