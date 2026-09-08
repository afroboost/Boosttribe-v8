import { useCallback, useEffect, useRef, useState } from 'react';
import { contrainteVideo, messageErreurCamera, cameraRetenue } from '@/lib/studioLogic';

/**
 * 🎥 useCameraStudio — choix et cycle de vie de la caméra pour le Studio face caméra.
 *
 * POURQUOI UN HOOK À PART, alors que `useLiveKitStage` sait déjà énumérer les caméras :
 * ce hook-là est indissociable d'une ROOM LiveKit (il publie une piste dans une session
 * live). Le Studio, lui, est purement LOCAL : aucune room, aucun participant, aucune
 * publication. On réutilise donc la MÉTHODE éprouvée de `useLiveKitStage`
 * (enumerateDevices → sonde de permission → labels → deviceId exact → mémorisation +
 * écoute `devicechange`) sans traîner la dépendance au SFU.
 *
 * RÈGLES DE CONFIDENTIALITÉ, non négociables :
 *  - la caméra ne démarre JAMAIS toute seule : `start()` n'est appelé que sur un geste
 *    utilisateur explicite ;
 *  - `stop()` coupe RÉELLEMENT chaque piste (`track.stop()`), et le démontage aussi —
 *    la diode de la webcam doit s'éteindre en quittant l'écran ;
 *  - aucune capture, aucun enregistrement, aucun envoi réseau ici.
 */

/** Dernière caméra choisie dans le Studio. Distincte de `bt_video_device` (Live). */
const STUDIO_CAMERA_KEY = 'bt_studio_camera';

export type Facing = 'user' | 'environment';

export interface CameraStudio {
  devices: MediaDeviceInfo[];
  deviceId: string | null;
  stream: MediaStream | null;
  active: boolean;
  starting: boolean;
  /** Message prêt à afficher — jamais un jargon technique. */
  error: string | null;
  /** Démarre (geste utilisateur obligatoire). `id` force une caméra précise. */
  start: (id?: string | null) => Promise<boolean>;
  /** Coupe la caméra et libère réellement le périphérique. */
  stop: () => void;
  /** Change de caméra. À chaud si elle tourne, mémorisé sinon. */
  select: (id: string) => Promise<void>;
  /** Bascule avant/arrière (mobile) via `facingMode`, avec repli sur le cyclage. */
  flip: () => Promise<void>;
  /** Ré-énumère. `probe` = sonder la permission pour obtenir les libellés. */
  refresh: (probe?: boolean) => Promise<void>;
  facing: Facing;
}

export function useCameraStudio(): CameraStudio {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(() => {
    try { return localStorage.getItem(STUDIO_CAMERA_KEY); } catch { return null; }
  });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>('user');

  // Refs : le flux et le choix courants doivent être lisibles dans des callbacks
  // stables (nettoyage au démontage) sans les faire dépendre du rendu.
  const streamRef = useRef<MediaStream | null>(null);
  const deviceIdRef = useRef<string | null>(deviceId);
  deviceIdRef.current = deviceId;

  const couper = useCallback(() => {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    streamRef.current = null;
    setStream(null);
  }, []);

  const refresh = useCallback(async (probe = false): Promise<void> => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      let devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      // Avant permission, les libellés sont vides : on sonde BRIÈVEMENT, et seulement
      // sur un clic explicite (`probe`), jamais au montage.
      if (probe && !streamRef.current && (devs.length === 0 || devs.every((d) => !d.label))) {
        try {
          const p = await navigator.mediaDevices.getUserMedia({ video: true });
          p.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
          devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        } catch (e) { setError(messageErreurCamera((e as { name?: string })?.name || '')); }
      }
      setDevices(devs);
    } catch { /* ignore */ }
  }, []);

  const start = useCallback(async (id?: string | null): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Ce navigateur ne permet pas d'accéder à la caméra.");
      return false;
    }
    setStarting(true);
    setError(null);
    const voulu = id !== undefined ? id : deviceIdRef.current;
    // 📱 Sans caméra choisie, on laisse le navigateur décider via `facingMode` : c'est
    //    le SEUL critère fiable sur iOS Safari, où les libellés sont pauvres.
    const contrainte = contrainteVideo(voulu, facing);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: contrainte, audio: false });
      couper();                       // jamais deux flux ouverts en même temps
      streamRef.current = s;
      setStream(s);
      // Le périphérique RÉELLEMENT obtenu peut différer du souhait (repli navigateur).
      const reel = s.getVideoTracks()[0]?.getSettings?.().deviceId || voulu || null;
      if (reel) {
        setDeviceId(reel);
        try { localStorage.setItem(STUDIO_CAMERA_KEY, reel); } catch { /* ignore */ }
      }
      await refresh(false);           // les libellés sont désormais lisibles
      setStarting(false);
      return true;
    } catch (e) {
      // 🔁 Repli : la caméra mémorisée n'existe plus (débranchée) → on oublie le choix
      //    et on réessaie avec n'importe quelle caméra. Jamais d'écran bloqué.
      if (voulu) {
        try { localStorage.removeItem(STUDIO_CAMERA_KEY); } catch { /* ignore */ }
        setDeviceId(null);
        try {
          // Repli TESTÉ (`cameraRetenue`) : la caméra encore présente, sinon le choix libre.
          const dispo = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
          const repli = cameraRetenue(dispo, null);
          const s2 = await navigator.mediaDevices.getUserMedia({
            video: repli ? { deviceId: { exact: repli } } : true, audio: false,
          });
          couper();
          streamRef.current = s2;
          setStream(s2);
          const reel2 = s2.getVideoTracks()[0]?.getSettings?.().deviceId || null;
          if (reel2) setDeviceId(reel2);
          await refresh(false);
          setStarting(false);
          return true;
        } catch (e2) { setError(messageErreurCamera((e2 as { name?: string })?.name || '')); }
      } else {
        setError(messageErreurCamera((e as { name?: string })?.name || ''));
      }
      setStarting(false);
      return false;
    }
  }, [couper, refresh, facing]);

  const stop = useCallback(() => { couper(); setError(null); }, [couper]);

  const select = useCallback(async (id: string): Promise<void> => {
    setDeviceId(id);
    try { localStorage.setItem(STUDIO_CAMERA_KEY, id); } catch { /* ignore */ }
    if (streamRef.current) await start(id);   // à chaud
  }, [start]);

  const flip = useCallback(async (): Promise<void> => {
    const suivant: Facing = facing === 'user' ? 'environment' : 'user';
    setFacing(suivant);
    // `facingMode` d'abord (fiable sur mobile) ; à défaut, cyclage des périphériques.
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: suivant } }, audio: false });
      couper();
      streamRef.current = s;
      setStream(s);
      const reel = s.getVideoTracks()[0]?.getSettings?.().deviceId || null;
      setDeviceId(reel);
      return;
    } catch { /* pas de caméra pour ce facingMode → cyclage */ }
    if (devices.length < 2) return;
    const idx = Math.max(0, devices.findIndex((d) => d.deviceId === deviceIdRef.current));
    const next = devices[(idx + 1) % devices.length];
    if (next) await select(next.deviceId);
  }, [facing, devices, couper, select]);

  // Branchement / débranchement à chaud — rafraîchissement SILENCIEUX (n'ouvre rien).
  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    const h = () => { refresh(false); };
    navigator.mediaDevices.addEventListener('devicechange', h);
    return () => { try { navigator.mediaDevices.removeEventListener('devicechange', h); } catch { /* ignore */ } };
  }, [refresh]);

  // Énumération silencieuse au montage (aucune permission demandée, aucun flux ouvert).
  useEffect(() => { refresh(false); }, [refresh]);

  // 🔒 Démontage : la caméra ne survit JAMAIS à la fermeture de l'écran.
  useEffect(() => () => { couper(); }, [couper]);

  return {
    devices, deviceId, stream, active: !!stream, starting, error,
    start, stop, select, flip, refresh, facing,
  };
}

export default useCameraStudio;
