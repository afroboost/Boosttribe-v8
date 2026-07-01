import supabase from '@/lib/supabaseClient';

// Base de l'API de paiement (backend Stripe) — ex. https://pay.boosttribe.pro
const API_URL = (import.meta.env.REACT_APP_API_URL || '').replace(/\/$/, '');

export type StripePlan = 'pro' | 'enterprise';
export type StripeInterval = 'month' | 'year';

// 🔑 Toujours renvoyer un token FRAIS : rafraîchit explicitement si la session est
// absente ou si le token expire dans moins de 60s (évite les "Token invalide" périmés).
//
// ⚠️ CONCURRENCE : plusieurs sections admin chargent en parallèle (Promise.all). Si
// chacune appelait refreshSession() en même temps, la rotation simultanée du refresh-token
// invaliderait les autres → "Session expirée / token invalide". On SÉRIALISE donc la
// récupération du token via une promesse partagée : un seul refresh à la fois, réutilisé
// par tous les appels concurrents.
let _tokenInFlight: Promise<string | null> | null = null;

async function getAccessToken(forceRefresh = false): Promise<string | null> {
  // Un refresh est déjà en cours → on le réutilise (sauf si on EXIGE un token tout frais).
  if (_tokenInFlight && !forceRefresh) return _tokenInFlight;
  const run = (async () => {
    // Si on force, on attend d'abord la fin d'un éventuel refresh en cours (sérialisation).
    if (forceRefresh && _tokenInFlight) { try { await _tokenInFlight; } catch { /* ignore */ } }
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    let session = data.session;
    const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0;
    if (forceRefresh || !session || expiresAtMs - Date.now() < 60_000) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      session = refreshed.session ?? session;
    }
    return session?.access_token ?? null;
  })();
  _tokenInFlight = run.finally(() => { if (_tokenInFlight === run) _tokenInFlight = null; });
  return _tokenInFlight;
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

// ===========================================================================
// 💳 CRÉDITS (nouveau modèle — remplace les abonnements)
// ===========================================================================
export interface CreditPack {
  id: number;
  name: string;
  credits: number;
  price_chf: number;
  currency: string;
  is_highlighted: boolean;
  audience: 'participant' | 'creator';
  sort: number;
  active: boolean;
}

export interface CreditsConfig {
  packs: CreditPack[];
  services_shown: string[];
  offers: Record<string, any>;
  cost_join: number;
  cost_host: number;
  cost_record_transcribe: number;
  credit_validity_months: number;
  signup_free_credits: number;
  currency: string;
}

/** Config publique (page tarifaire + assistant) : packs actifs + offres + réglages. */
export async function getCreditsConfig(): Promise<{ data?: CreditsConfig; error?: string }> {
  if (!API_URL) return { error: 'API non configurée (REACT_APP_API_URL)' };
  try {
    const res = await fetch(`${API_URL}/credits/config`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { data: data as CreditsConfig };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

export interface LedgerRow {
  delta: number;
  reason: string;
  note: string | null;
  created_at: string;
  expires_at: string | null;
}

/** Solde + historique récent de l'utilisateur connecté. */
export async function getMyCredits(): Promise<{ balance: number; ledger: LedgerRow[]; error?: string }> {
  if (!API_URL) return { balance: 0, ledger: [], error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { balance: 0, ledger: [] };
  try {
    const res = await fetch(`${API_URL}/credits/me`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { balance: 0, ledger: [], error: data?.detail || `Erreur ${res.status}` };
    return { balance: data.balance || 0, ledger: data.ledger || [] };
  } catch (e) {
    return { balance: 0, ledger: [], error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Réclame le 1er cours offert (idempotent côté backend). */
export async function claimSignupBonus(): Promise<{ balance?: number; granted?: number; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { error: 'Connectez-vous' };
  try {
    const res = await fetch(`${API_URL}/credits/signup-bonus`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { balance: data.balance, granted: data.granted };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Débite un crédit pour rejoindre (join) ou animer (host) un live. 402 si solde insuffisant. */
export async function spendCredit(
  action: 'join' | 'host',
  sessionId: string,
): Promise<{ ok: boolean; balance?: number; spent?: number; insufficient?: boolean; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Connectez-vous' };
  try {
    const res = await fetch(`${API_URL}/credits/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, session_id: sessionId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 402) return { ok: false, insufficient: true, error: data?.detail || 'Crédits insuffisants' };
    if (!res.ok) return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    return { ok: true, balance: data.balance, spent: data.spent };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Achat d'un pack de crédits → URL Stripe Checkout (paiement unique CHF). */
export async function buyCredits(packId: number): Promise<{ url?: string; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { error: 'Connectez-vous pour acheter des crédits' };
  try {
    const res = await fetch(`${API_URL}/stripe/buy-credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pack_id: packId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { url: data.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

// ---- Admin crédits : offrir des crédits + config (packs / réglages) --------
export interface CreditOfferRow {
  id: number;
  user_id: string;
  email: string | null;
  delta: number;
  note: string | null;
  created_at: string;
  expires_at: string | null;
}

export async function offerCredits(payload: {
  email?: string;
  user_id?: string;
  credits: number;
  note?: string;
}): Promise<{ ok: boolean; balance?: number; error?: string }> {
  const { data, error } = await adminFetch('/admin/offer-credits', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok, balance: data?.balance };
}

export async function listCreditOffers(): Promise<{ offers: CreditOfferRow[]; error?: string }> {
  const { data, error } = await adminFetch('/admin/credit-offers', { method: 'GET' });
  if (error) return { offers: [], error };
  return { offers: (data?.offers || []) as CreditOfferRow[] };
}

export interface PricingSettings {
  services_shown: string[];
  offers: Record<string, any>;
  cost_join: number;
  cost_host: number;
  cost_record_transcribe: number;
  credit_validity_months: number;
  signup_free_credits: number;
}

export async function getCreditAdminConfig(): Promise<{ packs: CreditPack[]; settings: PricingSettings | null; error?: string }> {
  const { data, error } = await adminFetch('/admin/credit-config', { method: 'GET' });
  if (error) return { packs: [], settings: null, error };
  return { packs: (data?.packs || []) as CreditPack[], settings: (data?.settings || null) as PricingSettings | null };
}

export async function saveCreditPack(pack: Partial<CreditPack> & { name: string; credits: number; price_chf: number }): Promise<{ ok: boolean; pack?: CreditPack; error?: string }> {
  const { data, error } = await adminFetch('/admin/credit-packs', {
    method: 'POST',
    body: JSON.stringify(pack),
  });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok, pack: data?.pack };
}

export async function deleteCreditPack(packId: number): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch(`/admin/credit-packs/${packId}`, { method: 'DELETE' });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok };
}

export async function savePricingSettings(settings: Partial<PricingSettings>): Promise<{ ok: boolean; settings?: PricingSettings; error?: string }> {
  const { data, error } = await adminFetch('/admin/pricing-settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok, settings: data?.settings };
}

// ===========================================================================
// 🎟️ BILLETTERIE COACH — sessions payantes (CHF) + PORTEFEUILLE IBAN (Spordateur)
//   PAS de Stripe Connect : paiement sur le compte plateforme, part coach (prix -
//   commission) créditée au SOLDE, IBAN + demandes de virement traitées par l'admin.
// ===========================================================================
export interface SessionAccessInfo {
  mode: 'open' | 'paid' | 'private';
  price_chf: number | null;
  capacity: number | null;
  sold: number;
  sold_out: boolean;
  currency: string;
  record_enabled?: boolean;
}

export interface RecordingRow {
  id: number;
  session_id: string;
  audio_url: string | null;
  transcript: string | null;
  summary: string | null;
  status: 'processing' | 'done' | 'error';
  error: string | null;
  created_at: string;
}

export interface BilletterieConfig {
  currency: string;
  price_min_chf: number;
  price_max_chf: number;
  commission_percent: number;
  coach_sub_price_chf: number;
}

export interface TicketRow {
  id: number;
  session_id: string;
  buyer_user_id: string | null;
  buyer_email: string | null;
  coach_user_id: string | null;
  amount_chf: number;
  commission_chf: number;
  commission_percent: number | null;
  status: 'paid' | 'refunded';
  created_at: string;
  coach_email?: string | null;
  buyer_email_resolved?: string | null;
}

export interface CoachSales {
  tickets: TicketRow[];
  count_paid: number;
  gross_chf: number;
  commission_chf: number;
  net_chf: number;
}

export interface WalletLedgerRow {
  id: number;
  delta_chf: number;
  reason: 'sale' | 'commission' | 'withdrawal' | 'refund';
  ref: string | null;
  created_at: string;
}

export interface PayoutRow {
  id: number;
  user_id: string;
  amount_chf: number;
  iban: string | null;
  status: 'requested' | 'paid' | 'rejected';
  created_at: string;
  paid_at: string | null;
  coach_email?: string | null;
  coach_name?: string | null;
}

export interface CoachWallet {
  balance_chf: number;
  available_chf: number;
  total_revenue_chf: number;
  pending_chf: number;
  payout_count: number;
  iban: string | null;
  holder: string | null;
  has_iban: boolean;
  requests: PayoutRow[];
  ledger: WalletLedgerRow[];
}

export interface CommissionSettings {
  commission_percent: number;
  fees_included: boolean;
  launch_offer: { active: boolean; percent: number; scope: string; days: number };
  price_min_chf: number;
  price_max_chf: number;
  currency: string;
  coach_sub_price_chf: number;
}

export interface CoachPlan {
  payment_type: 'subscription' | 'commission';
  unlimited: boolean;
  subscription_active: boolean;
  subscription_status: string | null;
  current_period_end: string | null;
  sub_price_chf: number;
  commission_percent: number;
  currency: string;
}

export interface AdminCoach {
  id: string;
  email: string | null;
  full_name: string | null;
  coach_payment_type: 'subscription' | 'commission';
  subscription_status: string | null;
  subscription_active: boolean;
  current_period_end: string | null;
}

/** Réglages publics (devise + garde-fous de prix) pour l'UI coach. */
export async function getBilletterieConfig(): Promise<{ data?: BilletterieConfig; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  try {
    const res = await fetch(`${API_URL}/billetterie/config`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { data: data as BilletterieConfig };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Infos d'accès publiques d'une session (mode/prix/capacité/places restantes). */
export async function getSessionAccessInfo(sessionId: string): Promise<{ data?: SessionAccessInfo; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  try {
    const res = await fetch(`${API_URL}/session/info/${encodeURIComponent(sessionId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { data: data as SessionAccessInfo };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Coach : portefeuille complet (solde dispo, revenus, IBAN, demandes, historique). */
export async function getCoachWallet(): Promise<{ data?: CoachWallet; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { error: 'Connectez-vous' };
  try {
    const res = await fetch(`${API_URL}/coach/wallet`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { data: data as CoachWallet };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Coach : enregistre/maj son IBAN + titulaire. */
export async function saveCoachBank(iban: string, holder: string): Promise<{ ok: boolean; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Connectez-vous' };
  try {
    const res = await fetch(`${API_URL}/coach/bank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ iban, holder }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    return { ok: !!data?.ok };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Coach : demande un virement de tout son solde disponible. */
export async function requestPayout(): Promise<{ ok: boolean; amount_chf?: number; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Connectez-vous' };
  try {
    const res = await fetch(`${API_URL}/coach/payout-request`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    return { ok: !!data?.ok, amount_chf: data?.amount_chf };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Coach : plan (type de paiement + état de l'abonnement « Illimité »). */
export async function getCoachPlan(): Promise<{ data?: CoachPlan; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { error: 'Connectez-vous' };
  try {
    const res = await fetch(`${API_URL}/coach/plan`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { data: data as CoachPlan };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Coach : s'abonner à « Coach Illimité » → URL Stripe Checkout (abonnement récurrent CHF). */
export async function subscribeCoach(): Promise<{ url?: string; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { error: 'Connectez-vous' };
  try {
    const res = await fetch(`${API_URL}/coach/subscribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { url: data.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Coach : tableau de bord des ventes (billets + totaux). */
export async function getCoachSales(): Promise<{ data?: CoachSales; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { error: 'Connectez-vous' };
  try {
    const res = await fetch(`${API_URL}/coach/sales`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { data: data as CoachSales };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Hôte : configure le mode d'accès d'une session (ouverte / payante / privée). */
export async function configureSession(payload: {
  session_id: string;
  mode: 'open' | 'paid' | 'private';
  price_chf?: number | null;
  capacity?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Connectez-vous' };
  try {
    const res = await fetch(`${API_URL}/session/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    return { ok: !!data?.ok };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Participant : achète une place → URL Stripe Checkout (CHF). */
export async function buyTicket(sessionId: string): Promise<{ url?: string; already?: boolean; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { error: 'Connectez-vous pour acheter votre place' };
  try {
    const res = await fetch(`${API_URL}/tickets/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { url: data.url, already: data.already };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/**
 * Participant : a-t-il un billet valide pour cette session ?
 * `requestId` (optionnel) = id d'une demande d'accès APPROUVÉE → permet à un participant ANONYME
 *  (sans compte) d'être reconnu comme ayant accès (chemin public par id, vérifié côté backend).
 */
export async function checkTicket(sessionId: string, requestId?: number | null): Promise<{ has_ticket: boolean; error?: string }> {
  if (!API_URL) return { has_ticket: false, error: 'API non configurée' };
  const token = await getAccessToken();
  // ⚠️ Sans token MAIS avec une demande approuvée (requestId) → on interroge quand même (accès anonyme).
  if (!token && !requestId) return { has_ticket: false };
  try {
    const qs = requestId ? `?request_id=${encodeURIComponent(String(requestId))}` : '';
    const res = await fetch(`${API_URL}/tickets/check/${encodeURIComponent(sessionId)}${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { has_ticket: false, error: data?.detail || `Erreur ${res.status}` };
    return { has_ticket: !!data.has_ticket };
  } catch (e) {
    return { has_ticket: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

// ---- 🔴 Enregistrement complet + transcription IA (option premium crédits) ----
/** Hôte : active l'option (débite les crédits sauf abo illimité + active le consentement). */
export async function startRecording(sessionId: string): Promise<{ ok: boolean; cost?: number; insufficient?: boolean; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Connectez-vous' };
  try {
    const res = await fetch(`${API_URL}/session/record/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, insufficient: res.status === 402, error: data?.detail || `Erreur ${res.status}` };
    return { ok: true, cost: data.cost };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Hôte : désactive le consentement d'enregistrement. */
export async function stopRecording(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false };
  try {
    const res = await fetch(`${API_URL}/session/record/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId }),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Hôte : envoie l'audio complet → transcription FR + résumé (synchrone). */
export async function uploadRecording(sessionId: string, blob: Blob, ext = 'webm'): Promise<{ ok: boolean; id?: number; transcript?: string; summary?: string; status?: string; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Connectez-vous' };
  try {
    const form = new FormData();
    form.append('file', blob, `session.${ext}`);
    form.append('session_id', sessionId);
    const res = await fetch(`${API_URL}/session/record/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    return { ok: !!data.ok, id: data.id, transcript: data.transcript, summary: data.summary, status: data.status, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Hôte : liste de ses enregistrements + transcriptions. */
export async function getRecordings(): Promise<{ recordings: RecordingRow[]; error?: string }> {
  if (!API_URL) return { recordings: [], error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { recordings: [] };
  try {
    const res = await fetch(`${API_URL}/session/recordings`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { recordings: [], error: data?.detail || `Erreur ${res.status}` };
    return { recordings: (data.recordings || []) as RecordingRow[] };
  } catch (e) {
    return { recordings: [], error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** « Ma session » : récupère la dernière session de l'utilisateur (host_id = uid) depuis la DB. */
export async function getMyLastSession(): Promise<{ sessionId: string | null; error?: string }> {
  if (!API_URL) return { sessionId: null, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { sessionId: null, error: 'Non authentifié' };
  try {
    const res = await fetch(`${API_URL}/session/my-last`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { sessionId: null, error: data?.detail || `Erreur ${res.status}` };
    return { sessionId: data.session_id || null };
  } catch (e) {
    return { sessionId: null, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Miniature PROPRE d'un lien vidéo (og:image/oEmbed) — sans le « chrome » de la plateforme. Public. */
export async function getVideoThumbnail(url: string): Promise<{ thumbnail_url: string | null; video_url: string }> {
  if (!API_URL) return { thumbnail_url: null, video_url: url };
  try {
    const res = await fetch(`${API_URL}/promo/thumbnail?url=${encodeURIComponent(url)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { thumbnail_url: null, video_url: url };
    return { thumbnail_url: data.thumbnail_url || null, video_url: data.video_url || url };
  } catch {
    return { thumbnail_url: null, video_url: url };
  }
}

// ───────────────────────── PAGE PROMO / AFFICHE DE SESSION ─────────────────────────
export interface PromoConfig {
  session_id?: string;
  enabled?: boolean;
  media_url?: string | null;
  media_type?: 'image' | 'video' | null;
  description?: string | null;
  cta_text?: string | null;
  payment_link?: string | null;  // vide = gratuit
  price?: string | null;
  format?: '9:16' | '16:9' | null;  // cadrage de l'affiche/vidéo
  allow_access_requests?: boolean;  // autoriser « Demander l'accès » (sans payer)
  access_mode?: 'guest' | 'account' | null;  // 'guest' = entrée directe sans inscription
}

/** Participant : demande l'accès gratuit à une session payante (l'hôte approuve/refuse). */
export async function requestSessionAccess(sessionId: string, requesterName: string): Promise<{ ok: boolean; id?: number; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  try {
    const res = await fetch(`${API_URL}/session/access-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ session_id: sessionId, requester_name: requesterName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/**
 * Suivi PUBLIC (sans auth) du statut d'une demande d'accès par son id.
 * Permet à un demandeur ANONYME de savoir si l'hôte a approuvé (la RLS ne le laisserait pas lire sa ligne).
 */
export async function getAccessRequestStatus(requestId: number): Promise<{ status?: 'pending' | 'approved' | 'refused'; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  try {
    const res = await fetch(`${API_URL}/session/access-request/${encodeURIComponent(String(requestId))}/status`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { status: data.status };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Hôte : liste des demandes d'accès en attente pour sa session. */
export async function listAccessRequests(sessionId: string): Promise<{ requests: Array<{ id: number; requester_name: string; requester_user_id: string | null; status: string; created_at: string }>; error?: string }> {
  if (!API_URL) return { requests: [], error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { requests: [] };
  try {
    const res = await fetch(`${API_URL}/session/access-requests/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { requests: [], error: data?.detail || `Erreur ${res.status}` };
    return { requests: data.requests || [] };
  } catch (e) {
    return { requests: [], error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Hôte : approuve/refuse une demande d'accès. */
export async function decideAccessRequest(requestId: number, approve: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Non authentifié' };
  try {
    const res = await fetch(`${API_URL}/session/access-request/${requestId}/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ approve }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Lecture PUBLIQUE de la page promo (lien partageable, pas d'auth requise). */
export async function getPromo(sessionId: string): Promise<{ promo: PromoConfig | null; error?: string }> {
  if (!API_URL) return { promo: null, error: 'API non configurée' };
  try {
    const res = await fetch(`${API_URL}/session/promo/${encodeURIComponent(sessionId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { promo: null, error: data?.detail || `Erreur ${res.status}` };
    return { promo: data as PromoConfig };
  } catch (e) {
    return { promo: null, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Enregistre la config de la page promo (coach/hôte). */
export async function savePromo(promo: PromoConfig & { session_id: string }): Promise<{ ok: boolean; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Non authentifié' };
  try {
    const res = await fetch(`${API_URL}/session/promo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(promo),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Upload de l'affiche/vidéo 9:16 de la page promo. Renvoie l'URL publique + le type. */
export async function uploadPromoMedia(sessionId: string, file: File): Promise<{ url?: string; media_type?: 'image' | 'video'; error?: string }> {
  if (!API_URL) return { error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { error: 'Non authentifié' };
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('session_id', sessionId);
    const res = await fetch(`${API_URL}/session/promo/media`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { url: data.url, media_type: data.media_type };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

/** Supprime un enregistrement : fichier serveur (bucket) + ligne en base. Coach = ses propres ; admin = tous. */
export async function deleteRecording(id: number): Promise<{ ok: boolean; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Non authentifié' };
  try {
    const res = await fetch(`${API_URL}/session/recordings/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

// ---- Admin : clé IA (OpenAI) -----------------------------------------------
export async function getAiKeys(): Promise<{ configured: boolean; last4: string; source: string; error?: string }> {
  const { data, error } = await adminFetch('/admin/ai-keys', { method: 'GET' });
  if (error) return { configured: false, last4: '', source: 'none', error };
  return { configured: !!data?.configured, last4: data?.last4 || '', source: data?.source || 'none' };
}

export async function saveAiKey(openaiKey: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch('/admin/ai-keys', {
    method: 'POST',
    body: JSON.stringify({ openai_key: openaiKey }),
  });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok };
}

// ---- Admin : Billetterie & Commission --------------------------------------
export async function getCommissionConfig(): Promise<{ settings?: CommissionSettings; error?: string }> {
  const { data, error } = await adminFetch('/admin/commission-config', { method: 'GET' });
  if (error) return { error };
  return { settings: data?.settings as CommissionSettings };
}

export async function saveCommissionSettings(settings: Partial<CommissionSettings>): Promise<{ ok: boolean; settings?: CommissionSettings; error?: string }> {
  const { data, error } = await adminFetch('/admin/commission-settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok, settings: data?.settings };
}

export async function getBilletterieSales(): Promise<{ sales: TicketRow[]; count_paid: number; gross_chf: number; commission_chf: number; error?: string }> {
  const { data, error } = await adminFetch('/admin/billetterie/sales', { method: 'GET' });
  if (error) return { sales: [], count_paid: 0, gross_chf: 0, commission_chf: 0, error };
  return {
    sales: (data?.sales || []) as TicketRow[],
    count_paid: data?.count_paid || 0,
    gross_chf: data?.gross_chf || 0,
    commission_chf: data?.commission_chf || 0,
  };
}

// ---- Admin : Virements (payouts) -------------------------------------------
export async function getAdminPayouts(): Promise<{ payouts: PayoutRow[]; pending_total_chf: number; error?: string }> {
  const { data, error } = await adminFetch('/admin/payouts', { method: 'GET' });
  if (error) return { payouts: [], pending_total_chf: 0, error };
  return { payouts: (data?.payouts || []) as PayoutRow[], pending_total_chf: data?.pending_total_chf || 0 };
}

export async function markPayoutPaid(payoutId: number): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch(`/admin/payouts/${payoutId}/pay`, { method: 'POST' });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok };
}

export async function rejectPayout(payoutId: number): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch(`/admin/payouts/${payoutId}/reject`, { method: 'POST' });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok };
}

// ---- Admin : gestion des coachs (type de paiement + statut abo) -------------
export async function getAdminCoaches(): Promise<{ coaches: AdminCoach[]; error?: string }> {
  const { data, error } = await adminFetch('/admin/coaches', { method: 'GET' });
  if (error) return { coaches: [], error };
  return { coaches: (data?.coaches || []) as AdminCoach[] };
}

export async function setCoachPaymentType(userId: string, paymentType: 'subscription' | 'commission'): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch('/admin/coach-payment-type', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, payment_type: paymentType }),
  });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok };
}

// ---------------------------------------------------------------------------
// POINT 6 : accès offerts (admin) — DÉPRÉCIÉ (conservé pour compat)
// ---------------------------------------------------------------------------
export interface GrantedRow {
  id: string;
  email: string;
  comp_access_plan: string | null;
  comp_access_until: string | null;
}

// 🔐 Helper CENTRAL de TOUS les appels admin : envoie un token FRAIS, et si le backend
// renvoie 401 (token rejeté/périmé), force un refresh et réessaie UNE fois. Toutes les
// sections admin passent par ici → le bug "token invalide" ne peut plus se répéter.
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
      // Token rejeté par le backend → on force un token tout neuf et on réessaie une fois.
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

// D : liste de tous les utilisateurs
export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  subscription_status: string | null;
  comp_access_plan: string | null;
  comp_access_until: string | null;
  created_at: string | null;
}

export async function listUsers(): Promise<{ users: AdminUser[]; error?: string }> {
  const { data, error } = await adminFetch('/admin/users', { method: 'GET' });
  if (error) return { users: [], error };
  return { users: (data?.users || []) as AdminUser[] };
}

// PARTIE C : clés Stripe (publique en clair, secrète chiffrée côté serveur)
export interface StripeKeysState {
  public_key: string;
  secret_configured: boolean;
  secret_last4: string;
  secret_source?: string;
  secret_key?: string; // présent uniquement si reveal=true
}

export async function getStripeKeys(reveal = false): Promise<{ data?: StripeKeysState; error?: string }> {
  const { data, error } = await adminFetch(`/admin/stripe-keys${reveal ? '?reveal=true' : ''}`, { method: 'GET' });
  if (error) return { error };
  return { data: data as StripeKeysState };
}

export async function saveStripeKeys(payload: { public_key?: string; secret_key?: string }): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await adminFetch('/admin/stripe-keys', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (error) return { ok: false, error };
  return { ok: !!data?.ok };
}

// F : autorité hôte / co-animateurs (source de vérité serveur)
export async function claimHost(sessionId: string): Promise<{ ok: boolean; host_id?: string }> {
  if (!API_URL) return { ok: false };
  const token = await getAccessToken();
  if (!token) return { ok: false };
  try {
    const res = await fetch(`${API_URL}/session/claim-host`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: !!data?.ok, host_id: data?.host_id };
  } catch {
    return { ok: false };
  }
}

export async function setCohosts(sessionId: string, cohosts: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!API_URL) return { ok: false, error: 'API non configurée' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Session expirée' };
  try {
    const res = await fetch(`${API_URL}/session/cohosts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId, cohosts }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.detail || `Erreur ${res.status}` };
    return { ok: !!data?.ok };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}

// E : upload d'une vidéo de session (hôte) → backend (bucket session-media, suppression auto 24h)
export async function uploadSessionVideo(
  file: File,
  sessionId: string,
): Promise<{ url?: string; error?: string }> {
  if (!API_URL) return { error: 'API non configurée (REACT_APP_API_URL)' };
  const token = await getAccessToken();
  if (!token) return { error: 'Connectez-vous pour partager' };
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('session_id', sessionId);
    const res = await fetch(`${API_URL}/session/upload-video`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.detail || `Erreur ${res.status}` };
    return { url: data.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Backend injoignable' };
  }
}
