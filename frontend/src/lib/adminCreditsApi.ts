import supabase from '@/lib/supabaseClient';

// Base de l'API (backend) — ex. https://pay.boosttribe.pro
const API_URL = (import.meta.env.REACT_APP_API_URL || '').replace(/\/$/, '');

// 🔑 Récupère un token FRAIS : rafraîchit si la session est absente ou si le token
// expire dans moins de 60s (évite les "Token invalide" périmés). Version minimale,
// alignée sur paymentApi.ts (sans la sérialisation partagée — ces appels sont séquentiels).
async function getAccessToken(forceRefresh = false): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0;
  if (forceRefresh || !session || expiresAtMs - Date.now() < 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed.session ?? session;
  }
  return session?.access_token ?? null;
}

// 🔐 Helper central des appels admin : token frais + retry unique sur 401.
async function adminFetch(path: string, init?: RequestInit): Promise<{ data?: any; error?: string }> {
  if (!API_URL) return { error: 'API non configurée (REACT_APP_API_URL)' };
  let token = await getAccessToken();
  if (!token) return { error: 'Session expirée, reconnectez-vous' };
  const doFetch = (tok: string) => fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}`, ...(init?.headers || {}) },
  });
  try {
    let res = await doFetch(token);
    if (res.status === 401) {
      const fresh = await getAccessToken(true);
      if (fresh) { token = fresh; res = await doFetch(token); }
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

// ===========================================================================
// 3a) Historique « Crédits offerts » — éditable (MODIFIER / SUPPRIMER)
// ===========================================================================
export interface CreditGrant {
  id: number;
  email: string;
  amount: number;
  note: string | null;
  created_at: string;
}

/** GET /admin/credit-grants → { grants: CreditGrant[] } */
export async function listCreditGrants(): Promise<{ grants: CreditGrant[]; error?: string }> {
  const { data, error } = await adminFetch('/admin/credit-grants', { method: 'GET' });
  if (error) return { grants: [], error };
  return { grants: (data?.grants || []) as CreditGrant[] };
}

/** PATCH /admin/credit-grants/{id} body { amount?, note? } → { ok: true } */
export async function updateCreditGrant(
  id: number,
  payload: { amount?: number; note?: string },
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch(`/admin/credit-grants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok };
}

/** DELETE /admin/credit-grants/{id} → { ok: true } */
export async function deleteCreditGrant(id: number): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch(`/admin/credit-grants/${id}`, { method: 'DELETE' });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok };
}

// ===========================================================================
// 3b) Essai gratuit → paiement automatique (prépare le flux Stripe récurrent)
// ===========================================================================
export interface TrialConfig {
  trial_days: number;
  auto_charge_enabled: boolean;
}

/** GET /admin/trial-config → { trial_days, auto_charge_enabled } */
export async function getTrialConfig(): Promise<{ data?: TrialConfig; error?: string }> {
  const { data, error } = await adminFetch('/admin/trial-config', { method: 'GET' });
  if (error) return { error };
  return {
    data: {
      trial_days: Number(data?.trial_days ?? 0),
      auto_charge_enabled: !!data?.auto_charge_enabled,
    },
  };
}

/** POST /admin/trial-config body { trial_days, auto_charge_enabled } → { ok: true } */
export async function saveTrialConfig(payload: TrialConfig): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch('/admin/trial-config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok };
}
