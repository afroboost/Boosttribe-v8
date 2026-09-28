/**
 * ❤ useLiveReactions — branche la logique pure de `lib/liveReactions` sur React.
 *
 * Le coordinateur (SessionPage) fournit `envoyer = sendPlaybackEvent` et branche :
 *   .on('broadcast', { event: EVT_REACTIONS }, (p) => live.recevoirLot(p.payload))
 *   .on('broadcast', { event: EVT_TOTAL },     (p) => live.recevoirTotal(p.payload))
 * Aucune écriture en base : tout est éphémère.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EVT_REACTIONS, EVT_TOTAL, ETAT_INITIAL, MAX_BULLES_SIMULTANEES,
  ajouterLocal, appliquerLot, bullesAAfficher, creerTamponReactions, doitAnnoncerTotal, synchroTotal, totalDe,
  type EtatReactions, type LotReactions, type Totaux, type TypeReaction,
} from '@/lib/liveReactions';

export interface BulleReaction { id: string; type: TypeReaction; index: number }

export interface OptionsLiveReactions {
  userId: string;
  envoyer: (event: string, payload: unknown) => void;
  estHote: boolean;
  intervalleMs?: number;
  periodeTotalMs?: number;
}

const INTERVALLE_TOTAL_VERIF_MS = 2000;

function lireReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

export function useLiveReactions({
  userId, envoyer, estHote, intervalleMs = 1500, periodeTotalMs = 10_000,
}: OptionsLiveReactions) {
  const [etat, setEtat] = useState<EtatReactions>(ETAT_INITIAL);
  const [bulles, setBulles] = useState<BulleReaction[]>([]);

  const envoyerRef = useRef(envoyer);
  envoyerRef.current = envoyer;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const etatRef = useRef(etat);
  // Toutes les mises à jour passent par la ref (source synchrone) : un clic local et un lot
  // reçu dans le même tick ne s'écrasent pas. Même référence => pas de setState.
  const commit = useCallback((suivant: EtatReactions) => {
    if (suivant === etatRef.current) return;
    etatRef.current = suivant;
    setEtat(suivant);
  }, []);
  const compteurBulle = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedRef = useRef(lireReducedMotion());

  useEffect(() => {
    let mq: MediaQueryList | undefined;
    try { mq = window.matchMedia?.('(prefers-reduced-motion: reduce)'); } catch { /* vieux navigateur */ }
    if (!mq) return;
    const maj = () => { reducedRef.current = mq!.matches; };
    mq.addEventListener?.('change', maj);
    return () => mq!.removeEventListener?.('change', maj);
  }, []);

  // Tampon d'émission : recréé seulement si l'identité change.
  const tamponRef = useRef<ReturnType<typeof creerTamponReactions> | null>(null);
  useEffect(() => {
    const tampon = creerTamponReactions({
      from: userId,
      intervalleMs,
      seqInitial: Date.now(),
      envoyer: (lot: LotReactions) => envoyerRef.current(EVT_REACTIONS, lot),
    });
    tamponRef.current = tampon;
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      tampon.vider(Date.now(), true); // on ne perd pas les derniers clics en quittant
      if (tamponRef.current === tampon) tamponRef.current = null;
    };
  }, [userId, intervalleMs]);

  const planifierVidage = useCallback(() => {
    const tampon = tamponRef.current;
    if (!tampon || timerRef.current) return;
    const echeance = tampon.prochainVidage();
    if (echeance === null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      tampon.vider(Date.now());
      if (tampon.enAttente() > 0) planifierVidage();
    }, Math.max(0, echeance - Date.now()));
  }, []);

  const ajouterBulles = useCallback((type: TypeReaction, n: number) => {
    if (n <= 0) return;
    setBulles((prev) => {
      const neuves: BulleReaction[] = [];
      for (let i = 0; i < n; i++) {
        const index = compteurBulle.current++;
        neuves.push({ id: `r${index}`, type, index });
      }
      const tout = prev.concat(neuves);
      return tout.length > MAX_BULLES_SIMULTANEES ? tout.slice(tout.length - MAX_BULLES_SIMULTANEES) : tout;
    });
  }, []);

  const retirerBulle = useCallback((id: string) => {
    setBulles((prev) => (prev.some((b) => b.id === id) ? prev.filter((b) => b.id !== id) : prev));
  }, []);

  const reagir = useCallback((type: TypeReaction = 'like') => {
    const tampon = tamponRef.current;
    if (!tampon) return;
    try { navigator.vibrate?.(10); } catch { /* pas de vibreur */ }
    // Animation locale IMMÉDIATE, même si l'envoi est tronqué. Mouvement réduit : jamais
    // plus d'une bulle à l'écran, même en tapant 20 fois (le compteur, lui, avance).
    if (reducedRef.current) {
      setBulles((prev) => (prev.length ? prev : [{ id: `r${compteurBulle.current}`, type, index: compteurBulle.current++ }]));
    } else {
      ajouterBulles(type, 1);
    }
    if (tampon.ajouter(type, Date.now())) {
      commit(ajouterLocal(etatRef.current, type));
      planifierVidage();
    }
  }, [ajouterBulles, planifierVidage, commit]);

  const recevoirLot = useCallback((payload: unknown) => {
    const lot = payload as Partial<LotReactions> | null;
    if (!lot || lot.from === userIdRef.current) return; // écho de soi-même : déjà compté
    const avant = etatRef.current;
    const apres = appliquerLot(avant, lot, Date.now());
    if (apres === avant) return;
    commit(apres);
    const reduced = reducedRef.current;
    for (const k of ['like', 'bravo', 'feu'] as TypeReaction[]) {
      const n = apres.totaux[k] - avant.totaux[k];
      ajouterBulles(k, bullesAAfficher(n, reduced));
      if (reduced && n > 0) break; // 1 bulle en tout
    }
  }, [ajouterBulles, commit]);

  const recevoirTotal = useCallback((payload: unknown) => {
    const p = payload as { totaux?: unknown } | null;
    if (!p) return;
    commit(synchroTotal(etatRef.current, p.totaux));
  }, [commit]);

  // Hôte : ré-annonce le total (≤ 1 / periodeTotalMs, et seulement s'il a changé).
  useEffect(() => {
    if (!estHote) return;
    let dernier: Totaux | null = null;
    let dernierMs = -Infinity;
    const id = setInterval(() => {
      const now = Date.now();
      const t = etatRef.current.totaux;
      if (!doitAnnoncerTotal(dernier, t, dernierMs, now, periodeTotalMs)) return;
      dernier = t;
      dernierMs = now;
      envoyerRef.current(EVT_TOTAL, { from: userIdRef.current, totaux: t });
    }, INTERVALLE_TOTAL_VERIF_MS);
    return () => clearInterval(id);
  }, [estHote, periodeTotalMs]);

  return {
    totaux: etat.totaux,
    total: totalDe(etat.totaux),
    bulles,
    reagir,
    recevoirLot,
    recevoirTotal,
    retirerBulle,
  };
}
