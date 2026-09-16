import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 🎛️ Phase 1 Sources — MICRO SECONDAIRE (optionnel).
 *
 * Capture un 2ᵉ `audioinput` (Rode, micro USB, interface…) et le branche sur le MIXEUR
 * existant (`connectSecondaryMic` de useAudioMixer : gain propre → même limiteur → même flux
 * diffusé). Rien n'est ajouté à la chaîne de diffusion : c'est une source de plus dans le bus.
 * Mêmes contraintes que le micro principal (AEC/NS/AGC OFF : mixage manuel, musique).
 *
 * Sans micro externe, ce hook reste inactif : le micro de l'appareil (principal) suffit.
 */
export interface MixerLien {
  connectSecondaryMic: (stream: MediaStream, gain?: number) => boolean;
  setSecondaryMicGain: (gain: number) => void;
  setSecondaryMicMuted: (muted: boolean) => void;
  getSecondaryMicLevel: () => number;
  disconnectSecondaryMic: () => void;
}

export interface UseSecondaryMicReturn {
  deviceId: string | null;
  label: string;
  actif: boolean;
  muted: boolean;
  gain: number;       // 0..2.5 (1 = 100 %)
  niveau: number;     // 0..1 (vumètre)
  erreur: string | null;
  activer: (deviceId: string, label: string) => Promise<boolean>;
  arreter: () => void;
  setMuted: (m: boolean) => void;
  setGain: (g: number) => void;
}

export function useSecondaryMic(mixer: MixerLien): UseSecondaryMicReturn {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [actif, setActif] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [gain, setGainState] = useState(1);
  const [niveau, setNiveau] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mixerRef = useRef(mixer); mixerRef.current = mixer;

  const arreter = useCallback(() => {
    mixerRef.current.disconnectSecondaryMic();
    streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    streamRef.current = null;
    setActif(false); setDeviceId(null); setLabel(''); setNiveau(0);
  }, []);

  const activer = useCallback(async (id: string, lbl: string): Promise<boolean> => {
    setErreur(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      streamRef.current = stream;
      const ok = mixerRef.current.connectSecondaryMic(stream, gain);
      if (!ok) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
        streamRef.current = null;
        setErreur('Active d’abord ton micro principal');
        return false;
      }
      mixerRef.current.setSecondaryMicMuted(muted);
      stream.getAudioTracks().forEach((t) => { try { t.addEventListener('ended', () => arreter(), { once: true }); } catch { /* ignore */ } });
      setDeviceId(id); setLabel(lbl); setActif(true);
      return true;
    } catch (e) {
      console.warn('[SOURCES] micro secondaire indisponible', e);
      setErreur('Micro indisponible');
      return false;
    }
  }, [gain, muted, arreter]);

  const setMuted = useCallback((m: boolean) => { setMutedState(m); mixerRef.current.setSecondaryMicMuted(m); }, []);
  const setGain = useCallback((g: number) => { const v = Math.max(0, Math.min(2.5, g)); setGainState(v); mixerRef.current.setSecondaryMicGain(v); }, []);

  // Vumètre : lecture ~12×/s tant que le micro secondaire est actif (léger, dérivation dead-end).
  useEffect(() => {
    if (!actif) return;
    const id = window.setInterval(() => setNiveau(mixerRef.current.getSecondaryMicLevel()), 80);
    return () => window.clearInterval(id);
  }, [actif]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } }); }, []);

  return { deviceId, label, actif, muted, gain, niveau, erreur, activer, arreter, setMuted, setGain };
}

export default useSecondaryMic;
