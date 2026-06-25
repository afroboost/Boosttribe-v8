import React, { useState, useRef, useCallback } from 'react';
import { Video, Image as ImageIcon, Link as LinkIcon, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { uploadSessionVideo } from '@/lib/paymentApi';
import { uploadSessionImage, SharedMedia } from '@/lib/supabaseClient';

interface MediaShareControlsProps {
  sessionId: string;
  onShare: (media: SharedMedia) => void;
  showToast: (msg: string, variant?: 'default' | 'success' | 'error' | 'warning') => void;
}

function detectLinkType(url: string): SharedMedia['type'] {
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
  if (/vimeo\.com/.test(url)) return 'vimeo';
  return 'link';
}

export const MediaShareControls: React.FC<MediaShareControlsProps> = ({ sessionId, onShare, showToast }) => {
  const [busy, setBusy] = useState<null | 'video' | 'image'>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleVideo = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBusy('video');
    try {
      const { url, error } = await uploadSessionVideo(file, sessionId);
      if (url) {
        onShare({ type: 'video', url, title: file.name, isPlaying: false, currentTime: 0, updatedAt: Date.now() });
        showToast('Les vidéos partagées sont automatiquement supprimées après 24h', 'default');
      } else {
        showToast(error || 'Échec de l\'envoi de la vidéo', 'error');
      }
    } finally {
      setBusy(null);
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

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3" data-testid="media-share-controls">
      <p className="text-white/70 text-sm font-medium">Partager un média</p>

      <div className="flex flex-wrap gap-2">
        <input ref={videoInputRef} type="file" accept="video/*" onChange={handleVideo} className="hidden" />
        <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImage} className="hidden" />
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => videoInputRef.current?.click()}
          className="border-white/20 text-white/80"
        >
          {busy === 'video' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Video className="w-4 h-4 mr-1" />}
          Vidéo
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => imageInputRef.current?.click()}
          className="border-white/20 text-white/80"
        >
          {busy === 'image' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ImageIcon className="w-4 h-4 mr-1" />}
          Image
        </Button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
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
          size="sm"
          onClick={handleLink}
          className="text-white border-none flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

export default MediaShareControls;
