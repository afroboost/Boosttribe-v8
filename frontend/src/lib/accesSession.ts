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
