import React, { useEffect, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { lienDecouvrir, secondesRestantes, type PromoPublique } from '@/lib/livePromo';

/**
 * 📣 La promo DIFFUSÉE — en bas du Live, au-dessus des commentaires, chez TOUS les participants.
 * Le temps restant vient de `ends_at` (serveur) corrigé de l'écart d'horloge : un rechargement
 * ou un nouvel arrivant voit le MÊME décompte. À 0, la bannière disparaît d'elle-même.
 * Texte rendu comme TEXTE (React échappe) ; le seul lien possible est http(s) (« Découvrir »).
 */
export function LivePromoBanner({ promo, decalageMs, estHote = false, onArreter, remplir = false, tailleImage, mesureRef }: {
  promo: PromoPublique; decalageMs: number; estHote?: boolean; onArreter?: () => void;
  /** 01/10 : fenêtre placée/redimensionnée — la carte occupe toute la fenêtre, contenu centré. */
  remplir?: boolean;
  /** 01/10 : taille du visuel (px) qui suit la hauteur demandée de la fenêtre. */
  tailleImage?: number;
  /** 01/10 : mesure de la colonne texte (hauteur minimale de la fenêtre → rien n'est coupé). */
  mesureRef?: React.Ref<HTMLDivElement>;
}) {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setMaintenant(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const reste = secondesRestantes(promo.ends_at, decalageMs, maintenant);
  if (reste <= 0) return null;
  const lien = lienDecouvrir(promo.external_url);
  return (
    <div className={`pointer-events-auto relative w-full overflow-hidden rounded-2xl border border-white/15 bg-black/70 backdrop-blur-md shadow-xl${remplir ? ' flex h-full flex-col' : ''}`}
         role="region" aria-label="Promotion" data-testid="live-promo-banniere">
      <div className={`flex gap-3 p-2.5${remplir ? ' min-h-0 flex-1 items-center' : ' items-stretch'}`}>
        {promo.media_url ? (
          <img src={promo.media_url} alt="" draggable={false}
               className={`${tailleImage ? '' : 'h-16 w-16 sm:h-20 sm:w-20 '}flex-shrink-0 rounded-xl object-cover bg-black`}
               style={tailleImage ? { width: tailleImage, height: tailleImage } : undefined}
               data-testid="live-promo-image" />
        ) : null}
        <div className="min-w-0 flex-1" ref={mesureRef}>
          <p className="text-[10px] uppercase tracking-wider text-white/50">
            Promo{promo.participant_name ? ` · ${promo.participant_name}` : ''} · <span className="tabular-nums" data-testid="live-promo-reste">{reste} s</span>
          </p>
          <p className="truncate text-sm font-bold text-white" data-testid="live-promo-titre">{promo.title}</p>
          {promo.body ? <p className="line-clamp-2 text-xs text-white/80 [overflow-wrap:anywhere]" data-testid="live-promo-texte">{promo.body}</p> : null}
          {lien ? (
            <a href={lien} target="_blank" rel="noopener noreferrer" draggable={false}
               className="mt-1.5 inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold text-white"
               style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
               data-testid="live-promo-decouvrir">
              Découvrir <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {estHote && onArreter ? (
          <button type="button" onClick={onArreter} aria-label="Arrêter la promo" title="Arrêter la promo"
                  className="self-start inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
                  data-testid="live-promo-arreter">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="h-0.5 bg-white/10" aria-hidden="true">
        <div className="h-full bg-[var(--bt-accent)] transition-[width] duration-500"
             style={{ width: `${Math.min(100, (reste / Math.max(1, promo.duration_seconds)) * 100)}%` }} />
      </div>
    </div>
  );
}

export default LivePromoBanner;
