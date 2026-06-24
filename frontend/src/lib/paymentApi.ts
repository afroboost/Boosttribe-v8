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

// ---------------------------------------------------------------------------
// POINT 6 : accès offerts (admin)
// ---------------------------------------------------------------------------
export interface GrantedRow {
  id: string;
  email: string;
  comp_access_plan: string | null;
  comp_access_until: string | null;
}

async function adminFetch(path: string, init?: RequestInit): Promise<{ data?: any; error?: string }> {
  if (!API_URL) return { error: 'API non configurée (REACT_APP_API_URL)' };
  const token = await getAccessToken();
  if (!token) return { error: 'Session expirée, reconnectez-vous' };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

export async function grantAccess(payload: {
  email?: string;
  user_id?: string;
  plan: StripePlan;
  until: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch('/admin/grant-access', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return error ? { ok: false, error } : { ok: !!data?.ok };
}

export async function revokeAccess(userId: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch('/admin/revoke-access', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
  return error ? { ok: false, error } : { ok: !!data?.ok };
}

export async function listGranted(): Promise<{ granted: GrantedRow[]; error?: string }> {
  const { data, error } = await adminFetch('/admin/granted', { method: 'GET' });
  if (error) return { granted: [], error };
  return { granted: (data?.granted || []) as GrantedRow[] };
}
