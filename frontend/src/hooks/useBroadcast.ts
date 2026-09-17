/**
 * 📡 useBroadcast — « Diffuser en direct » : 1 programme → N destinations (serveur).
 *
 * CONTRAT (l'UI code contre lui) :
 *   useBroadcast({ room, enabled }) → {
 *     destinations: { platform, label, status, selected, error? }[],
 *     live, elapsedSec,
 *     select(platform, on), start(), stopAll(), stop(platform), retry(platform),
 *     connectUrl(platform): string | null,
 *   }
 *
 * Rien n'est présélectionné. `start()` exige le programStream (sinon le démarre) : ce sont les
 * pistes du PROGRAMME (scène choisie par le coach) qui partent aux réseaux — jamais la caméra
 * brute. Les clés/URLs RTMP ne quittent jamais le serveur : le front n'envoie que des NOMS
 * de plateformes et ne reçoit que des STATUTS.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  broadcastReducer, BROADCAST_INITIAL, destinationsADemarrer, dureeSec,
  type ComptesServeur, type Destination, type Plateforme, type StatutServeur,
} from '@/lib/broadcastLogic';

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

export interface UseBroadcastReturn {
  destinations: Pick<Destination, 'platform' | 'label' | 'status' | 'selected' | 'error'>[];
  live: boolean;
  elapsedSec: number;
  select: (platform: Plateforme, on: boolean) => void;
  start: () => Promise<void>;
  stopAll: () => Promise<void>;
  stop: (platform: Plateforme) => Promise<void>;
  retry: (platform: Plateforme) => Promise<void>;
  connectUrl: (platform: Plateforme) => string | null;
  /** Message court à afficher (refus, panne réseau), sinon null. */
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

async function appel(path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
  if (!API_URL) return { ok: false, status: 0, json: null };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* corps vide */ }
    return { ok: res.ok, status: res.status, json };
  } catch { return { ok: false, status: 0, json: null }; }
}

export function useBroadcast(o: UseBroadcastOptions): UseBroadcastReturn {
  const [etat, dispatch] = useReducer(broadcastReducer, BROADCAST_INITIAL);
  const [elapsedSec, setElapsed] = useState(0);
  const [avis, setAvis] = useState<string | null>(null);
  const sidsRef = useRef<{ videoSid?: string; audioSid?: string } | null>(null);
  const oRef = useRef(o); oRef.current = o;

  // Comptes : lus au montage / à l'activation. Jamais de secret : statuts seulement.
  useEffect(() => {
    if (!o.enabled || !o.room) return;
    let annule = false;
    (async () => {
      const r = await appel(`/live/broadcast/accounts?room=${encodeURIComponent(o.room)}`);
      if (annule) return;
      const comptes = (r.ok && r.json && typeof r.json === 'object' ? (r.json as { accounts?: ComptesServeur }).accounts : null) ?? {};
      dispatch({ type: 'comptes', comptes });
    })();
    return () => { annule = true; };
  }, [o.enabled, o.room]);

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
    if (!cibles.length) { setAvis('Choisissez au moins un réseau connecté.'); return; }
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

  const connectUrl = useCallback((platform: Plateforme): string | null => {
    if (!API_URL) return null;
    return `${API_URL}/social/connect?platform=${platform}`;
  }, []);

  return {
    destinations: etat.destinations.map(({ platform, label, status, selected, error }) => ({ platform, label, status, selected, error })),
    live: etat.live, elapsedSec, select, start, stopAll, stop, retry, connectUrl, avis,
  };
}

export default useBroadcast;
