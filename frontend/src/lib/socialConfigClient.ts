/**
 * 📡 Transport des DESTINATIONS SOCIALES — le seul module du front qui parle « URL RTMPS + clé ».
 *
 * Règles (Bassi, 21/09) :
 *  - la clé de diffusion ne passe QUE dans le corps du POST, en mémoire, le temps de l'envoi ;
 *    jamais dans localStorage / sessionStorage, jamais dans un journal, jamais dans une URL ;
 *  - le serveur ne la renvoie jamais : on ne lit en retour que l'ÉTAT (`configured`, `…4 derniers caractères`) ;
 *  - tout passe par `appel` (jeton Supabase posé par l'appelant) : ce module ne lit aucune session lui-même.
 */
export type ReponseApi = { ok: boolean; status: number; json: unknown };
export type Appel = (path: string, body?: unknown, method?: 'GET' | 'POST' | 'DELETE') => Promise<ReponseApi>;

export interface SaisieDestination { url: string; cle: string; libelle?: string }

/** Détail d'erreur lisible depuis une réponse serveur (string OU objet { message, missing }). */
export function messageErreur(json: unknown, defaut: string): { message: string; missing: string[] } {
  const detail = json && typeof json === 'object' ? (json as { detail?: unknown }).detail : null;
  if (typeof detail === 'string') return { message: detail, missing: [] };
  if (detail && typeof detail === 'object') {
    const d = detail as { message?: unknown; missing?: unknown };
    const missing = Array.isArray(d.missing) ? (d.missing as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    return { message: typeof d.message === 'string' ? d.message : (missing.length ? `Configuration requise : ${missing.join(', ')}` : defaut), missing };
  }
  return { message: defaut, missing: [] };
}

/** Enregistre (ou remplace) la destination manuelle d'une plateforme. La clé n'est jamais conservée ici. */
export async function enregistrerDestination(appel: Appel, platform: string, saisie: SaisieDestination): Promise<{ ok: boolean; message: string; missing: string[]; etat: unknown }> {
  const r = await appel(`/social/destinations/${platform}/manual`, {
    rtmp_url: saisie.url.trim(), stream_key: saisie.cle.trim(), account_label: (saisie.libelle || '').trim() || null,
  });
  if (!r.ok) {
    const e = messageErreur(r.json, r.status === 0 ? 'Serveur injoignable.' : 'La configuration n’a pas été enregistrée.');
    return { ok: false, message: e.message, missing: e.missing, etat: null };
  }
  return { ok: true, message: 'Configuration enregistrée.', missing: [], etat: r.json };
}

/** Supprime la configuration d'une plateforme (la clé chiffrée est effacée côté serveur). */
export async function supprimerDestination(appel: Appel, platform: string): Promise<{ ok: boolean; message: string }> {
  const r = await appel(`/social/destinations/${platform}`, undefined, 'DELETE');
  return r.ok ? { ok: true, message: 'Configuration supprimée.' } : { ok: false, message: messageErreur(r.json, 'Suppression impossible.').message };
}

/** Demande l'URL du VRAI parcours OAuth (Facebook / Google). 409 = configuration serveur requise (noms des variables). */
export async function urlOAuth(appel: Appel, platform: string, returnTo: string): Promise<{ ok: boolean; url: string | null; message: string; missing: string[] }> {
  const r = await appel(`/social/oauth/${platform}/start?return_to=${encodeURIComponent(returnTo)}`);
  if (r.ok && r.json && typeof r.json === 'object' && typeof (r.json as { url?: unknown }).url === 'string') {
    return { ok: true, url: (r.json as { url: string }).url, message: '', missing: [] };
  }
  const e = messageErreur(r.json, r.status === 0 ? 'Serveur injoignable.' : 'Connexion indisponible.');
  return { ok: false, url: null, message: e.message, missing: e.missing };
}
