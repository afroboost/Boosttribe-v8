import supabase from '@/lib/supabaseClient';

// Base de l'API de paiement (backend Stripe) — ex. https://pay.boosttribe.pro
const API_URL = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');

export type StripePlan = 'pro' | 'enterprise';
export type StripeInterval = 'month' | 'year';

async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export interface SyncPlanPayload {
  plan: StripePlan;
  monthly_price: number | null;
  annual_price: number | null;
  currency?: string;
}

/**
 * Synchronise les prix Stripe d'un plan (admin uniquement).
 * Ne lève jamais : renvoie { ok, error } pour ne pas casser la sauvegarde du CMS.
 */
export async function syncPlan(payload: SyncPlanPayload): Promise<{ ok: boolean; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API de paiement non configurée (REACT_APP_API_URL)' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Session expirée, reconnectez-vous' };

  try {
    const res = await fetch(`${API_URL}/stripe/sync-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currency: 'eur', ...payload }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/**
 * Crée une session Stripe Checkout pour l'utilisateur connecté.
 * Renvoie l'URL de redirection Stripe (ou une erreur).
 */
export async function createCheckout(
  plan: StripePlan,
  interval: StripeInterval,
): Promise<{ url?: string; error?: string }> {
  if (!API_URL) return { error: 'API de paiement non configurée (REACT_APP_API_URL)' };
  const token = await getAccessToken();
  if (!token) return { error: 'Connectez-vous pour souscrire' };

  try {
    const res = await fetch(`${API_URL}/stripe/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan, interval }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { url: data.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}
