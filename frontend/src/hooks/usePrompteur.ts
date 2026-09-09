import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  VITESSE_MIN, VITESSE_MAX, VITESSE_PAS, TAILLE_MIN, TAILLE_MAX, TAILLE_PAS,
  bornerVitesse, bornerTaille, estChampDeSaisie,
} from '@/lib/studioLogic';

/**
 * 📜 usePrompteur — LE prompteur, une seule fois, pour les deux écrans.
 *
 * POURQUOI CE HOOK EXISTE. Le prompteur vivait entièrement dans `StudioPage`. Le
 * monter aussi dans la session Live imposait de choisir : dupliquer l'état (deux
 * textes, deux réglages, deux Play/Pause qui divergent dès la première évolution),
 * ou l'extraire. On l'extrait.
 *
 * CE QUI EST PARTAGÉ, ET C'EST LE POINT : le TEXTE et les RÉGLAGES vivent sous les
 * MÊMES clés `localStorage` qu'avant. Le coach écrit son script dans la session Live,
 * il le retrouve sur `/studio`, et inversement. Ce n'est pas un effet de bord : c'est
 * la raison d'être de l'extraction.
 *
 * CONFIDENTIALITÉ, inchangée : le texte ne quitte JAMAIS le navigateur. Aucune
 * requête, aucun socket, aucune piste WebRTC, aucun log de contenu. Il est mémorisé
 * localement pour être retrouvé, et c'est tout.
 */

/** Mêmes clés qu'avant l'extraction : le script existant n'est pas perdu. */
export const CLE_SCRIPT = 'bt_studio_script';
export const CLE_REGLAGES = 'bt_studio_reglages';

export interface ReglagesPrompteur {
  vitesse: number;
  taille: number;
  miroir: boolean;
  compteur: boolean;
}

const DEFAUT: ReglagesPrompteur = { vitesse: 1, taille: 44, miroir: true, compteur: true };

export function lireReglages(): ReglagesPrompteur {
  try {
    const brut = localStorage.getItem(CLE_REGLAGES);
    if (!brut) return DEFAUT;
    const r = JSON.parse(brut) as Partial<ReglagesPrompteur>;
    return {
      vitesse: typeof r.vitesse === 'number' ? bornerVitesse(r.vitesse) : DEFAUT.vitesse,
      taille: typeof r.taille === 'number' ? bornerTaille(r.taille) : DEFAUT.taille,
      miroir: typeof r.miroir === 'boolean' ? r.miroir : DEFAUT.miroir,
      compteur: typeof r.compteur === 'boolean' ? r.compteur : DEFAUT.compteur,
    };
  } catch { return DEFAUT; }
}

export interface Prompteur {
  script: string;
  setScript: (s: string) => void;
  vitesse: number;
  taille: number;
  miroir: boolean;
  compteurActif: boolean;
  enLecture: boolean;
  /** Décompte 3-2-1 en cours (null = aucun). */
  compteA: number | null;
  setMiroir: (f: (m: boolean) => boolean) => void;
  setCompteurActif: (f: (c: boolean) => boolean) => void;
  plusVite: () => void;
  moinsVite: () => void;
  plusGrand: () => void;
  plusPetit: () => void;
  basculerLecture: () => void;
  reinitialiser: () => void;
  /** À passer au composant `Prompteur` : la fin du texte arrête la lecture. */
  surFin: () => void;
  bornes: {
    vitesseMin: number; vitesseMax: number; tailleMin: number; tailleMax: number;
  };
}

/**
 * @param raccourcisActifs Espace / ↑ ↓ / Début. FAUX par défaut : dans la session
 *   Live, la barre d'espace appartient déjà au lecteur audio, et deux consommateurs
 *   d'une même touche produisent un comportement que personne ne peut prévoir.
 */
export function usePrompteur(raccourcisActifs = false): Prompteur {
  const init = useMemo(lireReglages, []);
  const [script, setScript] = useState<string>(() => {
    try { return localStorage.getItem(CLE_SCRIPT) || ''; } catch { return ''; }
  });
  const [vitesse, setVitesse] = useState(init.vitesse);
  const [taille, setTaille] = useState(init.taille);
  const [miroir, setMiroir] = useState(init.miroir);
  const [compteurActif, setCompteurActif] = useState(init.compteur);
  const [enLecture, setEnLecture] = useState(false);
  const [compteA, setCompteA] = useState<number | null>(null);

  // Le script reste LOCAL. Aucune écriture réseau ici, volontairement.
  useEffect(() => {
    try { localStorage.setItem(CLE_SCRIPT, script); } catch { /* quota / navigation privée */ }
  }, [script]);
  useEffect(() => {
    try {
      localStorage.setItem(CLE_REGLAGES, JSON.stringify({ vitesse, taille, miroir, compteur: compteurActif }));
    } catch { /* ignore */ }
  }, [vitesse, taille, miroir, compteurActif]);

  const demarrerLecture = useCallback(() => {
    if (!script.trim()) return;
    if (compteurActif) { setCompteA(3); return; }   // le décompte lancera la lecture
    setEnLecture(true);
  }, [script, compteurActif]);

  const basculerLecture = useCallback(() => {
    if (compteA !== null) return;   // décompte en cours : on ne double-déclenche pas
    if (enLecture) setEnLecture(false);
    else demarrerLecture();
  }, [enLecture, compteA, demarrerLecture]);

  const reinitialiser = useCallback(() => {
    setEnLecture(false);
    setCompteA(null);
  }, []);

  // ⏱️ Décompte 3-2-1 — il ne démarre QUE le prompteur. Jamais un Live, jamais un
  //    enregistrement, jamais la musique.
  useEffect(() => {
    if (compteA === null) return;
    if (compteA === 0) { setCompteA(null); setEnLecture(true); return; }
    const id = window.setTimeout(() => setCompteA((n) => (n === null ? null : n - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [compteA]);

  // ⌨️ Raccourcis — inertes dès que l'utilisateur écrit dans un champ, sinon Espace
  //    insérerait une espace dans le script au lieu de mettre en pause.
  useEffect(() => {
    if (!raccourcisActifs) return undefined;
    const surTouche = (e: KeyboardEvent) => {
      const c = e.target as HTMLElement | null;
      if (estChampDeSaisie(c?.tagName, !!c?.isContentEditable)) return;
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); basculerLecture(); }
      else if (e.key === 'ArrowUp' || e.key === '+') { e.preventDefault(); setVitesse((v) => bornerVitesse(v + VITESSE_PAS)); }
      else if (e.key === 'ArrowDown' || e.key === '-') { e.preventDefault(); setVitesse((v) => bornerVitesse(v - VITESSE_PAS)); }
      else if (e.key === 'Home') { e.preventDefault(); reinitialiser(); }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [raccourcisActifs, basculerLecture, reinitialiser]);

  return {
    script, setScript, vitesse, taille, miroir, compteurActif, enLecture, compteA,
    setMiroir, setCompteurActif,
    plusVite: () => setVitesse((v) => bornerVitesse(v + VITESSE_PAS)),
    moinsVite: () => setVitesse((v) => bornerVitesse(v - VITESSE_PAS)),
    plusGrand: () => setTaille((t) => bornerTaille(t + TAILLE_PAS)),
    plusPetit: () => setTaille((t) => bornerTaille(t - TAILLE_PAS)),
    basculerLecture, reinitialiser,
    surFin: () => setEnLecture(false),
    bornes: {
      vitesseMin: VITESSE_MIN, vitesseMax: VITESSE_MAX,
      tailleMin: TAILLE_MIN, tailleMax: TAILLE_MAX,
    },
  };
}

export default usePrompteur;
