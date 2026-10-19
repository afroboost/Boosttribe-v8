/**
 * 🚪 ACCÈS D'UNE SESSION — deux réglages INDÉPENDANTS (audit 28/09) :
 *   - le MODE D'ENTRÉE (`playlists.mode`) : 'open' = avec crédits, 'paid' = billet,
 *     'private' = gratuit par lien / QR ;
 *   - les DROITS DES INVITÉS (`playlists.access_mode`) : 'guest' = écoute uniquement
 *     (ni visio, ni chat, ni caméra/micro), 'account' = accès visio.
 * « Gratuit par lien » sert surtout à inviter des gens à VOIR la visio : passer en mode
 * privé propose donc l'accès visio par défaut — sans jamais écraser un choix manuel.
 * Pur : aucun React, aucun réseau.
 */

export type ModeEntree = 'open' | 'paid' | 'private';
export type DroitsInvites = 'guest' | 'account';

/** Droits proposés après un changement de mode d'entrée dans la modale. */
export function droitsApresChoixEntree(e: {
  ancien: ModeEntree;
  nouveau: ModeEntree;
  droits: DroitsInvites;
  /** L'hôte a choisi lui-même les droits pendant CETTE ouverture de la modale. */
  choixManuel: boolean;
}): DroitsInvites {
  if (e.nouveau === 'private' && e.ancien !== 'private' && !e.choixManuel) return 'account';
  return e.droits;
}

/**
 * Page promo : l'invité doit-il PAYER (lien de paiement externe) ? En mode privé, jamais :
 * le mode réel prime sur un ancien lien de paiement resté enregistré (il n'est pas supprimé,
 * seulement ignoré pour l'admission). Mode inconnu (ancien backend) : le lien décide, comme avant.
 */
export function promoPayante(e: { mode?: string | null; paymentLink?: string | null }): boolean {
  if (e.mode === 'private') return false;
  return !!(e.paymentLink || '').trim();
}

/** La sauvegarde n'est un succès que si la RELECTURE rend exactement ce qui a été demandé. */
export function sauvegardeConfirmee(
  attendu: { mode: ModeEntree; acces: DroitsInvites },
  relu: { mode?: string | null; acces?: string | null } | null,
): boolean {
  return !!relu && relu.mode === attendu.mode && relu.acces === attendu.acces;
}

/**
 * Forme canonique d'une valeur JSON (clés triées) : jsonb ne garde pas l'ordre des clés.
 * Post-S0 (19/10/2026) — mêmes règles que JSON.stringify, donc que la valeur réellement ENVOYÉE :
 * une clé d'objet à `undefined` (ou fonction) n'existe pas dans le JSON écrit, donc pas non plus dans
 * le JSON relu → elle est IGNORÉE, à toute profondeur (sinon faux « non enregistré ») ; dans un
 * tableau, `undefined` devient `null`, comme dans le JSON envoyé. `toJSON` (Date…) est respecté.
 */
function canonique(v: unknown): string {
  if (v && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function') {
    return canonique((v as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(v)) return `[${v.map((x) => (absentDuJson(x) ? 'null' : canonique(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => !absentDuJson(o[k])).sort()
      .map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Valeur que JSON.stringify OMET d'un objet (et remplace par null dans un tableau). */
function absentDuJson(v: unknown): boolean {
  return v === undefined || typeof v === 'function' || typeof v === 'symbol';
}

/**
 * 🛡️ Post-S0 (19/10/2026) — Réglage de session écrit par le navigateur (is_private, média partagé,
 * description) : succès SEULEMENT si la base renvoie au moins une ligne ET que chaque ligne relue porte
 * exactement la valeur demandée. 0 ligne = la RLS a filtré (tiers, admin non hôte, session sans hôte
 * ou absente) ; valeur différente = le verrou S0 l'a neutralisée. Jamais de faux succès.
 */
export function ecritureSessionConfirmee(attendu: Record<string, unknown>, lignes: unknown): boolean {
  if (!Array.isArray(lignes) || lignes.length === 0) return false;
  // Une colonne demandée à `undefined` n'est pas envoyée (JSON) : elle ne peut pas être « confirmée ».
  //   Rien de confirmable (aucune colonne réellement envoyée) = échec, jamais un succès par défaut.
  const cles = Object.keys(attendu).filter((k) => !absentDuJson(attendu[k]));
  if (cles.length === 0) return false;
  return lignes.every((l) => !!l && typeof l === 'object'
    && cles.every((k) => canonique((l as Record<string, unknown>)[k]) === canonique(attendu[k])));
}
