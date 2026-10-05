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

// ── 👋 « Bon retour » (V574) — l'identité de l'invité vit sur le SERVEUR (afroboost.com/api). ──
// Le navigateur ne garde qu'un cookie HttpOnly opaque (illisible par le JavaScript) ; plus
// aucune coordonnée en clair dans le stockage local. Les anciennes clés sont effacées.

/** Anciennes clés invité en clair (e-mail / WhatsApp, pseudo, photo). */
export const CLES_PII_INVITE = ['bt_invite_contact', 'bt_nickname', 'bt_local_avatar'] as const;

export function effacerPiiInvite(stockage: Pick<Storage, 'removeItem'> | null): void {
  for (const k of CLES_PII_INVITE) {
    try { stockage?.removeItem(k); } catch { /* stockage indisponible */ }
  }
}

/** Même origine que la page /live : le cookie posé par afroboost.com/api est de premier parti. */
export const CHEMIN_LIVE_GUEST = '/api/live-guest';

export interface VueInvite { pseudo: string; photo_url: string; email_masque: string; whatsapp_masque: string }

async function appelLiveGuest(chemin: string, methode: 'GET' | 'POST' | 'PATCH', corps?: unknown): Promise<VueInvite | null> {
  try {
    const res = await fetch(`${CHEMIN_LIVE_GUEST}${chemin}`, {
      method: methode,
      credentials: 'same-origin',
      headers: corps ? { 'Content-Type': 'application/json' } : undefined,
      body: corps ? JSON.stringify(corps) : undefined,
    });
    if (!res.ok) return null;
    const v = await res.json();
    return v && typeof v.pseudo === 'string' ? (v as VueInvite) : null;
  } catch { return null; }
}

/** Cet appareil est-il reconnu ? (null = formulaire normal) */
export async function liveGuestMoi(): Promise<VueInvite | null> { return appelLiveGuest('/moi', 'GET'); }

/** 1re participation (ou nouvelle saisie) : relation coach + identité + cookie. */
export async function liveGuestRejoindre(c: { session_code: string | null | undefined; pseudo: string; email: string; whatsapp: string; photo_url?: string }): Promise<VueInvite | null> {
  if (!c.session_code) return null;
  return appelLiveGuest('/rejoindre', 'POST', { ...c, photo_url: c.photo_url || '' });
}

/** « Continuer vers le Live » : rattache cette participation au coach du live. */
export async function liveGuestContinuer(sessionCode: string | null | undefined): Promise<VueInvite | null> {
  if (!sessionCode) return null;
  return appelLiveGuest('/continuer', 'POST', { session_code: sessionCode });
}

/** « Modifier mes informations » : champs vides = inchangés. */
export async function liveGuestModifier(c: { session_code?: string | null; pseudo?: string; photo_url?: string; email?: string; whatsapp?: string }): Promise<VueInvite | null> {
  const corps: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) if (typeof v === 'string' && v) corps[k] = v;
  return appelLiveGuest('/moi', 'PATCH', corps);
}

/** « Ce n'est pas moi » / « Oublier ce profil » : révoque le jeton de CET appareil. */
export async function liveGuestOublier(): Promise<void> {
  try { await fetch(`${CHEMIN_LIVE_GUEST}/oublier`, { method: 'POST', credentials: 'same-origin' }); } catch { /* réseau */ }
}
