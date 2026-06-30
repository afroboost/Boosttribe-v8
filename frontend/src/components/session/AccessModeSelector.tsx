import React from 'react';
import { UserPlus, UserX } from 'lucide-react';

/**
 * AccessModeSelector (CHANTIER 4a)
 *
 * Purely presentational component letting the COACH pick the session access mode.
 * - 'guest'   → public joins with just a first/last name. Listen/playback only
 *               (no chat, no visio).
 * - 'account' → name required. Full access: chat + visio.
 *
 * Self-contained: only React + lucide-react. No data fetching, no side effects.
 * The parent owns the value and handles the actual guest logic wiring.
 */

export type AccessMode = 'guest' | 'account';

export interface AccessModeSelectorProps {
  /** Currently selected access mode. */
  value: AccessMode;
  /** Called with the newly selected mode when the coach picks a card. */
  onChange: (mode: AccessMode) => void;
  /** Optional extra classes applied to the root container. */
  className?: string;
}

interface ModeOption {
  mode: AccessMode;
  label: string;
  desc: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const OPTIONS: ModeOption[] = [
  {
    mode: 'guest',
    label: 'Accès sans inscription',
    desc: "Le public rejoint avec juste un prénom/nom. Écoute/lecture seule (pas de chat ni de visio).",
    Icon: UserX,
  },
  {
    mode: 'account',
    label: 'Accès avec inscription',
    desc: 'Nom requis. Accès complet : chat + visio.',
    Icon: UserPlus,
  },
];

// Afroboost palette
const MAGENTA = '#D91CD2';
const PINK = '#FF2DAA';

export function AccessModeSelector({ value, onChange, className }: AccessModeSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Mode d'accès à la session"
      className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${className ?? ''}`}
    >
      {OPTIONS.map(({ mode, label, desc, Icon }) => {
        const selected = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(mode)}
            className="relative flex flex-col gap-2 rounded-2xl border p-4 text-left transition-all duration-200 focus:outline-none focus-visible:ring-2"
            style={{
              borderColor: selected ? MAGENTA : 'rgba(255,255,255,0.12)',
              backgroundColor: selected ? 'rgba(217,28,210,0.10)' : 'rgba(255,255,255,0.02)',
              boxShadow: selected ? `0 0 0 1px ${MAGENTA}, 0 4px 24px rgba(217,28,210,0.18)` : 'none',
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: selected
                    ? `linear-gradient(135deg, ${MAGENTA} 0%, ${PINK} 100%)`
                    : 'rgba(255,255,255,0.06)',
                }}
              >
                <Icon className="h-4 w-4 text-white" />
              </span>
              <span
                className="font-semibold"
                style={{ color: selected ? '#fff' : 'rgba(255,255,255,0.9)' }}
              >
                {label}
              </span>
              {/* Radio dot indicator */}
              <span
                aria-hidden="true"
                className="ml-auto flex h-5 w-5 items-center justify-center rounded-full border"
                style={{ borderColor: selected ? MAGENTA : 'rgba(255,255,255,0.25)' }}
              >
                {selected && (
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: MAGENTA }}
                  />
                )}
              </span>
            </div>
            <p className="text-sm leading-snug" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {desc}
            </p>
          </button>
        );
      })}
    </div>
  );
}

export default AccessModeSelector;
