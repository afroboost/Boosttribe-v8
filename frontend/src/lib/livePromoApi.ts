/** 📣 Promo Live — appels au backend (même base et même jeton que la billetterie). */
import { getAccessToken } from '@/lib/paymentApi';
import type { OffrePromo, PromoPublique } from '@/lib/livePromo';

const API_URL = (import.meta.env.REACT_APP_API_URL || '').replace(/\/$/, '');

async function appel<T>(chemin: string, init: RequestInit = {}, auth: boolean | 'si-connecte' = true): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
  if (auth) {
    const t = await getAccessToken().catch(() => null);
    if (!t && auth === true) throw new Error('Connecte-toi pour continuer');
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${API_URL}${chemin}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data && data.detail) || `Erreur ${res.status}`);
  return data as T;
}
const json = (corps: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });

export interface PromoLigne { id: string; status: string; title: string; body?: string; media_url?: string | null;
  external_url?: string | null; participant_name?: string; duration_seconds: number; price_chf: number;
  actual_duration_seconds?: number | null; started_at?: string | null; ends_at?: string | null; stop_reason?: string | null }

// 01/10 : jeton joint SI connecté → `est_hote` dit par le serveur (identité vs host_id de CETTE session).
export const promoConfig = (sid: string) =>
  appel<{ eligible: boolean; enabled: boolean; offres: OffrePromo[]; currency: string; paiement_reel?: boolean; est_hote?: boolean | null }>(`/live-promo/config/${encodeURIComponent(sid)}`, {}, 'si-connecte');
export const promoConfigHote = (sid: string) =>
  appel<{ eligible: boolean; enabled: boolean; offres: OffrePromo[]; currency: string; mode?: string | null; paiement_reel?: boolean }>(`/live-promo/host-config/${encodeURIComponent(sid)}`);
// `auDepart` : la page se ferme → `keepalive` (le navigateur n'annule pas l'envoi à la navigation).
export const promoEnregistrerConfig = (sid: string, enabled: boolean, offres: OffrePromo[], auDepart = false) =>
  appel<{ ok: boolean; offres?: OffrePromo[]; enabled?: boolean }>('/live-promo/config', { ...json({ session_id: sid, enabled, offres }), ...(auDepart ? { keepalive: true } : {}) });
export const promoActive = (sid: string) =>
  appel<{ promo: PromoPublique | null; server_now: string }>(`/live-promo/active/${encodeURIComponent(sid)}`, {}, false);
export const promoMesDemandes = (sid: string) => appel<{ promos: PromoLigne[] }>(`/live-promo/mine/${encodeURIComponent(sid)}`);
export const promoListeHote = (sid: string) => appel<{ promos: PromoLigne[] }>(`/live-promo/host/${encodeURIComponent(sid)}`);
export const promoDemander = (corps: { session_id: string; offre_id: string; titre: string; texte: string; media_url?: string | null; lien?: string | null }) =>
  appel<{ promo: PromoLigne }>('/live-promo/requests', json(corps));
export const promoDecider = (id: string, decision: 'accept' | 'reject') =>
  appel<{ promo: PromoLigne }>(`/live-promo/requests/${id}/decision`, json({ decision }));
export const promoPayer = (id: string) => appel<{ url: string }>(`/live-promo/requests/${id}/pay`, json({}));
/** Super-admin hors mode commission : prêt SANS paiement (test, aucun argent). */
export const promoPretSansPaiement = (id: string) => appel<{ promo: PromoLigne }>(`/live-promo/requests/${id}/test-ready`, json({}));
export const promoDiffuser = (id: string) =>
  appel<{ promo: PromoPublique; server_now: string }>(`/live-promo/requests/${id}/start`, json({}));
export const promoArreter = (id: string, raison?: string) =>
  appel<{ promo: PromoLigne }>(`/live-promo/requests/${id}/stop`, json({ raison: raison || null }));
export async function promoEnvoyerImage(sid: string, fichier: File): Promise<string> {
  const f = new FormData();
  f.append('file', fichier);
  f.append('session_id', sid);
  return (await appel<{ url: string }>('/live-promo/media', { method: 'POST', body: f })).url;
}
