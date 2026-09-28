/**
 * ❤ RÉACTIONS LIVE — calque de bulles flottantes + bouton « J'aime ».
 *
 * - `LiveReactionOverlay` : calque `pointer-events-none absolute inset-0`. Le parent le place
 *   dans une colonne étroite à droite de la vidéo. Chaque bulle monte ~2 s avec une légère
 *   dérive et un fondu, puis se retire au `animationend` (aucune fuite : ≤ 24 bulles).
 * - `LiveReactionButton` : bouton rond ≥ 44 px ; appui court = ❤, appui long = petit éventail
 *   (❤ / Bravo / Énergie) si `types` en contient plus d'un.
 *
 * Icônes : SVG lucide teintés `var(--bt-accent)` — jamais d'emoji comme icône d'interface.
 */
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Flame, Heart, Sparkles, type LucideIcon } from 'lucide-react';
import { formaterCompteur, parametresBulle, type TypeReaction } from '@/lib/liveReactions';
import type { BulleReaction } from '@/hooks/useLiveReactions';

export const ICONES_REACTION: Record<TypeReaction, LucideIcon> = { like: Heart, bravo: Sparkles, feu: Flame };
export const LIBELLES_REACTION: Record<TypeReaction, string> = { like: "J'aime", bravo: 'Bravo', feu: 'Énergie' };

const CSS = `
@keyframes bt-reac-monte {
  0%   { transform: translate3d(0, 0, 0) scale(.4); opacity: 0; }
  12%  { transform: translate3d(calc(var(--bt-reac-dx) * .2), -12%, 0) scale(var(--bt-reac-s)); opacity: 1; }
  60%  { opacity: .95; }
  100% { transform: translate3d(var(--bt-reac-dx), -260px, 0) scale(calc(var(--bt-reac-s) * .9)); opacity: 0; }
}
@keyframes bt-reac-fondu {
  0% { opacity: 0; } 25% { opacity: 1; } 100% { opacity: 0; }
}
.bt-reac-bulle {
  position: absolute; bottom: 0; left: 50%; margin-left: -16px;
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  color: var(--bt-accent); will-change: transform, opacity;
  filter: drop-shadow(0 2px 6px rgb(0 0 0 / .35));
  animation: bt-reac-monte var(--bt-reac-d) cubic-bezier(.2,.7,.3,1) var(--bt-reac-delai) both;
}
.bt-reac-btn { transition: transform .12s ease; }
.bt-reac-btn:active { transform: scale(.88); }
@media (prefers-reduced-motion: reduce) {
  /* Fondu seul (aucun déplacement). !important : index.css ramène toute animation à
     0,01 ms en mouvement réduit — la bulle serait invisible (mesuré, QA 28/09). */
  .bt-reac-bulle { animation: bt-reac-fondu 600ms ease-out both; animation-duration: 600ms !important; }
  .bt-reac-btn, .bt-reac-btn:active { transition: none; transform: none; }
}
`;

function StyleReactions() {
  return <style>{CSS}</style>;
}

/* ───────────────────────────── Calque ───────────────────────────── */

export interface LiveReactionOverlayProps {
  bulles: BulleReaction[];
  /** Appelé au `animationend` — branchez `retirerBulle` du hook. */
  onFin?: (id: string) => void;
  className?: string;
}

const Bulle = memo(function Bulle({ bulle, onFin }: { bulle: BulleReaction; onFin: (id: string) => void }) {
  const Icone = ICONES_REACTION[bulle.type] ?? Heart;
  const p = parametresBulle(bulle.index);
  const style = {
    '--bt-reac-dx': `${p.deriveePx}px`,
    '--bt-reac-d': `${p.dureeMs}ms`,
    '--bt-reac-delai': `${p.delaiMs}ms`,
    '--bt-reac-s': String(p.echelle),
  } as CSSProperties;
  return (
    <span className="bt-reac-bulle" style={style} onAnimationEnd={() => onFin(bulle.id)} aria-hidden="true">
      <Icone size={26} strokeWidth={2} fill="currentColor" fillOpacity={0.85} />
    </span>
  );
});

export function LiveReactionOverlay({ bulles, onFin, className = '' }: LiveReactionOverlayProps) {
  // Sans `onFin`, on masque localement les bulles terminées (ensemble purgé à chaque rendu).
  const [finies, setFinies] = useState<ReadonlySet<string>>(() => new Set());
  const terminer = useCallback((id: string) => {
    if (onFin) { onFin(id); return; }
    setFinies((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, [onFin]);

  useEffect(() => {
    if (onFin || finies.size === 0) return;
    const presents = new Set(bulles.map((b) => b.id));
    let obsolete = false;
    finies.forEach((id) => { if (!presents.has(id)) obsolete = true; });
    if (obsolete) setFinies((prev) => new Set([...prev].filter((id) => presents.has(id))));
  }, [bulles, finies, onFin]);

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <StyleReactions />
      {bulles.map((b) => (finies.has(b.id) ? null : <Bulle key={b.id} bulle={b} onFin={terminer} />))}
    </div>
  );
}

/* ───────────────────────────── Bouton ───────────────────────────── */

export interface LiveReactionButtonProps {
  onReagir: (type: TypeReaction) => void;
  total: number;
  /** Types proposés (le premier = appui court). Défaut : cœur seul. */
  types?: TypeReaction[];
  className?: string;
}

const APPUI_LONG_MS = 420;

export function LiveReactionButton({ onReagir, total, types = ['like'], className = '' }: LiveReactionButtonProps) {
  const [eventail, setEventail] = useState(false);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appuiLong = useRef(false);
  const principal = types[0] ?? 'like';
  const autres = types.length > 1;
  const Icone = ICONES_REACTION[principal];

  const annulerMinuterie = () => { if (minuterie.current) { clearTimeout(minuterie.current); minuterie.current = null; } };
  useEffect(() => annulerMinuterie, []);

  const onPointerDown = () => {
    appuiLong.current = false;
    if (!autres) return;
    annulerMinuterie();
    minuterie.current = setTimeout(() => { appuiLong.current = true; setEventail(true); }, APPUI_LONG_MS);
  };
  const onClick = () => {
    annulerMinuterie();
    if (appuiLong.current) { appuiLong.current = false; return; }
    if (eventail) { setEventail(false); return; }
    onReagir(principal);
  };
  const choisir = (t: TypeReaction) => { onReagir(t); setEventail(false); };

  const libelle = `J'aime (${total})`;

  return (
    <div className={`relative flex flex-col items-center gap-0.5 ${className}`}>
      <StyleReactions />
      {autres && eventail && (
        <div
          role="menu"
          aria-label="Choisir une réaction"
          className="absolute bottom-full mb-2 flex flex-col gap-1.5 rounded-full bg-black/45 p-1.5 backdrop-blur-md"
        >
          {types.map((t) => {
            const I = ICONES_REACTION[t];
            return (
              <button
                key={t}
                type="button"
                role="menuitem"
                aria-label={LIBELLES_REACTION[t]}
                title={LIBELLES_REACTION[t]}
                onClick={() => choisir(t)}
                className="bt-reac-btn flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--bt-accent)]"
                style={{ color: 'var(--bt-accent)' }}
              >
                <I size={22} strokeWidth={2} fill="currentColor" fillOpacity={0.35} />
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        aria-label={libelle}
        title={autres ? "J'aime — appui long pour plus de réactions" : "J'aime"}
        aria-haspopup={autres ? 'menu' : undefined}
        aria-expanded={autres ? eventail : undefined}
        onPointerDown={onPointerDown}
        onPointerLeave={annulerMinuterie}
        onPointerCancel={annulerMinuterie}
        onContextMenu={(e) => { if (autres) e.preventDefault(); }}
        onClick={onClick}
        className="bt-reac-btn flex h-11 w-11 min-h-[44px] min-w-[44px] select-none items-center justify-center rounded-full border border-white/15 bg-black/35 backdrop-blur-md hover:bg-black/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bt-accent)]"
        style={{ color: 'var(--bt-accent)', WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
      >
        <Icone size={22} strokeWidth={2} fill="currentColor" fillOpacity={0.9} />
      </button>
      {total > 0 && (
        <span className="text-[11px] font-semibold leading-none text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]" aria-hidden="true">
          {formaterCompteur(total)}
        </span>
      )}
    </div>
  );
}

export default LiveReactionOverlay;
