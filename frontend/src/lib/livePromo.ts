/**
 * 📣 Promo participant pendant le Live — règles PURES côté écran (aucun réseau).
 *
 * Le serveur est la source de vérité : il fixe `started_at` / `ends_at` et renvoie
 * `server_now`. L'écran corrige l'écart d'horloge du téléphone (offset) pour que TOUS
 * les participants voient le MÊME temps restant — y compris après un rechargement ou pour
 * un nouvel arrivant. Aucune durée n'est décomptée « depuis l'ouverture » de l'écran.
 */

export type StatutPromo = 'requested' | 'rejected' | 'accepted' | 'payment_pending' | 'payment_failed'
  | 'ready' | 'broadcasting' | 'completed' | 'stopped_early';

/** 01/10 : `type` EXPLICITE — « free » (gratuit, aucun paiement) ou « paid » (défaut, minimum 0,50 CHF). */
export interface OffrePromo { id: string; duree_s: number; prix: number; actif?: boolean; type?: 'free' | 'paid' }
export const estGratuite = (o: { type?: string } | null | undefined): boolean => o?.type === 'free';

export interface PromoPublique {
  id: string; title: string; body: string; media_url: string | null; external_url: string | null;
  participant_name: string; started_at: string; ends_at: string; duration_seconds: number; remaining_seconds: number;
  /** 01/10 : position choisie par l'hôte (fractions de la scène) ; null/absent = en bas (défaut). */
  layout?: { x: number; y: number; w: number } | null;
}

/** Écart (ms) entre l'horloge du serveur et celle de l'appareil, mesuré à la réception. */
export function decalageHorloge(serverNowIso: string | null | undefined, recuALocalMs: number): number {
  const s = Date.parse(String(serverNowIso || ''));
  return Number.isFinite(s) ? s - recuALocalMs : 0;
}

/** Secondes restantes (≥ 0) d'une promo, à l'instant `maintenantLocalMs`, horloge serveur. */
export function secondesRestantes(endsAtIso: string | null | undefined, decalageMs: number, maintenantLocalMs: number): number {
  const fin = Date.parse(String(endsAtIso || ''));
  if (!Number.isFinite(fin)) return 0;
  return Math.max(0, Math.ceil((fin - (maintenantLocalMs + decalageMs)) / 1000));
}

/** Lien « Découvrir » : http(s) uniquement, sinon null (AUCUN bouton). Même règle que le serveur. */
export function lienDecouvrir(url: string | null | undefined): string | null {
  const s = String(url || '').trim();
  return /^https?:\/\/[^\s<>"'`]+$/i.test(s) && s.length <= 500 ? s : null;
}

export function libelleOffre(o: OffrePromo, devise = 'CHF'): string {
  if (estGratuite(o)) return `${o.duree_s} secondes — Gratuit`;
  const prix = Number.isInteger(o.prix) ? String(o.prix) : o.prix.toFixed(2);
  return `${o.duree_s} secondes — ${prix} ${devise}`;
}

/** Montant d'une promo de l'historique : « Gratuite » (jamais « 0 CHF payé »), sinon le prix. */
export function libelleMontant(p: { gratuit?: boolean | null; price_chf: number | string }, devise = 'CHF'): string {
  return p.gratuit ? 'Gratuite' : `${p.price_chf} ${devise}`;
}

export function libelleStatut(s: StatutPromo | string): string {
  return ({
    requested: 'En attente de l’hôte', rejected: 'Refusée', accepted: 'Acceptée — à payer',
    payment_pending: 'Paiement en cours', payment_failed: 'Paiement non abouti', ready: 'Payée — en attente de diffusion',
    broadcasting: 'En diffusion', completed: 'Diffusée', stopped_early: 'Arrêtée avant la fin',
  } as Record<string, string>)[s] || String(s);
}

/** Ce que l'hôte peut faire d'une demande, selon son statut SERVEUR. */
export function actionsHote(s: StatutPromo | string): Array<'accepter' | 'refuser' | 'diffuser' | 'arreter'> {
  if (s === 'requested') return ['refuser', 'accepter'];
  if (s === 'ready') return ['diffuser'];
  if (s === 'broadcasting') return ['arreter'];
  return [];
}

export const peutPayer = (s: StatutPromo | string) => s === 'accepted' || s === 'payment_failed' || s === 'payment_pending';
export const enAttenteHote = (liste: Array<{ status: string }>) => liste.filter((p) => p.status === 'requested').length;

/** Tarifs saisis par l'hôte → corps d'envoi (le serveur revalide tout). */
export function offresValides(offres: OffrePromo[]): string {
  for (const o of offres) {
    if (!Number.isInteger(o.duree_s) || o.duree_s < 5 || o.duree_s > 3600) return 'Durée entre 5 s et 3600 s';
    if (!estGratuite(o) && !(o.prix >= 0.5 && o.prix <= 10000)) return 'Prix entre 0.5 et 10000 CHF';   // payant : minimum inchangé
  }
  return '';
}

/**
 * 📣 05/10 — « Faire ma promo » dans le menu ⋮ du PARTICIPANT : que fait l'item ?
 *  - 'ouvrir'    : participant connecté, promo ouverte sur ce Live → fenêtre de demande (inchangé) ;
 *  - 'connexion' : invité SANS compte (« Gratuit par lien ») → l'item reste visible et explique
 *                  qu'un compte est nécessaire (le serveur exige toujours une identité pour la demande) ;
 *  - null        : hôte de CETTE session, ou promo fermée / aucune offre.
 * Le participant connecté garde EXACTEMENT le comportement de 855bb11/ed7016a ; l'invité sans compte
 * n'avait jamais l'item (`user &&` depuis 855bb11) : il le voit désormais, et il mène à la connexion.
 */
export function actionPromoParticipant(p: {
  estProprietaire: boolean; connecte: boolean;
  config: { enabled: boolean; offres: unknown[] } | null | undefined;
}): 'ouvrir' | 'connexion' | null {
  if (p.estProprietaire || !p.config?.enabled || !(p.config.offres || []).length) return null;
  return p.connecte ? 'ouvrir' : 'connexion';
}
