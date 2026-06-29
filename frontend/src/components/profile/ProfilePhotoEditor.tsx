import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { AvatarUploadCrop } from '@/components/profile/AvatarUploadCrop';

/**
 * 📷 Photo de profil modifiable à tout moment (upload + recadrage + persistance profiles.avatar_url).
 *
 * - <ProfilePhotoModal> : le modal seul (contrôlé), porté vers <body> pour échapper aux ancêtres
 *   en backdrop-filter (header / menu) qui créeraient un bloc englobant et le clipperaient.
 * - <ProfilePhotoEditor variant="avatar"> : pastille avatar cliquable (header desktop, toujours montée).
 *
 * Pour le menu hamburger (qui se referme), on utilise <ProfilePhotoModal> contrôlé au niveau racine
 * du menu afin que le modal SURVIVE à la fermeture du panneau déroulant.
 */

export const ProfilePhotoModal: React.FC<{ open: boolean; onClose: () => void; onSaved?: () => void }> = ({
  open, onClose, onSaved,
}) => {
  const { user, refreshProfile } = useAuth();
  if (!open || !user) return null;

  const handleComplete = async (url: string) => {
    if (supabase && user.id) {
      try {
        await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id);
        await refreshProfile();
      } catch { /* silencieux : ne bloque pas l'UI */ }
    }
    onClose();
    onSaved?.();
  };

  return createPortal(
    <AvatarUploadCrop
      userId={user.id}
      title="Modifier votre photo"
      subtitle="Choisissez une nouvelle image — elle remplacera l'ancienne."
      onComplete={handleComplete}
      onCancel={onClose}
    />,
    document.body,
  );
};

interface ProfilePhotoEditorProps {
  variant?: 'avatar' | 'menu';
  className?: string;
  onDone?: () => void;
}

export const ProfilePhotoEditor: React.FC<ProfilePhotoEditorProps> = ({ variant = 'menu', className = '', onDone }) => {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const trigger =
    variant === 'avatar' ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Modifier la photo"
        aria-label="Modifier la photo de profil"
        className={`group relative w-8 h-8 rounded-full bg-white/10 flex items-center justify-center overflow-hidden ring-1 ring-white/15 hover:ring-[#FF2DAA] transition ${className}`}
        data-testid="profile-photo-avatar-edit"
      >
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <User size={16} className="text-white/70" />
        )}
        <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/50">
          <Camera size={13} className="text-white" />
        </span>
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-3 px-3 py-3 rounded-lg text-white/80 hover:bg-white/10 text-left ${className}`}
        data-testid="profile-photo-menu-edit"
      >
        <Camera size={18} /> Modifier la photo
      </button>
    );

  return (
    <>
      {trigger}
      <ProfilePhotoModal open={open} onClose={() => setOpen(false)} onSaved={onDone} />
    </>
  );
};

export default ProfilePhotoEditor;
