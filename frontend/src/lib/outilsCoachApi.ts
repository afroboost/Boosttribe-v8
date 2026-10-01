/**
 * 🎓 01/10 — Outils d'un Live hébergé par un ESPACE COACH (Prompteur, Enregistrement pendant le
 * Live, gestion des Promotions) : c'est le SERVEUR qui décide, pour CETTE session et CE compte.
 * Aucun rôle global, aucune valeur locale : un participant (même coach ailleurs) reçoit false.
 */
import { getAccessToken } from '@/lib/paymentApi';

const API_URL = (import.meta.env.REACT_APP_API_URL || '').replace(/\/$/, '');

export async function lireOutilsCoach(sessionId: string): Promise<{ est_hote: boolean; outils_coach: boolean }> {
  const t = await getAccessToken().catch(() => null);
  if (!t) return { est_hote: false, outils_coach: false };
  const r = await fetch(`${API_URL}/live/outils-coach/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) return { est_hote: false, outils_coach: false };
  const d = await r.json().catch(() => ({}));
  return { est_hote: d.est_hote === true, outils_coach: d.outils_coach === true };
}
