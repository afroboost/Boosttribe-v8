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
 *  - 🎨 look vidéo (`bt_look`) : même processeur, même passe ; il SURVIT à l'embellissement
 *    coupé/rallumé (le processeur reste posé tant qu'un look ≠ Original est choisi) et au
 *    changement de caméra (restartTrack → processeur.restart). Original + embellissement coupé
 *    = processeur retiré, piste brute.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalVideoTrack } from 'livekit-client';
import {
  ecrireNiveauBeaute, lireNiveauBeaute, supportBeaute, type NiveauBeaute,
} from '@/lib/beauteLogic';
import { BeauteProcessor } from '@/lib/beaute/BeauteProcessor';
import { ecrireLook, lireLook, traitementNecessaire, type LookId } from '@/lib/looksVideo';
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
  /** 🎨 Look vidéo appliqué au flux PUBLIÉ (même passe GPU que l'embellissement) — mémorisé (`bt_look`). */
  look: LookId;
  setLook: (l: LookId) => void;
  /** 🎨 Look coupé automatiquement ('perf' : appareil trop lent ; 'erreur' : pose impossible). */
  avisLook: 'perf' | 'erreur' | null;
  effacerAvisLook: () => void;
  /** Embellissement en retard : résolution de traitement abaissée (px du grand côté), sinon null. */
  palier: number | null;
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
  const [look, setLookEtat] = useState<LookId>(() =>
    typeof localStorage === 'undefined' ? 'original' : lireLook(localStorage));
  const [avisLook, setAvisLook] = useState<'perf' | 'erreur' | null>(null);
  const [palier, setPalier] = useState<number | null>(null);
  const lookRef = useRef(look);
  lookRef.current = look;
  const processeurRef = useRef<BeauteProcessor | null>(null);
  const pisteRef = useRef<LocalVideoTrack | null>(null);
  const niveauRef = useRef(niveau);
  niveauRef.current = niveau;

  const setNiveau = useCallback((n: NiveauBeaute) => {
    setNiveauEtat(n);
    if (typeof localStorage !== 'undefined') ecrireNiveauBeaute(localStorage, n);
    if (n !== 'off') setAvis(null);
  }, []);

  const setLook = useCallback((l: LookId) => {
    setLookEtat(l);
    if (typeof localStorage !== 'undefined') ecrireLook(localStorage, l);
    setAvisLook(null);
  }, []);

  const retirer = useCallback(async () => {
    const piste = pisteRef.current;
    pisteRef.current = null;
    processeurRef.current = null;
    setActif(false);
    setMesure(null);
    setPalier(null);
    if (piste) {
      try { await piste.stopProcessor(); } catch { /* piste déjà arrêtée */ }
    }
  }, []);

  // Pose / retrait du processeur selon le niveau et l'état de la caméra.
  useEffect(() => {
    let annule = false;
    const appliquer = async () => {
      const piste = cameraOn ? getCameraTrack() : null;
      // Original + embellissement coupé : AUCUN traitement, la piste brute de la caméra (qualité native).
      if (!supporte || !traitementNecessaire(niveau, look) || !piste) {
        if (processeurRef.current) await retirer();
        return;
      }
      // Même piste, processeur déjà posé → changement d'intensité à chaud.
      if (processeurRef.current && pisteRef.current === piste) {
        processeurRef.current.setNiveau(niveau);
        processeurRef.current.setLook(look);
        return;
      }
      if (processeurRef.current) await retirer();
      const p = new BeauteProcessor(niveau, {
        onCoupure: () => {
          // Appareil trop lent : retour à la piste brute (PLEINE résolution), réglages remis sur
          // off / Original, avis discret — chacun dans son contrôle.
          if (niveauRef.current !== 'off') setAvis('perf');
          if (lookRef.current !== 'original') setAvisLook('perf');
          setNiveauEtat('off');
          setLookEtat('original');
          if (typeof localStorage !== 'undefined') { ecrireNiveauBeaute(localStorage, 'off'); ecrireLook(localStorage, 'original'); }
        },
        onPalier: (cote) => setPalier(cote),
        onMesure: (fps, msParImage) => setMesure({ fps, msParImage }),
      }, look);
      try {
        await piste.setProcessor(p);
        if (annule) { try { await piste.stopProcessor(); } catch { /* ignore */ } return; }
        processeurRef.current = p;
        pisteRef.current = piste;
        setActif(true);
        setAvis(null);
      } catch (err) {
        console.warn('[BEAUTE] pose du processeur impossible', err);
        if (niveau !== 'off') setAvis('erreur');
        if (look !== 'original') setAvisLook('erreur');
        setNiveauEtat('off');
        setLookEtat('original');   // sinon le look relancerait aussitôt une pose vouée à l'échec
        if (typeof localStorage !== 'undefined') { ecrireNiveauBeaute(localStorage, 'off'); ecrireLook(localStorage, 'original'); }
      }
    };
    appliquer().catch(() => { /* jamais bloquant */ });
    return () => { annule = true; };
  }, [niveau, look, cameraOn, supporte, getCameraTrack, retirer]);

  // Démontage : on rend la piste brute.
  useEffect(() => () => { retirer().catch(() => { /* ignore */ }); }, [retirer]);

  return {
    niveau,
    setNiveau,
    look,
    setLook,
    avisLook,
    effacerAvisLook: () => setAvisLook(null),
    palier,
    supporte,
    actif,
    avis,
    effacerAvis: () => setAvis(null),
    mesure,
  };
}

export default useBeauteVisage;
