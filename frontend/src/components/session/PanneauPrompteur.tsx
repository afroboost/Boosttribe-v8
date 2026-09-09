import React, { useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Minus, Plus, FlipHorizontal2, ScrollText, ChevronUp } from 'lucide-react';
import { Prompteur, type PrompteurHandle } from '@/components/studio/Prompteur';
import { usePrompteur } from '@/hooks/usePrompteur';

/**
 * 📜 PanneauPrompteur — le prompteur LÀ OÙ LE COACH TRAVAILLE DÉJÀ.
 *
 * LA DÉCISION PRODUIT. Le prompteur n'existait que sur `/studio`, une page séparée.
 * Or le coach est dans sa session Live : musique, playlist, participants, caméra,
 * Go Live. Lui demander de changer de page pour lire son texte, c'est lui demander
 * de quitter son direct. Le panneau vient donc à lui.
 *
 * CE N'EST PAS UN SECOND PROMPTEUR. L'affichage est le composant `Prompteur`
 * existant ; l'état, la persistance et le Play/Pause viennent de `usePrompteur`,
 * le même hook qu'utilise `/studio`. Un seul texte, une seule sauvegarde, une seule
 * logique de lecture — écrire ici, c'est écrire là-bas.
 *
 * CONFIDENTIALITÉ : le texte ne quitte pas le navigateur. Aucun `socket`, aucun
 * `axios`, aucune piste WebRTC dans ce fichier — un banc le vérifie.
 *
 * REPLIÉ PAR DÉFAUT : la caméra et les participants gardent leur place tant que le
 * coach n'ouvre pas le panneau, et un seul geste le referme.
 */

const ROND = 'w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 text-white/75 '
  + 'hover:bg-white/20 transition-colors disabled:opacity-35 disabled:cursor-not-allowed';

export interface PanneauPrompteurProps {
  className?: string;
  /** Hauteur de la zone de défilement. Plus courte sur mobile, où l'écran est rare. */
  hauteur?: number;
}

export const PanneauPrompteur: React.FC<PanneauPrompteurProps> = ({ className = '', hauteur = 190 }) => {
  const p = usePrompteur(false);   // raccourcis clavier OFF : la barre d'espace appartient au lecteur audio
  const ref = useRef<PrompteurHandle | null>(null);
  const [ouvert, setOuvert] = useState(false);

  const reinitialiser = () => { p.reinitialiser(); ref.current?.reset(); };

  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 overflow-hidden ${className}`}
         data-testid="live-prompteur">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={ouvert}
        data-testid="live-prompteur-toggle"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-white/85">
          <ScrollText className="w-4 h-4 text-[var(--bt-accent)]" /> Prompteur
        </span>
        <span className="inline-flex items-center gap-2">
          {/* L'état de lecture se lit SANS ouvrir le panneau : refermé pendant que le
              texte défile, rien d'autre ne le dirait. */}
          {p.enLecture && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--bt-accent)]"
                  data-testid="live-prompteur-en-lecture">en lecture</span>
          )}
          <ChevronUp className={`w-4 h-4 text-white/50 transition-transform ${ouvert ? '' : 'rotate-180'}`} />
        </span>
      </button>

      {ouvert && (
        <div className="px-3 pb-3 sm:px-4 sm:pb-4" data-testid="live-prompteur-corps">
          {/* Zone de défilement — fond sombre, texte lisible de loin. Elle ne recouvre
              RIEN : la caméra reste au-dessus, à sa place. */}
          <div className="relative rounded-xl bg-black/60 border border-white/10 overflow-hidden"
               style={{ height: hauteur }}>
            <Prompteur
              ref={ref}
              texte={p.script}
              tailleTexte={p.taille}
              vitesse={p.vitesse}
              enLecture={p.enLecture}
              onFin={p.surFin}
              className="absolute inset-0 px-3"
            />
            {p.compteA !== null && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60"
                   data-testid="live-prompteur-compte">
                <span className="text-6xl font-bold text-white tabular-nums" aria-live="assertive">{p.compteA}</span>
              </div>
            )}
            {!p.script.trim() && (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
                <p className="text-xs text-white/40">Écris ton texte ci-dessous, puis appuie sur ▶.</p>
              </div>
            )}
          </div>

          {/* Commandes — mêmes gestes que sur /studio, en plus compact. */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={p.basculerLecture}
              disabled={!p.script.trim()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: p.script.trim() ? 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' : '#555' }}
              aria-label={p.enLecture ? 'Mettre le prompteur en pause' : 'Démarrer le prompteur'}
              data-testid="live-prompteur-play"
            >
              {p.enLecture ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>

            <button type="button" onClick={reinitialiser} className={ROND}
                    aria-label="Revenir au début du texte" data-testid="live-prompteur-reset">
              <RotateCcw className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1 rounded-full bg-white/5 px-1 py-1" role="group" aria-label="Vitesse de défilement">
              <button type="button" className={ROND} onClick={p.moinsVite}
                      disabled={p.vitesse <= p.bornes.vitesseMin} aria-label="Réduire la vitesse"
                      data-testid="live-prompteur-vitesse-moins">
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[3rem] text-center text-xs tabular-nums text-white/80"
                    data-testid="live-prompteur-vitesse">{p.vitesse.toFixed(2).replace(/0$/, '')}×</span>
              <button type="button" className={ROND} onClick={p.plusVite}
                      disabled={p.vitesse >= p.bornes.vitesseMax} aria-label="Augmenter la vitesse"
                      data-testid="live-prompteur-vitesse-plus">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-full bg-white/5 px-1 py-1" role="group" aria-label="Taille du texte">
              <button type="button" className={ROND} onClick={p.plusPetit}
                      disabled={p.taille <= p.bornes.tailleMin} aria-label="Réduire la taille du texte"
                      data-testid="live-prompteur-taille-moins">
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[3rem] text-center text-xs tabular-nums text-white/80"
                    data-testid="live-prompteur-taille">{p.taille} px</span>
              <button type="button" className={ROND} onClick={p.plusGrand}
                      disabled={p.taille >= p.bornes.tailleMax} aria-label="Augmenter la taille du texte"
                      data-testid="live-prompteur-taille-plus">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <button type="button" onClick={() => p.setMiroir((m) => !m)}
                    className={ROND} aria-pressed={p.miroir}
                    title="Miroir — n'inverse que l'affichage du texte"
                    aria-label="Miroir du texte" data-testid="live-prompteur-miroir">
              <FlipHorizontal2 className="h-4 w-4" />
            </button>
          </div>

          <textarea
            value={p.script}
            onChange={(e) => p.setScript(e.target.value)}
            rows={3}
            placeholder="Écris ou colle ici le texte que tu veux lire face caméra…"
            className="mt-2 w-full resize-y rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[rgb(var(--bt-accent-rgb)/0.5)] focus:outline-none"
            data-testid="live-prompteur-script"
          />
          <p className="mt-1 text-[11px] leading-snug text-white/40">
            Ton texte reste sur cet appareil : il n'est envoyé à personne, n'apparaît pas dans ta vidéo
            et reste invisible pour les participants.
          </p>
        </div>
      )}
    </div>
  );
};

export default PanneauPrompteur;
