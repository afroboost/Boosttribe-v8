import React from 'react';
import { TEXTE_AVIS_VOIX } from '@/lib/transcriptionVisio';

/**
 * 🎙️ 06/10 — Avis montré au PARTICIPANT écouté en « Échanger en visio », AVANT toute transcription
 * et tant qu'elle dure. Son affichage déclenche l'accusé `ASSISTANT_VOIX_VU` : sans lui, l'hôte
 * n'écoute rien. Aucun bouton à cliquer, rien n'est demandé (pas de nouveau micro).
 */
export const AvisVoixParticipant: React.FC<{ visible: boolean; onAffiche: () => void }> = ({ visible, onAffiche }) => {
  const rappel = React.useRef(onAffiche);
  rappel.current = onAffiche;
  React.useEffect(() => { if (visible) rappel.current(); }, [visible]);
  if (!visible) return null;
  return (
    <div role="status" aria-live="polite" data-testid="avis-voix"
      className="fixed left-1/2 -translate-x-1/2 top-3 z-[70] max-w-[min(92vw,460px)] flex items-start gap-2 px-3 py-2 rounded-xl
        bg-black/80 backdrop-blur border border-[rgb(var(--bt-accent-rgb)/0.5)] text-white text-xs leading-snug shadow-lg">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-[var(--bt-accent)]">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <path d="M12 17v4" />
      </svg>
      <span>{TEXTE_AVIS_VOIX}</span>
    </div>
  );
};

export default AvisVoixParticipant;
