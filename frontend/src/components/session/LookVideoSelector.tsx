import React from 'react';
import { LIBELLES_LOOK, LOOKS, type LookId } from '@/lib/looksVideo';

/**
 * 🎨 LOOK VIDÉO — le contrôle de l'hôte, dans le menu ⋮ du Live.
 *
 * Un clic = rendu immédiat dans l'aperçu ET dans le flux publié (même canvas GPU que
 * l'embellissement, aucune republication : le Live n'est jamais interrompu).
 * Les avis (look coupé, résolution de traitement réduite) sont discrets mais jamais muets.
 */
export interface LookVideoSelectorProps {
  look: LookId;
  onChoisir: (l: LookId) => void;
  /** Look coupé automatiquement : 'perf' (appareil trop lent) ou 'erreur'. */
  avis?: 'perf' | 'erreur' | null;
  onFermerAvis?: () => void;
  /** Embellissement en retard : traitement réduit à ce grand côté (px). */
  palier?: number | null;
}

const LookVideoSelector: React.FC<LookVideoSelectorProps> = ({ look, onChoisir, avis = null, onFermerAvis, palier = null }) => (
  <div className="flex flex-col gap-2 w-full min-w-0" data-testid="look-video">
    <span className="text-[13px] text-white/80">Look vidéo</span>
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Look vidéo">
      {LOOKS.map((l) => {
        const on = l === look;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`Look vidéo : ${LIBELLES_LOOK[l]}`}
            onClick={() => onChoisir(l)}
            data-testid={`look-${l}`}
            className={`px-2 py-1 rounded-md text-[12px] transition-colors ${
              on ? 'bg-[var(--bt-accent)] text-white' : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            {LIBELLES_LOOK[l]}
          </button>
        );
      })}
    </div>
    {avis && (
      <p className="text-[11px] text-white/50" role="status" data-testid="look-avis">
        {avis === 'perf'
          ? 'Look retiré : ton appareil ne suit pas en direct. Image d’origine, pleine qualité.'
          : 'Look indisponible sur cet appareil.'}
        {onFermerAvis && (
          <button type="button" onClick={onFermerAvis} className="ml-2 underline hover:text-white/80" aria-label="Fermer le message">
            Fermer
          </button>
        )}
      </p>
    )}
    {palier && (
      <p className="text-[11px] text-white/50" role="status" data-testid="look-palier">
        Embellissement allégé pour rester fluide : image traitée à {palier} px.
      </p>
    )}
  </div>
);

export default LookVideoSelector;
