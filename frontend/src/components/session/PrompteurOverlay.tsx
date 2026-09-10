import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Play, Pause, RotateCcw, Minus, Plus, X } from 'lucide-react';
import { Prompteur, type PrompteurHandle } from '@/components/studio/Prompteur';
import type { Prompteur as EtatPrompteur } from '@/hooks/usePrompteur';

/**
 * 📜 PrompteurOverlay — LE TEXTE SUR LA VIDÉO, pas à côté d'elle.
 *
 * POURQUOI. Un prompteur en panneau latéral demande au coach de REGARDER À DROITE
 * pendant qu'il parle à son objectif. Sur un téléphone tenu à bout de bras, c'est
 * un regard fuyant sur toute la séance. Le texte doit donc être posé SUR l'aperçu
 * caméra, le plus haut possible : c'est le bord le plus proche de l'objectif, donc
 * le moins de mouvement des yeux.
 *
 * CE N'EST PAS UN DEUXIÈME PROMPTEUR. C'est une PRÉSENTATION. L'état (texte,
 * vitesse, taille, Play/Pause, décompte) arrive par la prop `p` : l'instance
 * UNIQUE d'`usePrompteur` tenue par la page. Le panneau de préparation et cet
 * overlay lisent et écrivent le même objet — appuyer sur ▶ ici met « en lecture »
 * là-bas, parce que c'est le même « là-bas ».
 *
 * CONFIDENTIALITÉ — le point critique. Ce texte est une surface DOM LOCALE, posée
 * PAR-DESSUS l'élément <video>. Il n'est ni dessiné dans un canvas, ni réinjecté
 * dans un MediaStream, ni publié sur une piste WebRTC, ni synchronisé. Les
 * participants reçoivent la caméra, rien d'autre. Aucun `socket`, aucun `fetch`,
 * aucun `captureStream` dans ce fichier — un banc le vérifie.
 */

const ROND = 'w-8 h-8 inline-flex items-center justify-center rounded-full bg-black/55 text-white/80 '
  + 'hover:bg-black/75 transition-colors disabled:opacity-35 disabled:cursor-not-allowed backdrop-blur-sm';

export interface PrompteurOverlayProps {
  /** L'instance PARTAGÉE du prompteur (jamais un second `usePrompteur`). */
  p: EtatPrompteur;
  /**
   * Hauteur de la bande de texte, en CSS (`'58%'`, `'clamp(...)'`…). Volontairement
   * une valeur inline et non une classe : le pourcentage doit se résoudre contre
   * l'aperçu caméra, quelle que soit sa taille réelle.
   */
  hauteur?: string;
  /**
   * Largeur maximale de la colonne de texte. Sur un écran large, une bande qui
   * traverse tout le cadre force le regard à balayer de gauche à droite — le
   * contraire de ce qu'on veut face à un objectif. Elle borne aussi la « prise
   * d'élan » du texte : le composant `Prompteur` la calcule en pourcentage de la
   * LARGEUR, si bien qu'une bande très large mettrait une éternité à faire monter
   * la première ligne. `'none'` = pleine largeur (comportement de /studio).
   */
  largeurMax?: string;
  /**
   * « Prise d'élan » avant la première ligne. Courte par défaut ICI : posé sur une
   * vidéo, un prompteur doit montrer son texte DÈS qu'on l'ouvre. Une bande noire
   * vide pendant plusieurs secondes se lit comme une panne, pas comme une attente.
   */
  prise?: string;
  /** Petite barre de commandes sous le texte (session Live ; /studio a les siennes). */
  barre?: boolean;
  /** Décompte 3-2-1 rendu dans la bande (sinon le parent l'affiche à sa façon). */
  compte?: boolean;
  onFermer?: () => void;
}

export const PrompteurOverlay = forwardRef<PrompteurHandle, PrompteurOverlayProps>(function PrompteurOverlay(
  { p, hauteur = '58%', largeurMax = 'none', prise = '45%', barre = false, compte = false, onFermer },
  ref,
) {
  const interne = useRef<PrompteurHandle | null>(null);
  useImperativeHandle(ref, () => ({ reset: () => interne.current?.reset() }), []);

  const reinitialiser = () => { p.reinitialiser(); interne.current?.reset(); };

  return (
    // `pointer-events-none` : le texte flotte AU-DESSUS de la vidéo sans jamais lui
    // voler un clic (agrandir une vignette, épingler une caméra restent atteignables).
    // Seule la petite barre réactive les événements, pour elle-même.
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-[112]"
      style={{ height: hauteur }}
      data-testid="prompteur-overlay"
    >
      {/* Colonne CENTRÉE : le texte tombe au milieu du cadre, donc dans l'axe de
          l'objectif, et non étalé d'un bord à l'autre de l'écran. */}
      <div className="relative mx-auto h-full w-full" style={{ maxWidth: largeurMax }}>
        {/* Voile dégradé : le texte blanc reste lisible même sur une image claire,
            et le bas du cadre — donc le visage — reste parfaitement visible. */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/55 to-transparent" />

        <Prompteur
          ref={interne}
          texte={p.script}
          tailleTexte={p.taille}
          vitesse={p.vitesse}
          enLecture={p.enLecture}
          onFin={p.surFin}
          prise={prise}
          chute="60%"
          className="absolute inset-0 px-2 sm:px-8"
        />

        {compte && p.compteA !== null && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60"
               data-testid="prompteur-overlay-compte">
            <span className="text-6xl font-bold text-white tabular-nums" aria-live="assertive">{p.compteA}</span>
          </div>
        )}
      </div>

      {barre && (
        /* Barre DISCRÈTE, juste sous le texte : ce qui sert pendant qu'on parle, et
           rien de plus. Écrire le script, le miroir, le décompte restent dans le
           panneau de préparation — on ne remplit pas l'écran d'un direct. */
        <div
          /* La barre d'outils caméra du plein écran est ancrée à DROITE, à mi-hauteur.
             Sur un écran court (téléphone couché, petite fenêtre), elle remonte jusqu'à
             cette barre-ci. On lui réserve donc sa colonne — mesuré à 360, 412 et 430 px —
             et on autorise le retour à la ligne plutôt que le chevauchement. */
          className="pointer-events-none absolute inset-x-0 top-full mt-1.5 flex justify-center pl-3"
          style={{ paddingRight: 'max(4.25rem, env(safe-area-inset-right))' }}
        >
        <div
          className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5
                     rounded-2xl bg-black/40 px-2 py-1.5 backdrop-blur-sm"
          data-testid="prompteur-overlay-barre"
        >
          <button
            type="button"
            onClick={p.basculerLecture}
            disabled={!p.script.trim()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: p.script.trim() ? 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' : 'rgba(255,255,255,0.15)' }}
            aria-label={p.enLecture ? 'Mettre le prompteur en pause' : 'Démarrer le prompteur'}
            data-testid="prompteur-overlay-play"
          >
            {p.enLecture ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          <button type="button" onClick={reinitialiser} className={ROND}
                  aria-label="Revenir au début du texte" data-testid="prompteur-overlay-reset">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          <div className="flex items-center gap-0.5" role="group" aria-label="Vitesse de défilement">
            <button type="button" className={ROND} onClick={p.moinsVite}
                    disabled={p.vitesse <= p.bornes.vitesseMin} aria-label="Réduire la vitesse"
                    data-testid="prompteur-overlay-vitesse-moins">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[2.4rem] text-center text-[11px] tabular-nums text-white/85"
                  data-testid="prompteur-overlay-vitesse">{p.vitesse.toFixed(2).replace(/0$/, '')}×</span>
            <button type="button" className={ROND} onClick={p.plusVite}
                    disabled={p.vitesse >= p.bornes.vitesseMax} aria-label="Augmenter la vitesse"
                    data-testid="prompteur-overlay-vitesse-plus">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-0.5" role="group" aria-label="Taille du texte">
            <button type="button" className={ROND} onClick={p.plusPetit}
                    disabled={p.taille <= p.bornes.tailleMin} aria-label="Réduire la taille du texte"
                    data-testid="prompteur-overlay-taille-moins">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[2.4rem] text-center text-[11px] tabular-nums text-white/85"
                  data-testid="prompteur-overlay-taille">{p.taille} px</span>
            <button type="button" className={ROND} onClick={p.plusGrand}
                    disabled={p.taille >= p.bornes.tailleMax} aria-label="Augmenter la taille du texte"
                    data-testid="prompteur-overlay-taille-plus">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {onFermer && (
            <button type="button" onClick={onFermer} className={ROND}
                    aria-label="Fermer le prompteur" data-testid="prompteur-overlay-fermer">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        </div>
      )}
    </div>
  );
});

export default PrompteurOverlay;
