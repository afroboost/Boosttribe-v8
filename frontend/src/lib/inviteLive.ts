/**
 * 👤 Invité du Live — règles PURES de l'écran « Rejoindre la tribu » (Phase 1, 05/10/2026).
 *
 * Audit prouvé :
 *  - le bouton affichait « Rejoindre l'écoute » en dur, même quand l'hôte avait choisi
 *    « Accès visio » (`playlists.access_mode` : 'account' = visio, 'guest' = écoute seule) ;
 *  - une photo HEIC passait le filtre `image/*` mais ne se décodait pas : « Valider » ne
 *    réagissait plus, sans aucun message ;
 *  - la photo d'un invité anonyme voyageait en base64 dans la présence temps réel.
 */

export type AccesInvite = 'account' | 'guest';

/** Libellé du bouton d'entrée, d'après le réglage RÉEL de l'hôte. */
export function libelleRejoindre({ estHote, acces, resolu }: { estHote: boolean; acces: AccesInvite; resolu: boolean }): string {
  if (estHote) return 'Démarrer la session';
  if (!resolu) return 'Rejoindre';
  return acces === 'guest' ? 'Rejoindre l’écoute' : 'Rejoindre le Live';
}

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Fichier brut accepté avant réduction (photos de téléphone récentes : 5 à 12 Mo). */
export const PHOTO_TAILLE_MAX = 15 * 1024 * 1024;
const EXT_OK = /\.(jpe?g|png|webp)$/i;
const HEIC = /hei[cf]/i;

export type VerdictPhoto = { ok: true } | { ok: false; erreur: string };

/** Le fichier choisi est-il utilisable ? Jamais de refus muet : toujours un message affichable. */
export function validerPhotoInvite(f: { type?: string; name?: string; size?: number }): VerdictPhoto {
  const type = String(f.type || '').toLowerCase();
  const nom = String(f.name || '');
  if (HEIC.test(type) || /\.hei[cf]$/i.test(nom)) {
    return { ok: false, erreur: 'Le format HEIC (photos iPhone) n’est pas pris en charge. Choisis une photo JPEG ou PNG, ou fais une capture d’écran de ta photo.' };
  }
  if ((f.size || 0) > PHOTO_TAILLE_MAX) {
    return { ok: false, erreur: 'Photo trop lourde (15 Mo maximum). Choisis une autre photo.' };
  }
  const typeOk = (PHOTO_TYPES as readonly string[]).includes(type) || (!type && EXT_OK.test(nom));
  if (!typeOk) return { ok: false, erreur: 'Format non pris en charge : JPEG, PNG ou WebP.' };
  return { ok: true };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Même règle que la saisie Afroboost (V570) ; la forme canonique est faite côté Afroboost. */
const TEL_RE = /^\+?\d{8,15}$/;

export type VerdictContact = { ok: true; email: string; whatsapp: string } | { ok: false; erreur: string };

/** E-mail valide s'il est renseigné, WhatsApp valide s'il est renseigné, au moins l'un des deux. */
export function validerContactInvite({ email, whatsapp }: { email?: string; whatsapp?: string }): VerdictContact {
  const e = String(email || '').trim().toLowerCase();
  const w = String(whatsapp || '').trim();
  if (!e && !w) return { ok: false, erreur: 'Indique ton e-mail ou ton numéro WhatsApp.' };
  if (e && !EMAIL_RE.test(e)) return { ok: false, erreur: 'Adresse e-mail invalide.' };
  if (w && !TEL_RE.test(w.replace(/[\s().-]/g, ''))) return { ok: false, erreur: 'Numéro WhatsApp invalide (ex. +41 79 123 45 67).' };
  return { ok: true, email: e, whatsapp: w };
}

/** Avatar transmis dans la présence temps réel : une URL courte, jamais une image base64. */
export function avatarPourPresence(url?: string | null): string | undefined {
  const u = String(url || '');
  return /^https?:\/\//.test(u) && u.length <= 500 ? u : undefined;
}

/** Information affichée près du bouton (pas un consentement marketing). */
export const TEXTE_INFO_CONTACT = 'En rejoignant le Live, tes coordonnées sont enregistrées par Afroboost pour gérer ta participation.';

const CLE_CONTACT = 'bt_invite_contact';

/** Coordonnées mémorisées sur cet appareil (préremplissage au retour sur le même lien). */
export function lireContactMemorise(stockage: Pick<Storage, 'getItem'> | null): { email: string; whatsapp: string } {
  try {
    const v = JSON.parse(stockage?.getItem(CLE_CONTACT) || '{}');
    return { email: String(v.email || ''), whatsapp: String(v.whatsapp || '') };
  } catch { return { email: '', whatsapp: '' }; }
}

export function memoriserContact(stockage: Pick<Storage, 'setItem'> | null, c: { email: string; whatsapp: string }): void {
  try { stockage?.setItem(CLE_CONTACT, JSON.stringify({ email: c.email, whatsapp: c.whatsapp })); } catch { /* stockage indisponible */ }
}
