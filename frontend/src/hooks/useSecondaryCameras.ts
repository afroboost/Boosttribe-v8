import { useCallback, useEffect, useRef, useState } from 'react';
import { multiCamPossible } from '@/lib/sourcesLogic';

/**
 * 🎛️ Phase 1 Sources — caméras SECONDAIRES (aperçus locaux du coach, JAMAIS publiées).
 *
 * La caméra principale reste celle de LiveKit (`useLiveKitStage.setCameraDevice`). Ici on
 * ouvre en plus, sur ordinateur Chromium seulement, d'autres `videoinput` (webcam USB, carte
 * HDMI UVC, caméra virtuelle…) avec un `getUserMedia` INDÉPENDANT par caméra : chacune a son
 * MediaStream, son nom, son aperçu et son arrêt. Rien ne part vers les participants — la
 * composition (Preview/Programme) est une phase ultérieure.
 *
 * Mobile / Safari : mono-caméra, ce hook répond `possible=false` et n'ouvre rien (aucun hack).
 * Une 2ᵉ caméra qui refuse de s'ouvrir passe en `etat: 'indisponible'` — la principale continue.
 */
export interface CameraSecondaire {
  deviceId: string;
  label: string;
  stream: MediaStream | null;
  etat: 'ok' | 'indisponible';
}

export interface UseSecondaryCamerasReturn {
  possible: boolean;
  cameras: CameraSecondaire[];
  ajouter: (deviceId: string, label: string) => Promise<boolean>;
  retirer: (deviceId: string) => void;
  toutArreter: () => void;
}

export function useSecondaryCameras(): UseSecondaryCamerasReturn {
  const possible = typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && multiCamPossible(navigator.userAgent, navigator.maxTouchPoints || 0);
  const [cameras, setCameras] = useState<CameraSecondaire[]>([]);
  const camerasRef = useRef<CameraSecondaire[]>([]);
  camerasRef.current = cameras;

  const retirer = useCallback((deviceId: string) => {
    setCameras((prev) => {
      const cam = prev.find((c) => c.deviceId === deviceId);
      cam?.stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      return prev.filter((c) => c.deviceId !== deviceId);
    });
  }, []);

  const ajouter = useCallback(async (deviceId: string, label: string): Promise<boolean> => {
    if (!possible || !deviceId) return false;
    if (camerasRef.current.some((c) => c.deviceId === deviceId)) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
      // Débranchée à chaud → on la retire toute seule (la principale n'est pas concernée).
      stream.getVideoTracks().forEach((t) => { try { t.addEventListener('ended', () => retirer(deviceId), { once: true }); } catch { /* ignore */ } });
      setCameras((prev) => [...prev.filter((c) => c.deviceId !== deviceId), { deviceId, label, stream, etat: 'ok' }]);
      return true;
    } catch (err) {
      console.warn('[SOURCES] caméra secondaire indisponible', err);
      setCameras((prev) => [...prev.filter((c) => c.deviceId !== deviceId), { deviceId, label, stream: null, etat: 'indisponible' }]);
      return false;
    }
  }, [possible, retirer]);

  const toutArreter = useCallback(() => {
    camerasRef.current.forEach((c) => c.stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } }));
    setCameras([]);
  }, []);

  // Démontage : on libère toutes les caméras secondaires (jamais de caméra qui reste allumée).
  useEffect(() => () => {
    camerasRef.current.forEach((c) => c.stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } }));
  }, []);

  return { possible, cameras, ajouter, retirer, toutArreter };
}

export default useSecondaryCameras;
