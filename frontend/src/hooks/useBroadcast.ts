/**
 * 📡 useBroadcast — « Diffuser en direct » : 1 programme → N destinations (serveur).
 *
 * CONTRAT (l'UI code contre lui) :
 *   useBroadcast({ room, enabled }) → {
 *     destinations: { platform, label, status, selected, error?, kind, missing, keyHint, accountLabel }[],
 *     live, elapsedSec, directAutorise, avis,
 *     select(platform, on), start(), stopAll(), stop(platform), retry(platform),
 *     connect(platform), configure(platform, saisie), forget(platform), refresh(),
 *   }
 *
 * Rien n'est présélectionné. `start()` exige le programStream (sinon le démarre) : ce sont les
 * pistes du PROGRAMME (scène choisie par le coach) qui partent aux réseaux — jamais la caméra
 * brute. Les clés/URLs RTMP ne quittent jamais le serveur : le front n'envoie que des NOMS
 * de plateformes et ne reçoit que des STATUTS.
 *
 * 21/09 — l'état des comptes vient de `GET /social/destinations/status` (état par plateforme +
 * diagnostic = NOMS des variables serveur manquantes). « Connecter » = vrai parcours OAuth
 * (`/social/oauth/{p}/start` → redirection → retour `#social=<p>:<résultat>`). « Configurer »
 * (IG/TikTok) passe par `lib/socialConfigClient` : la saisie vit en mémoire le temps de l'envoi,
 * jamais dans un stockage navigateur. Tant que `directAutorise` est faux, le serveur SIMULE :
 * rien ne part vers un réseau.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  broadcastReducer, BROADCAST_INITIAL, comptesDepuisServeur, destinationsADemarrer, directAutoriseDepuisServeur, dureeSec, LIBELLES,
  type Destination, type Plateforme, type StatutServeur,
} from '@/lib/broadcastLogic';
import { messageRetourOAuth } from '@/lib/broadcastUi';
import { enregistrerDestination, supprimerDestination, urlOAuth, type Appel } from '@/lib/socialConfigClient';

const API_URL = (import.meta.env.REACT_APP_API_URL || '').replace(/\/$/, '');

export interface ProgrammePourBroadcast {
  actif: boolean;
  stream: MediaStream | null;
  demarrer: () => MediaStream | null;
}

export interface UseBroadcastOptions {
  room: string;
  enabled: boolean;
  /** Le programme à diffuser (Phase 3). Sans lui, `start()` refuse. */
  program?: ProgrammePourBroadcast;
  /**
   * Publie les pistes du programme dans la room LiveKit pour l'Egress (Track Composite) et
   * renvoie leurs SIDs. Fourni par l'intégration (useLiveKitStage) ; sans lui, le serveur
   * démarre en mode « room » ou mock.
   */
  publierProgramme?: (stream: MediaStream) => Promise<{ videoSid?: string; audioSid?: string } | null>;
}

export interface ResultatBroadcast { ok: boolean; message: string; missing?: string[] }

export interface UseBroadcastReturn {
  destinations: Pick<Destination, 'platform' | 'label' | 'status' | 'selected' | 'error' | 'kind' | 'missing' | 'keyHint' | 'accountLabel'>[];
  live: boolean;
  elapsedSec: number;
  /** false = simulation côté serveur (mode mock / verrou fermé) : aucun direct réel ne part. */
  directAutorise: boolean;
  select: (platform: Plateforme, on: boolean) => void;
  start: () => Promise<void>;
  stopAll: () => Promise<void>;
  stop: (platform: Plateforme) => Promise<void>;
  retry: (platform: Plateforme) => Promise<void>;
  connect: (platform: Plateforme) => Promise<ResultatBroadcast>;
  configure: (platform: Plateforme, saisie: { url: string; cle: string; libelle?: string }) => Promise<ResultatBroadcast>;
  forget: (platform: Plateforme) => Promise<ResultatBroadcast>;
  refresh: () => Promise<void>;
  /** Message court à afficher (refus, panne réseau, retour OAuth), sinon null. */
  avis: string | null;
}

async function authHeader(): Promise<Record<string, string>> {
  if (!supabase) return {};
  try {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch { return {}; }
}

const appel: Appel = async (path, body, method) => {
  if (!API_URL) return { ok: false, status: 0, json: null };
  const verbe = method ?? (body === undefined ? 'GET' : 'POST');
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: verbe,
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* corps vide */ }
    return { ok: res.ok, status: res.status, json };
  } catch { return { ok: false, status: 0, json: null }; }
};

/** Retour d'un parcours OAuth : lit `#social=<p>:<résultat>`, nettoie l'URL, renvoie le message. */
function consommerRetourOAuth(): { platform: string; texte: string; ok: boolean } | null {
  if (typeof window === 'undefined') return null;
  const m = messageRetourOAuth(window.location.hash, LIBELLES);
  if (!m) return null;
  try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* ignore */ }
  return m;
}

export function useBroadcast(o: UseBroadcastOptions): UseBroadcastReturn {
  const [etat, dispatch] = useReducer(broadcastReducer, BROADCAST_INITIAL);
  const [elapsedSec, setElapsed] = useState(0);
  const [avis, setAvis] = useState<string | null>(null);
  const [directAutorise, setDirectAutorise] = useState(false);
  const sidsRef = useRef<{ videoSid?: string; audioSid?: string } | null>(null);
  const oRef = useRef(o); oRef.current = o;

  // Comptes : état par plateforme, lu au montage / à l'activation. Jamais de secret : statuts + noms de variables.
  const refresh = useCallback(async () => {
    const r = await appel('/social/destinations/status');
    if (r.ok) {
      dispatch({ type: 'comptes', comptes: comptesDepuisServeur(r.json) });
      setDirectAutorise(directAutoriseDepuisServeur(r.json));
      return;
    }
    if (r.status === 403) { setAvis('Diffusion sociale réservée au compte Afroboost.'); return; }
    // Repli : l'ancienne route ne connaît que des statuts simples.
    const room = oRef.current.room;
    const r2 = room ? await appel(`/live/broadcast/accounts?room=${encodeURIComponent(room)}`) : r;
    dispatch({ type: 'comptes', comptes: comptesDepuisServeur(r2.json) });
    setDirectAutorise(false);
  }, []);

  useEffect(() => {
    if (!o.enabled || !o.room) return;
    let annule = false;
    (async () => {
      const retour = consommerRetourOAuth();
      if (retour && !annule) setAvis(retour.texte);
      if (!annule) await refresh();
    })();
    return () => { annule = true; };
  }, [o.enabled, o.room, refresh]);

  // Statuts : sondage 3 s pendant le direct.
  useEffect(() => {
    if (!etat.live || !o.room) return;
    let annule = false;
    const tick = async () => {
      const r = await appel(`/live/broadcast/status?room=${encodeURIComponent(o.room)}`);
      if (annule || !r.ok || !r.json) return;
      dispatch({ type: 'statut', statut: r.json as StatutServeur, maintenant: Date.now() });
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { annule = true; clearInterval(t); };
  }, [etat.live, o.room]);

  // Durée affichée.
  useEffect(() => {
    if (!etat.live) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(dureeSec(etat, Date.now())), 1000);
    return () => clearInterval(t);
  }, [etat.live, etat.demarreLe, etat]);

  const select = useCallback((platform: Plateforme, on: boolean) => dispatch({ type: 'select', platform, on }), []);

  const assurerProgramme = useCallback(async (): Promise<boolean> => {
    const p = oRef.current.program;
    if (!p) { setAvis('Aucune scène Programme : ouvrez le Studio et passez une scène à l\'antenne.'); return false; }
    const s = p.actif && p.stream ? p.stream : p.demarrer();
    if (!s) { setAvis('Le programme ne peut pas démarrer sur cet appareil.'); return false; }
    if (oRef.current.publierProgramme && !sidsRef.current) {
      sidsRef.current = await oRef.current.publierProgramme(s);
    }
    return true;
  }, []);

  const lancer = useCallback(async (cibles: Plateforme[]) => {
    if (!cibles.length) { setAvis('Choisissez au moins un réseau connecté ou configuré.'); return; }
    if (!(await assurerProgramme())) return;
    dispatch({ type: 'start', maintenant: Date.now() });
    const r = await appel('/live/broadcast/start', {
      room: oRef.current.room, destinations: cibles.map((platform) => ({ platform })),
      video_track_sid: sidsRef.current?.videoSid ?? null, audio_track_sid: sidsRef.current?.audioSid ?? null,
    });
    if (!r.ok) {
      const msg = (r.json as { detail?: string } | null)?.detail || 'Le direct n\'a pas pu démarrer.';
      cibles.forEach((platform) => dispatch({ type: 'echec_demarrage', platform, error: msg }));
      setAvis(msg);
      return;
    }
    setAvis(null);
    if (r.json) dispatch({ type: 'statut', statut: r.json as StatutServeur, maintenant: Date.now() });
  }, [assurerProgramme]);

  const start = useCallback(async () => { await lancer(destinationsADemarrer(etat)); }, [etat, lancer]);
  const retry = useCallback(async (platform: Plateforme) => { dispatch({ type: 'retry', platform }); await lancer([platform]); }, [lancer]);

  const stop = useCallback(async (platform: Plateforme) => {
    const r = await appel('/live/broadcast/stop', { room: oRef.current.room, platform });
    dispatch({ type: 'stop', platform });
    if (r.json) dispatch({ type: 'statut', statut: r.json as StatutServeur, maintenant: Date.now() });
  }, []);

  const stopAll = useCallback(async () => {
    await appel('/live/broadcast/stop', { room: oRef.current.room });
    dispatch({ type: 'stop_all' });
    sidsRef.current = null;
  }, []);

  // « Connecter » / « Reconnecter » : le VRAI parcours OAuth, dans cet onglet ; retour sur cette page.
  const connect = useCallback(async (platform: Plateforme): Promise<ResultatBroadcast> => {
    if (!API_URL) return { ok: false, message: 'Serveur non configuré.' };
    const retour = typeof window !== 'undefined' ? window.location.href.split('#')[0] : '';
    const r = await urlOAuth(appel, platform, retour);
    if (!r.ok || !r.url) { setAvis(r.message); await refresh(); return { ok: false, message: r.message, missing: r.missing }; }
    if (typeof window !== 'undefined') window.location.assign(r.url);
    return { ok: true, message: 'Redirection vers la connexion…' };
  }, [refresh]);

  // « Configurer » (IG / TikTok) : la saisie ne vit qu'en mémoire, le serveur ne renvoie que l'ÉTAT.
  const configure = useCallback(async (platform: Plateforme, saisie: { url: string; cle: string; libelle?: string }): Promise<ResultatBroadcast> => {
    const r = await enregistrerDestination(appel, platform, saisie);
    if (r.ok) { setAvis(null); await refresh(); } else { setAvis(r.message); }
    return { ok: r.ok, message: r.message, missing: r.missing };
  }, [refresh]);

  const forget = useCallback(async (platform: Plateforme): Promise<ResultatBroadcast> => {
    const r = await supprimerDestination(appel, platform);
    await refresh();
    return r;
  }, [refresh]);

  return {
    destinations: etat.destinations.map(({ platform, label, status, selected, error, kind, missing, keyHint, accountLabel }) =>
      ({ platform, label, status, selected, error, kind, missing, keyHint, accountLabel })),
    live: etat.live, elapsedSec, directAutorise, select, start, stopAll, stop, retry, connect, configure, forget, refresh, avis,
  };
}

export default useBroadcast;
