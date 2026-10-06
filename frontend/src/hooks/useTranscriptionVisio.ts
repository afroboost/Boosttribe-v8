import { useEffect, useRef, useState } from 'react';
import {
  connecterOpenAI, creerChrono, segmentDepuisEvenement,
  type ConnecteurTranscription, type ConnexionTranscription, type SegmentVoix,
} from '@/lib/transcriptionVisio';

/**
 * 🎙️ 06/10 — Transcription en direct de la voix du participant à l'écran (HÔTE seul).
 *
 * - Travaille sur une COPIE (`clone()`) de la piste reçue : la piste jouée, son volume, sa
 *   coupure et son relais restent ceux de `usePeerAudio`, intacts.
 * - S'arrête dès que `actif` passe à faux ou que la voix change : connexion fermée, copie arrêtée.
 * - Aucun état objet : seulement des primitives (aucune boucle de rendu possible).
 */
export type EtatTranscription = 'arret' | 'connexion' | 'ecoute' | 'erreur';

export function useTranscriptionVisio(o: {
  actif: boolean;
  flux: MediaStream | null;
  obtenirJeton: () => Promise<{ ok: boolean; client_secret?: string; raison?: string }>;
  onSegment: (s: SegmentVoix & { latenceMs: number | null }) => void;
  connecteur?: ConnecteurTranscription;
}): { etat: EtatTranscription; raison: string | null } {
  const [etat, setEtat] = useState<EtatTranscription>('arret');
  const [raison, setRaison] = useState<string | null>(null);
  const [relance, setRelance] = useState(0);
  const relancesRef = useRef(0);
  const rappels = useRef(o);
  rappels.current = o;

  const piste = o.actif && o.flux ? o.flux.getAudioTracks()[0] || null : null;
  const pisteId = piste ? piste.id : '';

  useEffect(() => {
    if (!piste) { setEtat('arret'); setRaison(null); relancesRef.current = 0; return; }
    let annule = false;
    let connexion: ConnexionTranscription | null = null;
    const copie = piste.clone();
    const chrono = creerChrono();
    setEtat('connexion'); setRaison(null);
    (async () => {
      const j = await rappels.current.obtenirJeton().catch(() => ({ ok: false, raison: 'fournisseur_indisponible' } as { ok: boolean; client_secret?: string; raison?: string }));
      if (annule) return;
      if (!j.ok || !j.client_secret) { setEtat('erreur'); setRaison(j.raison || 'fournisseur_indisponible'); return; }
      const brancher = rappels.current.connecteur || connecterOpenAI;
      try {
        connexion = await brancher(copie, j.client_secret, (ev) => {
          const latenceMs = chrono.evenement(ev, Date.now());
          const seg = segmentDepuisEvenement(ev);
          if (seg && !annule) rappels.current.onSegment({ ...seg, latenceMs });
        }, () => {
          if (annule) return;
          setEtat('erreur'); setRaison('connexion_perdue');
          // Session coupée par le fournisseur (expiration, réseau) : on retente, au plus 2 fois.
          if (relancesRef.current < 2) { relancesRef.current += 1; setTimeout(() => setRelance((n) => n + 1), 2000); }
        });
        if (annule) { connexion.fermer(); return; }
        setEtat('ecoute');
      } catch {
        if (!annule) { setEtat('erreur'); setRaison('fournisseur_indisponible'); }
      }
    })();
    return () => {
      annule = true;
      try { connexion?.fermer(); } catch { /* déjà fermée */ }
      try { copie.stop(); } catch { /* déjà arrêtée */ }       // la COPIE seulement
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pisteId, relance]);

  return { etat, raison };
}
