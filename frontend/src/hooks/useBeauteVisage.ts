/**
 * ✨ EMBELLIR LE VISAGE — le hook (côté hôte).
 *
 * Il ne connaît que deux choses : la piste caméra LiveKit du moment (`getCameraTrack`, exposée
 * par `useLiveKitStage`) et si la caméra est allumée. Il pose/retire le `BeauteProcessor` sur
 * cette piste et garde le réglage en localStorage (`bt_beaute` : off | leger | moyen ; absent = off).
 *
 * Règles :
 *  - désactivé par défaut, jamais activé sans geste de l'hôte ;
 *  - changement de niveau à chaud (uniforms), pas de republication ;
 *  - la caméra rallumée (nouvelle LocalVideoTrack) → le processeur est reposé ;
 *  - garde de performance : coupure automatique + `avis = 'perf'` (message discret) ;
 *  - appareil sans WebGL/captureStream → `supporte = false`, l'option n'est pas proposée.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalVideoTrack } from 'livekit-client';
import {
  ecrireNiveauBeaute, lireNiveauBeaute, supportBeaute, type NiveauBeaute,
} from '@/lib/beauteLogic';
import { BeauteProcessor } from '@/lib/beaute/BeauteProcessor';
import { sonderSupportBeaute } from '@/lib/beaute/rendu';

export interface UseBeauteVisageOptions {
  /** Piste caméra LiveKit locale courante (null si caméra éteinte / pas connecté). */
  getCameraTrack: () => LocalVideoTrack | null;
  /** Caméra allumée — change quand la piste est (re)créée. */
  cameraOn: boolean;
}

export interface UseBeauteVisageReturn {
  niveau: NiveauBeaute;
  setNiveau: (n: NiveauBeaute) => void;
  /** L'appareil peut traiter la vidéo (WebGL + canvas.captureStream). */
  supporte: boolean;
  /** Le processeur est effectivement posé sur la piste publiée. */
  actif: boolean;
  /** 'perf' = coupé automatiquement (appareil trop lent) ; 'erreur' = pose impossible. */
  avis: 'perf' | 'erreur' | null;
  effacerAvis: () => void;
  /** Dernière mesure (≈ 1/s) : fps traité, ms par image. */
  mesure: { fps: number; msParImage: number } | null;
}

export function useBeauteVisage({ getCameraTrack, cameraOn }: UseBeauteVisageOptions): UseBeauteVisageReturn {
  const supporte = useMemo(() => {
    if (typeof document === 'undefined') return false;
    return supportBeaute(sonderSupportBeaute());
  }, []);
  const [niveau, setNiveauEtat] = useState<NiveauBeaute>(() =>
    typeof localStorage === 'undefined' ? 'off' : lireNiveauBeaute(localStorage));
  const [actif, setActif] = useState(false);
  const [avis, setAvis] = useState<'perf' | 'erreur' | null>(null);
  const [mesure, setMesure] = useState<{ fps: number; msParImage: number } | null>(null);
  const processeurRef = useRef<BeauteProcessor | null>(null);
  const pisteRef = useRef<LocalVideoTrack | null>(null);
  const niveauRef = useRef(niveau);
  niveauRef.current = niveau;

  const setNiveau = useCallback((n: NiveauBeaute) => {
    setNiveauEtat(n);
    if (typeof localStorage !== 'undefined') ecrireNiveauBeaute(localStorage, n);
    if (n !== 'off') setAvis(null);
  }, []);

  const retirer = useCallback(async () => {
    const piste = pisteRef.current;
    pisteRef.current = null;
    processeurRef.current = null;
    setActif(false);
    setMesure(null);
    if (piste) {
      try { await piste.stopProcessor(); } catch { /* piste déjà arrêtée */ }
    }
  }, []);

  // Pose / retrait du processeur selon le niveau et l'état de la caméra.
  useEffect(() => {
    let annule = false;
    const appliquer = async () => {
      const piste = cameraOn ? getCameraTrack() : null;
      if (!supporte || niveau === 'off' || !piste) {
        if (processeurRef.current) await retirer();
        return;
      }
      // Même piste, processeur déjà posé → changement d'intensité à chaud.
      if (processeurRef.current && pisteRef.current === piste) {
        processeurRef.current.setNiveau(niveau);
        return;
      }
      if (processeurRef.current) await retirer();
      const p = new BeauteProcessor(niveau, {
        onCoupure: () => {
          // Appareil trop lent : retour à la piste brute, réglage remis sur off, avis discret.
          setAvis('perf');
          setNiveauEtat('off');
          if (typeof localStorage !== 'undefined') ecrireNiveauBeaute(localStorage, 'off');
        },
        onMesure: (fps, msParImage) => setMesure({ fps, msParImage }),
      });
      try {
        await piste.setProcessor(p);
        if (annule) { try { await piste.stopProcessor(); } catch { /* ignore */ } return; }
        processeurRef.current = p;
        pisteRef.current = piste;
        setActif(true);
        setAvis(null);
      } catch (err) {
        console.warn('[BEAUTE] pose du processeur impossible', err);
        setAvis('erreur');
        setNiveauEtat('off');
        if (typeof localStorage !== 'undefined') ecrireNiveauBeaute(localStorage, 'off');
      }
    };
    appliquer().catch(() => { /* jamais bloquant */ });
    return () => { annule = true; };
  }, [niveau, cameraOn, supporte, getCameraTrack, retirer]);

  // Démontage : on rend la piste brute.
  useEffect(() => () => { retirer().catch(() => { /* ignore */ }); }, [retirer]);

  return {
    niveau,
    setNiveau,
    supporte,
    actif,
    avis,
    effacerAvis: () => setAvis(null),
    mesure,
  };
}

export default useBeauteVisage;
