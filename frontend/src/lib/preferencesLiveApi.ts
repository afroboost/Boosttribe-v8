/**
 * ⚙️ 01/10 — Préférences Live du COACH (serveur : profiles.live_preferences).
 * Chaque Live a un nouveau code de session : on garde ici le dernier réglage ENREGISTRÉ par le
 * coach (mode d'entrée, droits des invités, promotions) pour que son prochain Live le reprenne.
 * Le serveur décide (hôte, session vierge) ; ce module ne fait que transporter.
 */
import { getAccessToken } from '@/lib/paymentApi';

const API_URL = (import.meta.env.REACT_APP_API_URL || '').replace(/\/$/, '');

export interface PreferencesLive { entree?: 'open' | 'private' | 'paid'; prix_chf?: number | null; capacite?: number | null; acces?: 'guest' | 'account' }

async function appel<T>(chemin: string, init: RequestInit = {}): Promise<T | null> {
  const t = await getAccessToken().catch(() => null);
  if (!t) return null;
  const r = await fetch(`${API_URL}${chemin}`, { ...init, headers: { ...(init.headers as Record<string, string> || {}), Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
  return r.ok ? ((await r.json().catch(() => null)) as T) : null;
}

export const lirePreferencesLive = async (): Promise<PreferencesLive> =>
  ((await appel<{ preferences: PreferencesLive }>('/coach/preferences-live'))?.preferences) || {};

export const memoriserDroitsInvites = (acces: 'guest' | 'account', sessionId?: string | null) =>
  appel('/coach/preferences-live', { method: 'PUT', body: JSON.stringify({ acces, session_id: sessionId || null }) });

/** 05/10 — Ouverture d'un Live par son hôte : le SERVEUR reprend le dernier mode d'entrée et les
 *  derniers droits des invités ENREGISTRÉS, sauf si ce Live a déjà été réglé à la main. */
export interface PreferencesAppliquees { applique: boolean; entree?: 'open' | 'private' | 'paid' | null; acces?: 'guest' | 'account' | null }
export const appliquerPreferencesLive = (sessionId: string) =>
  appel<PreferencesAppliquees>('/coach/preferences-live/appliquer', { method: 'POST', body: JSON.stringify({ session_id: sessionId }) });

/** Promotions : le SERVEUR les reprend seulement si ce Live n'a jamais été réglé. */
export const appliquerPreferencesPromo = (sessionId: string) =>
  appel<{ applique: boolean }>('/live-promo/appliquer-preferences', { method: 'POST', body: JSON.stringify({ session_id: sessionId }) });
