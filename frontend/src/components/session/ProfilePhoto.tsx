import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ProfilePhotoProps {
  url?: string | null;
  name?: string | null;
  /** Taille de l'avatar en px (classe tailwind appliquée via style). */
  size?: number;
  className?: string;
}

// Avatar rond cliquable → ouvre une lightbox (fond sombre, clic extérieur pour fermer).
// Fallback initiales si pas de photo. Réutilisé dans les commentaires et la liste des participants.
export const ProfilePhoto: React.FC<ProfilePhotoProps> = ({ url, name, size = 28, className = '' }) => {
  const [open, setOpen] = useState(false);
  const initials = (name || '?').slice(0, 2).toUpperCase();

  const openLightbox = useCallback((e: React.MouseEvent) => {
    if (!url) return;
    e.stopPropagation();
    setOpen(true);
  }, [url]);

  return (
    <>
      <button
        type="button"
        onClick={openLightbox}
        disabled={!url}
        style={{ width: size, height: size }}
        className={`rounded-full overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0 ${url ? 'cursor-zoom-in hover:ring-2 hover:ring-[#8A2EFF]/50 transition' : 'cursor-default'} ${className}`}
        title={url ? `Voir la photo de ${name || ''}`.trim() : undefined}
        data-testid="profile-photo"
      >
        {url ? (
          <img src={url} alt={name || ''} className="w-full h-full object-cover" />
        ) : (
          <span className="text-white/60 text-[10px] font-medium">{initials}</span>
        )}
      </button>

      {open && url && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-6"
          onClick={() => setOpen(false)}
          data-testid="profile-lightbox"
        >
          <button
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white/80 hover:bg-white/20"
            title="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <img
              src={url}
              alt={name || ''}
              className="max-w-[90vw] max-h-[80vh] rounded-2xl object-contain shadow-2xl shadow-[#8A2EFF]/20 border border-white/10"
            />
            {name && <p className="text-white/80 text-sm font-medium">{name}</p>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default ProfilePhoto;
