import React from 'react';
import { Sparkles } from 'lucide-react';
import { LIBELLES_BEAUTE, type NiveauBeaute } from '@/lib/beauteLogic';
import type { UseBeauteVisageReturn } from '@/hooks/useBeauteVisage';

/**
 * ✨ EMBELLIR LE VISAGE — le contrôle (à placer dans le menu ⋮ du live par l'agent UI).
 *
 * Trois choix explicites : Désactivé / Léger / Moyen. Rien d'autre : pas de curseur, pas de
 * jargon. L'option n'est rendue que si l'appareil la supporte (`supporte`), et le message de
 * coupure automatique (« appareil trop lent ») est discret et fermable.
 *
 * Props = le retour de `useBeauteVisage` + `compact` (une ligne, pour un menu) ou bloc.
 */
export interface BeauteToggleProps {
  beaute: UseBeauteVisageReturn;
  /** Rendu sur une ligne (menu ⋮). */
  compact?: boolean;
  className?: string;
}

const NIVEAUX: NiveauBeaute[] = ['off', 'leger', 'moyen'];

const BeauteToggle: React.FC<BeauteToggleProps> = ({ beaute, compact = true, className = '' }) => {
  if (!beaute.supporte) return null;
  const { niveau, setNiveau, avis, effacerAvis, actif } = beaute;
  return (
    <div className={`${compact ? 'flex items-center gap-2' : 'space-y-2'} ${className}`} data-testid="beaute-toggle">
      <span className="flex items-center gap-1.5 text-[13px] text-white/80 min-w-0">
        <Sparkles className={`w-4 h-4 flex-shrink-0 ${actif ? 'text-[var(--bt-accent)]' : 'text-white/60'}`} aria-hidden />
        <span className="truncate">Embellir le visage</span>
      </span>
      <div className="flex items-center gap-1 ml-auto" role="radiogroup" aria-label="Embellir le visage">
        {NIVEAUX.map((n) => {
          const on = n === niveau;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`Embellir le visage : ${LIBELLES_BEAUTE[n]}`}
              onClick={() => setNiveau(n)}
              data-testid={`beaute-${n}`}
              className={`px-2 py-1 rounded-md text-[12px] transition-colors ${
                on
                  ? 'bg-[var(--bt-accent)] text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              {n === 'off' ? 'Off' : LIBELLES_BEAUTE[n]}
            </button>
          );
        })}
      </div>
      {avis && (
        <p className={`text-[11px] text-white/50 ${compact ? 'basis-full' : ''}`} role="status" data-testid="beaute-avis">
          {avis === 'perf'
            ? 'Embellissement désactivé : ton appareil ne suit pas en direct.'
            : 'Embellissement indisponible sur cet appareil.'}
          <button type="button" onClick={effacerAvis} className="ml-2 underline hover:text-white/80" aria-label="Fermer le message">
            Fermer
          </button>
        </p>
      )}
    </div>
  );
};

export default BeauteToggle;
