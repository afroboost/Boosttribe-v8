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
export function modeAutomatique(inviteEnVisio?: string | null): ModeSouffleur {
  return inviteEnVisio ? 'visio' : 'chat';
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
