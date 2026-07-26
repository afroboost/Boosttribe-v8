// 🔗 Pont d'intégration iframe afroboost.
// Un abonné afroboost ouvre BoostTribe dans une iframe via /embed?bt_token=<JWT signé>.
// Ce module : (1) vérifie le jeton auprès du backend BoostTribe, (2) connecte l'utilisateur
// automatiquement (magic-link → verifyOtp), (3) déclenche le débit d'1 crédit côté afroboost
// au démarrage RÉEL d'une session, (4) informe la page parente (afroboost) par postMessage.
//
// ⚠️ Le secret partagé reste 100% côté backend — ce module ne manipule QUE le jeton signé opaque.
import { supabase } from '@/lib/supabaseClient';
import type { EmailOtpType } from '@supabase/supabase-js';

const API_URL = (import.meta.env.REACT_APP_API_URL || '').replace(/\/$/, '');
// Origine EXPLICITE de la page parente afroboost — cible de tous les postMessage (jamais '*').
const PARENT_ORIGIN = (import.meta.env.REACT_APP_AFROBOOST_ORIGIN || 'https://afroboost.com').replace(/\/$/, '');

const TOKEN_KEY = 'bt_embed_token';
const JTI_KEY = 'bt_embed_jti';
const CONSUMED_KEY = 'bt_embed_consumed'; // jti déjà consommé (anti double appel côté client)

export interface EmbedVerifyResult {
  ok: boolean;
  error?: string;
  user?: { email: string; name: string };
  jti?: string;
}

/** Sommes-nous dans le contexte d'accès afroboost (jeton mémorisé) ? */
export function isEmbedMode(): boolean {
  try { return !!sessionStorage.getItem(TOKEN_KEY); } catch { return false; }
}

function getStored(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function postToParent(message: Record<string, unknown>): void {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, PARENT_ORIGIN);
    }
  } catch { /* ignore */ }
}

/**
 * Vérifie le jeton afroboost côté backend puis connecte l'utilisateur (verifyOtp).
 * En cas de succès, mémorise le contexte embed (token + jti) pour le callback de crédit.
 */
export async function verifyEmbedToken(token: string): Promise<EmbedVerifyResult> {
  if (!API_URL) return { ok: false, error: 'Service indisponible (API non configurée).' };
  try {
    const res = await fetch(`${API_URL}/api/embed/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      const detail = (data as { detail?: string })?.detail;
      return { ok: false, error: detail || 'Session expirée, retournez sur afroboost.com' };
    }

    // Connexion automatique via le lien magique généré par le backend (aucun email envoyé).
    const login = (data as { login?: Record<string, string> }).login || {};
    if (supabase) {
      const type = (login.type as EmailOtpType) || 'magiclink';
      let signedIn = false;
      if (login.token_hash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: login.token_hash, type });
        signedIn = !error;
      }
      // Repli : OTP par email si le token_hash a échoué ou est absent.
      if (!signedIn && login.email && login.email_otp) {
        await supabase.auth.verifyOtp({ email: login.email, token: login.email_otp, type: 'email' });
      }
    }

    const jti = (data as { jti?: string }).jti;
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      if (jti) sessionStorage.setItem(JTI_KEY, String(jti));
    } catch { /* ignore */ }

    return { ok: true, user: (data as EmbedVerifyResult).user, jti };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur de vérification du jeton' };
  }
}

/**
 * Au démarrage RÉEL d'une session live (no-op hors mode embed).
 * Déclenche le débit d'1 crédit côté afroboost (idempotent sur jti) puis notifie le parent.
 * En cas de « no_credit », notifie une fin de session (le parent gère le CTA de recharge).
 */
export async function notifyEmbedSessionStarted(): Promise<void> {
  const token = getStored(TOKEN_KEY);
  if (!token) return; // pas en mode embed → aucun impact pour les utilisateurs normaux
  const jti = getStored(JTI_KEY) || '';

  // Déjà consommé pour ce jti → on se contente de re-signaler au parent.
  if (jti && getStored(CONSUMED_KEY) === jti) {
    postToParent({ type: 'bt:session-started', jti });
    return;
  }

  let ok = true;
  try {
    if (API_URL) {
      const res = await fetch(`${API_URL}/api/embed/session-started`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      ok = (data as { ok?: boolean }).ok !== false;
    }
  } catch { /* réseau → ne pas bloquer l'UX */ }

  try { if (jti) sessionStorage.setItem(CONSUMED_KEY, jti); } catch { /* ignore */ }

  if (!ok) {
    postToParent({ type: 'bt:session-ended', jti });
    return;
  }
  postToParent({ type: 'bt:session-started', jti });
}

/** Fin de session (no-op hors mode embed) → informe le parent afroboost. */
export function notifyEmbedSessionEnded(): void {
  const token = getStored(TOKEN_KEY);
  if (!token) return;
  const jti = getStored(JTI_KEY) || '';
  postToParent({ type: 'bt:session-ended', jti });
}
