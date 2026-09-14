import React, { useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Minus, Plus, FlipHorizontal2, X, Check } from 'lucide-react';
import type { Prompteur as EtatPrompteur } from '@/hooks/usePrompteur';

/**
 * ✍️ TiroirPrompteur — ÉCRIRE SON TEXTE SANS QUITTER LE DIRECT.
 *
 * LE MANQUE QU'IL COMBLE. Le texte se lit désormais sur la vidéo, mais il n'y avait
 * nulle part où l'ÉCRIRE une fois en Live vidéo : le panneau de préparation vit dans
 * la colonne de droite, et le plein écran le fait disparaître. Le coach se retrouvait
 * devant « Écris ton texte ci-dessous » sans aucun « ci-dessous ». Inutilisable.
 *
 * POURQUOI DANS LA ZONE CAMÉRA. Ce tiroir est monté à l'intérieur du conteneur qui
 * sert de cible au plein écran. C'est la seule façon d'être visible EN plein écran :
 * un élément rendu ailleurs dans la page n'existe tout simplement pas à l'écran tant
 * que le navigateur affiche l'élément plein écran.
 *
 * FEUILLE PAR LE BAS SUR MOBILE. Ancré en bas, hauteur bornée en `dvh` : quand le
 * clavier Samsung s'ouvre, la fenêtre visible rétrécit, la carte rétrécit avec elle et
 * les boutons restent atteignables. Ancré au centre dès que l'écran est large.
 *
 * PAS DE SECOND PROMPTEUR : tout passe par la prop `p`, l'instance UNIQUE
 * d'`usePrompteur`. Écrire ici, c'est écrire dans l'overlay et dans le panneau.
 * Le texte reste local — aucun réseau dans ce fichier, un banc le vérifie.
 */

const ROND = 'w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/10 text-white/75 '
  + 'hover:bg-white/20 transition-colors disabled:opacity-35 disabled:cursor-not-allowed';

export interface TiroirPrompteurProps {
  p: EtatPrompteur;
  /** Ferme le tiroir. Le texte est DÉJÀ enregistré : il n'y a rien à « valider ». */
  onFermer: () => void;
}

export const TiroirPrompteur: React.FC<TiroirPrompteurProps> = ({ p, onFermer }) => {
  const zoneRef = useRef<HTMLTextAreaElement | null>(null);

  // Le curseur arrive dans le champ : sur mobile, c'est ce qui ouvre le clavier sans
  // demander un deuxième geste. En fin de texte, pour reprendre là où on s'était arrêté.
  useEffect(() => {
    const el = zoneRef.current;
    if (!el) return;
    el.focus();
    try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* ignore */ }
  }, []);

  // Échap referme — sans jamais remonter à la page (qui quitterait le plein écran).
  const surTouche = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onFermer(); }
  };

  return (
    <div
      className="absolute inset-0 z-[140] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      data-testid="prompteur-tiroir"
      onKeyDown={surTouche}
      role="dialog"
      aria-modal="true"
      aria-label="Écrire le texte du prompteur"
    >
      {/* Cliquer à côté referme : le geste attendu d'une feuille, et une sortie de
          secours si un bouton passait sous le clavier. */}
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onFermer}
        data-testid="prompteur-tiroir-fond"
      />

      <div
        /* `dvh` suit le clavier ; `vh` reste le repli RÉEL des navigateurs qui l'ignorent
           (un style inline ne peut pas porter deux valeurs pour une même propriété : la
           variante `supports-[]` est la seule façon d'avoir un vrai repli). */
        className="relative flex w-full flex-col gap-3 rounded-t-2xl border border-white/10 bg-[#15151b] p-4
                   shadow-2xl max-h-[88vh] supports-[height:1dvh]:max-h-[88dvh] sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white">Texte du prompteur</h4>
          <button type="button" onClick={onFermer} className={ROND}
                  aria-label="Fermer" data-testid="prompteur-tiroir-fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          ref={zoneRef}
          value={p.script}
          onChange={(e) => p.setScript(e.target.value)}
          rows={6}
          placeholder="Écris ou colle ici le texte que tu veux lire face caméra…"
          className="min-h-[7rem] flex-1 resize-none overflow-y-auto rounded-xl border border-white/15 bg-white/5 px-3 py-2
                     text-base text-white placeholder-white/30 focus:border-[rgb(var(--bt-accent-rgb)/0.5)] focus:outline-none"
          data-testid="prompteur-tiroir-script"
        />

        {/* Réglages — les mêmes valeurs, la même instance, la même sauvegarde. */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="flex items-center gap-1 rounded-full bg-white/5 px-1 py-1" role="group" aria-label="Vitesse de défilement">
            <button type="button" className={ROND} onClick={p.moinsVite}
                    disabled={p.vitesse <= p.bornes.vitesseMin} aria-label="Réduire la vitesse"
                    data-testid="prompteur-tiroir-vitesse-moins">
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[3rem] text-center text-xs tabular-nums text-white/80"
                  data-testid="prompteur-tiroir-vitesse">{p.vitesse.toFixed(2).replace(/0$/, '')}×</span>
            <button type="button" className={ROND} onClick={p.plusVite}
                    disabled={p.vitesse >= p.bornes.vitesseMax} aria-label="Augmenter la vitesse"
                    data-testid="prompteur-tiroir-vitesse-plus">
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-full bg-white/5 px-1 py-1" role="group" aria-label="Taille du texte">
            <button type="button" className={ROND} onClick={p.plusPetit}
                    disabled={p.taille <= p.bornes.tailleMin} aria-label="Réduire la taille du texte"
                    data-testid="prompteur-tiroir-taille-moins">
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[3rem] text-center text-xs tabular-nums text-white/80"
                  data-testid="prompteur-tiroir-taille">{p.taille} px</span>
            <button type="button" className={ROND} onClick={p.plusGrand}
                    disabled={p.taille >= p.bornes.tailleMax} aria-label="Augmenter la taille du texte"
                    data-testid="prompteur-tiroir-taille-plus">
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <button type="button" onClick={() => p.setMiroir((m) => !m)}
                  className={ROND} aria-pressed={p.miroir}
                  title="Miroir — n'inverse que ton aperçu"
                  aria-label="Miroir" data-testid="prompteur-tiroir-miroir">
            <FlipHorizontal2 className="h-4 w-4" />
          </button>

          <button type="button" onClick={p.reinitialiser} className={ROND}
                  aria-label="Revenir au début du texte" data-testid="prompteur-tiroir-reset">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={p.basculerLecture}
            disabled={!p.script.trim()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: p.script.trim() ? 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' : 'rgba(255,255,255,0.12)' }}
            data-testid="prompteur-tiroir-play"
          >
            {p.enLecture ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {p.enLecture ? 'Pause' : 'Démarrer'}
          </button>
          <button
            type="button"
            onClick={onFermer}
            disabled={!p.script.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3
                       text-sm font-medium text-white/85 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="prompteur-tiroir-utiliser"
          >
            <Check className="h-4 w-4" /> Utiliser ce texte
          </button>
        </div>

        <p className="text-[11px] leading-snug text-white/40">
          Ton texte est enregistré sur cet appareil au fil de la frappe. Il n'est envoyé à personne,
          n'apparaît pas dans ta vidéo et reste invisible pour les participants.
        </p>
      </div>
    </div>
  );
};

export default TiroirPrompteur;
