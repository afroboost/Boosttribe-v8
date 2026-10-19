// 📜 CGU — règles PURES du consentement (post-S0, 19/10/2026). Testées : tests/cguConsentement.test.mjs.
//
// La PREUVE (date + version) est posée par le SERVEUR : fonction `accepter_cgu(p_version)`
// (infra/post-s0/migrations/03_cgu_preuve.sql). Le navigateur ne fait que :
//   1. dire QUELLE version a été montrée (CGU_VERSION, une seule source) ;
//   2. ne confirmer une acceptation qu'après RELECTURE de la ligne profiles.
// Tant que 03 n'est pas appliquée (colonnes absentes, fonction inconnue), repli sur la seule
// colonne `terms_accepted` : le front marche dans les deux états de la base.

/** Version des CGU affichées (date de publication AAAA-MM-JJ). À changer À CHAQUE modification du
 *  texte des CGU (PricingPage, fenêtre « Conditions Générales d'Utilisation ») : tout le monde sera
 *  alors sollicité une fois pour la nouvelle version. */
export const CGU_VERSION = '2026-10-19';

/** Clé du consentement donné AVANT la redirection Google (relu au retour, puis effacé). */
export const CLE_CGU_EN_ATTENTE = 'bt_cgu_en_attente';
/** Durée de validité d'un consentement en attente (aller-retour Google). Courte : un appareil partagé
 *  ne doit pas attribuer la case cochée par l'un au compte d'un autre bien plus tard. */
export const CGU_EN_ATTENTE_TTL_MS = 15 * 60 * 1000;

export interface LignePreuveCgu {
  terms_accepted?: boolean | null;
  terms_accepted_at?: string | null;
  terms_version?: string | null;
}

/** La base porte-t-elle les colonnes de preuve (migration 03 appliquée) ? */
export function preuveDisponible(row: LignePreuveCgu | null | undefined): boolean {
  return !!row && Object.prototype.hasOwnProperty.call(row, 'terms_accepted_at');
}

/** Acceptation valable pour `version` : avec 03, true + date serveur + MÊME version ; sans 03,
 *  `terms_accepted === true` seul. Jamais d'acceptation supposée (null, absent, chaîne… = non). */
export function cguAJour(row: LignePreuveCgu | null | undefined, version: string = CGU_VERSION): boolean {
  if (!row || row.terms_accepted !== true) return false;
  if (!preuveDisponible(row)) return true;
  return !!row.terms_accepted_at && row.terms_version === version;
}

/** Métadonnées d'inscription e-mail (user_metadata) : trace du consentement côté compte, dès
 *  l'inscription — même si la session n'existe qu'après confirmation de l'adresse. */
export function metadonneesInscription(fullName: string | undefined, email: string, version: string = CGU_VERSION,
  maintenant: Date = new Date()): Record<string, unknown> {
  return {
    full_name: (fullName || '').trim() || email.split('@')[0],
    cgu_acceptees: true,
    cgu_version: version,
    cgu_acceptees_le_client: maintenant.toISOString(),
  };
}

/** Le compte a-t-il consenti (inscription e-mail) à CETTE version ? */
export function consentementInscription(meta: Record<string, unknown> | null | undefined,
  version: string = CGU_VERSION): boolean {
  return !!meta && meta.cgu_acceptees === true && meta.cgu_version === version;
}

/** Valeur stockée avant la redirection Google. */
export function serialiserEnAttente(version: string = CGU_VERSION, maintenant: number = Date.now()): string {
  return JSON.stringify({ v: version, t: maintenant });
}

/** Consentement en attente valable : même version, horodaté, récent (≤ TTL), pas dans le futur. */
export function enAttenteValide(brut: string | null | undefined, version: string = CGU_VERSION,
  maintenant: number = Date.now(), ttl: number = CGU_EN_ATTENTE_TTL_MS): boolean {
  if (!brut) return false;
  try {
    const o = JSON.parse(brut) as { v?: unknown; t?: unknown };
    if (o.v !== version || typeof o.t !== 'number' || !Number.isFinite(o.t)) return false;
    const age = maintenant - o.t;
    return age >= 0 && age <= ttl;
  } catch {
    return false;
  }
}

/** Erreur « la fonction accepter_cgu n'existe pas » (migration 03 non appliquée) → repli. */
export function fonctionCguAbsente(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'PGRST202' || err.code === '42883') return true;
  const m = String(err.message || '');
  return /accepter_cgu/.test(m) && /(could not find|does not exist|introuvable)/i.test(m);
}

export type ResultatCgu = { ok: true } | { ok: false; erreur: string };

/** Message clair d'échec, jamais de faux succès. */
export const MESSAGE_ECHEC_CGU =
  "Votre acceptation des CGU n'a pas pu être enregistrée. Réessayez dans un instant ; si le problème persiste, déconnectez-vous puis reconnectez-vous.";

/** Verdict APRÈS relecture : seule la ligne relue fait foi. */
export function verdictRelecture(relue: LignePreuveCgu | null | undefined, version: string = CGU_VERSION): ResultatCgu {
  return cguAJour(relue, version) ? { ok: true } : { ok: false, erreur: MESSAGE_ECHEC_CGU };
}

/** Sous-titre « Créer un compte » selon la marque. */
export function texteRejoindre(nomCommunaute: string): string {
  return `Rejoignez la communauté ${nomCommunaute}`;
}
