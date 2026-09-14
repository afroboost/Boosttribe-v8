/**
 * 🔗 Base des liens PARTAGEABLES (lien de partage, QR code, invitations).
 *
 * L'habillage Afroboost n'est pas servi à la racine : il vit sous
 * https://afroboost.com/live (`base` Vite = `/live/`, `basename` du routeur).
 * `window.location.origin` seul produit alors des liens SANS le préfixe —
 * https://afroboost.com/promo/<CODE> — qui atterrissent sur le site principal,
 * lequel ne connaît pas la route /promo. C'est ce qui cassait les QR d'Afroboost
 * Live (correctif du 7 août sur la copie, repris ici dans le dépôt unique).
 *
 * ⚠️ Ne jamais reconstruire un lien partageable à la main : passer par ce module.
 */
import { PUBLIC_URL } from '@/config/brand';

/**
 * Base à utiliser pour un lien destiné à être copié, scanné ou envoyé.
 * En développement on reste sur l'hôte local (origin + base Vite), sinon on
 * renvoie l'URL publique de la MARQUE : un QR imprimé doit rester valable.
 */
export function publicBaseUrl(): string {
  if (import.meta.env.DEV) {
    const base = (import.meta.env.BASE_URL as string) || '/';
    return `${window.location.origin}${base}`.replace(/\/+$/, '');
  }
  return PUBLIC_URL;
}

/** Lien de partage d'une session (page promo, qui redirige vers la session). */
export function sessionShareUrl(sessionId: string): string {
  return `${publicBaseUrl()}/promo/${sessionId}`;
}
