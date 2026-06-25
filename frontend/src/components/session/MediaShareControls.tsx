import React, { useState, useRef, useCallback } from 'react';
import { Video, Image as ImageIcon, Link as LinkIcon, Loader2, Send, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { uploadSessionVideoDirect, uploadSessionImage, SharedMedia } from '@/lib/supabaseClient';

export type ShareMode = 'audio' | 'video' | 'image' | 'link';

interface MediaShareControlsProps {
  sessionId: string;
  onShare: (media: SharedMedia) => void;
  showToast: (msg: string, variant?: 'default' | 'success' | 'error' | 'warning') => void;
  audioPanel?: React.ReactNode; // panneau audio (TrackUploader) rendu en mode "Audio"
  mode: ShareMode;              // contrôlé par le parent : pilote TOUTE la zone centrale
  onModeChange: (mode: ShareMode) => void;
}

const MAX_VIDEO_SECONDS = 90 * 60; // 90 minutes

function detectLinkType(url: string): SharedMedia['type'] {
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
  if (/vimeo\.com/.test(url)) return 'vimeo';
  return 'link';
}

// Lit la durée d'un fichier vidéo (secondes)
function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration || 0); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    v.src = url;
  });
}

export const MediaShareControls: React.FC<MediaShareControlsProps> = ({ sessionId, onShare, showToast, audioPanel, mode, onModeChange }) => {
  const [busy, setBusy] = useState<null | 'video' | 'image'>(null);
  const [progress, setProgress] = useState(0);
  const [linkUrl, setLinkUrl] = useState('');
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleVideo = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    // Item 7 : durée max 90 min vérifiée côté client
    const duration = await getVideoDuration(file);
    if (duration > MAX_VIDEO_SECONDS + 1) {
      showToast(`Vidéo trop longue (${Math.round(duration / 60)} min). Maximum 90 minutes.`, 'error');
      return;
    }

    setBusy('video');
    setProgress(0);
    try {
      const { url, error } = await uploadSessionVideoDirect(file, sessionId, setProgress);
      if (url) {
        onShare({ type: 'video', url, title: file.name, isPlaying: false, currentTime: 0, updatedAt: Date.now() });
        showToast('Les vidéos partagées sont automatiquement supprimées après 24h', 'default');
      } else {
        showToast(error || 'Échec de l\'envoi de la vidéo', 'error');
      }
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }, [sessionId, onShare, showToast]);

  const handleImage = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBusy('image');
    try {
      const { url, error } = await uploadSessionImage(file, sessionId);
      if (url) {
        onShare({ type: 'image', url, title: file.name, updatedAt: Date.now() });
        showToast('Image partagée', 'success');
      } else {
        showToast(error || 'Échec de l\'envoi de l\'image', 'error');
      }
    } finally {
      setBusy(null);
    }
  }, [sessionId, onShare, showToast]);

  const handleLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      showToast('Lien invalide (http/https requis)', 'warning');
      return;
    }
    onShare({ type: detectLinkType(url), url, updatedAt: Date.now(), currentTime: 0 });
    setLinkUrl('');
    showToast('Contenu partagé', 'success');
  }, [linkUrl, onShare, showToast]);

  // Item 6 : sélecteur de mode (n'afficher que le panneau choisi)
  const modes: { id: ShareMode; label: string; icon: React.ReactNode; hidden?: boolean }[] = [
    { id: 'audio', label: 'Audio', icon: <Music className="w-4 h-4" />, hidden: !audioPanel },
    { id: 'video', label: 'Vidéo', icon: <Video className="w-4 h-4" /> },
    { id: 'image', label: 'Image', icon: <ImageIcon className="w-4 h-4" /> },
    { id: 'link', label: 'Lien vidéo', icon: <LinkIcon className="w-4 h-4" /> },
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3" data-testid="media-share-controls">
      <p className="text-white/70 text-sm font-medium">Partager</p>

      {/* Sélecteur de mode (responsive : s'enroule sur mobile) */}
      <div className="flex flex-wrap gap-1.5">
        {modes.filter(m => !m.hidden).map((m) => (
          <button
            key={m.id}
            onClick={() => onModeChange(m.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === m.id ? 'bg-[#8A2EFF] text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
            data-testid={`share-mode-${m.id}`}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {/* Panneau du mode choisi */}
      {mode === 'audio' && <div>{audioPanel}</div>}

      {mode === 'video' && (
        <div className="space-y-2">
          <input ref={videoInputRef} type="file" accept="video/*" onChange={handleVideo} className="hidden" />
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => videoInputRef.current?.click()}
            className="w-full border-white/20 text-white/80"
          >
            {busy === 'video' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Video className="w-4 h-4 mr-2" />}
            {busy === 'video' ? `Envoi… ${progress}%` : 'Choisir une vidéo (max 90 min)'}
          </Button>
          {busy === 'video' && (
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #8A2EFF 0%, #FF2FB3 100%)' }} />
            </div>
          )}
          <p className="text-white/30 text-[11px]">Supprimée automatiquement après 24h.</p>
        </div>
      )}

      {mode === 'image' && (
        <div>
          <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImage} className="hidden" />
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => imageInputRef.current?.click()}
            className="w-full border-white/20 text-white/80"
          >
            {busy === 'image' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ImageIcon className="w-4 h-4 mr-2" />}
            Choisir une image
          </Button>
        </div>
      )}

      {mode === 'link' && (
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <LinkIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLink(); }}
              placeholder="Lien YouTube, Vimeo…"
              className="pl-8 bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
            />
          </div>
          <Button
            onClick={handleLink}
            className="text-white border-none flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default MediaShareControls;
