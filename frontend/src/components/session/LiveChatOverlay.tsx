/**
 * 💬 CHAT LIVE TRANSPARENT — les commentaires POSÉS sur la vidéo.
 *
 * Pas de carte, pas de fond opaque : la vidéo reste le sujet. La lisibilité vient
 * d'une ombre de texte appuyée et d'un voile sombre très léger en bas de zone ; le
 * haut s'estompe (mask-image) pour que les anciens messages disparaissent en montant.
 *
 * Le parent POSITIONNE ce bloc (bas-gauche de la zone vidéo) ; ici on remplit la zone
 * reçue, aligné en bas. `pointer-events-none` : la vidéo et les boutons dessous
 * restent cliquables. Seul le dernier message est annoncé aux lecteurs d'écran.
 */
import React, { useState } from 'react';
import type { ChatMessage } from '@/components/session/ChatPanel';
import { derniersMessages, initiales } from '@/lib/liveChat';

export type LiveChatMessage = ChatMessage & { question?: boolean };

export interface LiveChatOverlayProps {
  messages: LiveChatMessage[];
  meUserId: string;
  /** userIds affichés avec le badge « Hôte ». */
  hostUserIds?: string[];
  /** true → rien de visible (le composant reste monté). */
  masques?: boolean;
  /** Nombre de messages rendus (défaut 6). */
  maxVisibles?: number;
  /** Hauteur maximale fournie par le parent, ex. '35%'. */
  hauteurMax?: string;
}

const OMBRE = '0 1px 2px rgba(0,0,0,.9), 0 0 6px rgba(0,0,0,.45)';
const FONDU = 'linear-gradient(to top, black 0%, black 55%, transparent 100%)';

function Avatar({ nom, photoUrl }: { nom: string; photoUrl?: string | null }) {
  const [erreur, setErreur] = useState(false);
  if (photoUrl && !erreur) {
    return (
      <img
        src={photoUrl}
        alt=""
        loading="lazy"
        onError={() => setErreur(true)}
        className="w-6 h-6 shrink-0 rounded-full object-cover ring-1 ring-white/30"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="w-6 h-6 shrink-0 rounded-full grid place-items-center text-[10px] font-bold text-white bg-[rgb(var(--bt-accent-rgb)/0.55)] ring-1 ring-white/30"
      style={{ textShadow: 'none' }}
    >
      {initiales(nom)}
    </span>
  );
}

export function LiveChatOverlay({
  messages,
  meUserId,
  hostUserIds = [],
  masques = false,
  maxVisibles = 6,
  hauteurMax,
}: LiveChatOverlayProps) {
  const visibles = derniersMessages(messages, maxVisibles);
  const dernier = visibles[visibles.length - 1];

  return (
    <div
      className={`relative h-full w-full flex flex-col justify-end pointer-events-none select-none ${masques ? 'invisible' : ''}`}
      style={hauteurMax ? { maxHeight: hauteurMax } : undefined}
      aria-hidden={masques || undefined}
      data-testid="live-chat-overlay"
    >
      {/* Voile très léger : lisibilité sur vidéo claire, sans cacher l'image. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/25 via-black/10 to-transparent"
        style={{ WebkitMaskImage: FONDU, maskImage: FONDU }}
      />
      <ul
        className="relative flex flex-col justify-end gap-1.5 overflow-hidden min-h-0 px-2 pb-1"
        style={{ WebkitMaskImage: FONDU, maskImage: FONDU }}
        aria-label="Commentaires du live"
      >
        {visibles.map((m) => {
          const hote = hostUserIds.includes(m.userId);
          const moi = m.userId === meUserId;
          return (
            <li
              key={m.id}
              className="flex items-start gap-2 max-w-[min(100%,22rem)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
              style={{ textShadow: OMBRE }}
            >
              <Avatar nom={m.name} photoUrl={m.photoUrl} />
              <p className="min-w-0 rounded-2xl bg-black/25 px-2 py-0.5 text-[13px] sm:text-sm leading-snug text-white break-words line-clamp-3">
                <span className={`font-semibold mr-1.5 ${moi ? 'text-white' : 'text-white/90'}`}>
                  {m.name || 'Invité'}
                </span>
                {hote && (
                  <span className="inline-block align-[1px] mr-1.5 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wide text-white bg-[rgb(var(--bt-accent-rgb)/0.6)]">
                    Hôte
                  </span>
                )}
                {m.question && (
                  <span className="inline-block align-[1px] mr-1.5 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wide text-white bg-white/20 ring-1 ring-[var(--bt-accent)]">
                    Question
                  </span>
                )}
                <span className="text-white">{m.text}</span>
              </p>
            </li>
          );
        })}
      </ul>
      {/* Annonceur : uniquement le dernier message, jamais toute la liste. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {!masques && dernier
          ? `${dernier.name || 'Invité'}${dernier.question ? ' pose une question' : ''} : ${dernier.text}`
          : ''}
      </div>
    </div>
  );
}

export default LiveChatOverlay;
