import React, { useState, useCallback, useRef } from 'react';
import RawCropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { Camera, Check, X, Loader2, Image as ImageIcon } from 'lucide-react';

// react-easy-crop v6 : son index.d.ts perd l'export par défaut comme valeur (export type *).
// Le runtime fonctionne ; on caste pour le typage JSX.
const Cropper = RawCropper as unknown as React.ComponentType<{
  image: string;
  crop: { x: number; y: number };
  zoom: number;
  aspect: number;
  cropShape?: 'rect' | 'round';
  showGrid?: boolean;
  onCropChange: (c: { x: number; y: number }) => void;
  onZoomChange: (z: number) => void;
  onCropComplete: (area: unknown, areaPixels: { x: number; y: number; width: number; height: number }) => void;
}>;
import { Button } from '@/components/ui/button';
import { uploadAvatar } from '@/lib/supabaseClient';
import { envoyerPhotoInvite } from '@/lib/paymentApi';
import { validerPhotoInvite } from '@/lib/inviteLive';

interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AvatarUploadCropProps {
  // userId connecté → upload Supabase ; null (participant anonyme) → dépôt serveur de la session
  userId: string | null;
  /** 👤 Invité anonyme : la photo est déposée sur le serveur (URL courte), plus jamais en base64. */
  sessionId?: string | null;
  title?: string;
  subtitle?: string;
  onComplete: (url: string) => void;
  onCancel?: () => void;
}

// Génère un blob carré recadré à partir de l'image et de la zone de crop (en pixels)
async function getCroppedBlob(imageSrc: string, crop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  const size = Math.min(crop.width, crop.height);
  const canvas = document.createElement('canvas');
  const OUTPUT = 512; // sortie 512x512
  canvas.width = OUTPUT;
  canvas.height = OUTPUT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas non supporté');

  ctx.drawImage(image, crop.x, crop.y, size, size, 0, 0, OUTPUT, OUTPUT);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Échec du recadrage'));
    }, 'image/jpeg', 0.85);
  });
}

export const AvatarUploadCrop: React.FC<AvatarUploadCropProps> = ({
  userId,
  sessionId = null,
  title = 'Votre photo de profil',
  subtitle = 'Ajoutez une photo pour continuer',
  onComplete,
  onCancel,
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const onCropComplete = useCallback((_: unknown, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  // 👤 Phase 1 : format vérifié AVANT tout (HEIC, taille), puis décodage RÉEL de l'image. Une image
  //    que le navigateur ne sait pas afficher donne un message, jamais un « Valider » qui ne réagit pas.
  //    Les grandes photos de téléphone sont réduites (1600 px) avant le recadrage : moins de mémoire.
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';                       // re-choisir la même photo redéclenche le choix
    if (!file) return;
    const verdict = validerPhotoInvite(file);
    if (!verdict.ok) { setError(verdict.erreur); return; }
    setError(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); setError('Ton navigateur ne peut pas préparer cette photo.'); return; }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      setCroppedAreaPixels(null);
      setImageSrc(c.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => { setError('Cette photo ne peut pas être ouverte sur ton appareil (format HEIC ?). Choisis une photo JPEG ou PNG.'); URL.revokeObjectURL(url); };
    img.src = url;
  }, []);

  const handleSave = useCallback(async () => {
    if (!imageSrc) { setError('Choisis d’abord une photo.'); return; }
    if (!croppedAreaPixels) { setError('La photo se prépare encore : patiente une seconde puis valide.'); return; }
    setUploading(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels);
      if (userId) {
        // Utilisateur connecté → upload vers le bucket "avatars" + profiles.avatar_url
        const { url, error: upErr } = await uploadAvatar(blob, userId);
        if (url) onComplete(url);
        else setError(upErr || 'Échec de l\'envoi');
      } else if (sessionId) {
        // 👤 Invité anonyme → dépôt serveur ; seule l'URL courte circule dans la présence.
        const { url, erreur } = await envoyerPhotoInvite(sessionId, blob);
        if (url) onComplete(url);
        else setError(erreur || 'Envoi de la photo impossible, réessaie.');
      } else {
        // Hors session (aucun dépôt possible) → data URL locale, jamais diffusée dans la présence
        const dataUrl: string = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.readAsDataURL(blob);
        });
        onComplete(dataUrl);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setUploading(false);
    }
  }, [imageSrc, croppedAreaPixels, userId, sessionId, onComplete]);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm overflow-y-auto">
      <div className="relative z-10 w-full max-w-md rounded-2xl border-2 border-[rgb(var(--bt-accent-rgb)/0.4)] bg-[#15151b] p-5 shadow-2xl">
        <div className="text-center mb-4">
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{title}</h2>
          <p className="text-white/50 text-sm">{subtitle}</p>
        </div>

        {!imageSrc ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-24 h-24 rounded-full flex items-center justify-center bg-white/5 border-2 border-dashed border-white/20">
              <Camera className="w-10 h-10 text-white/40" />
            </div>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" onChange={handleFile} className="hidden" data-testid="avatar-file-input" />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="user" onChange={handleFile} className="hidden" data-testid="avatar-camera-input" />
            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 text-white border-none"
                style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                data-testid="avatar-choisir-galerie"
              >
                <ImageIcon className="w-4 h-4 mr-2" /> Choisir une photo
              </Button>
              <Button
                variant="outline"
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 border-white/20 text-white/80"
                data-testid="avatar-prendre-photo"
              >
                <Camera className="w-4 h-4 mr-2" /> Prendre une photo
              </Button>
            </div>
            <p className="text-white/40 text-xs text-center">JPEG, PNG ou WebP · 15 Mo maximum</p>
          </div>
        ) : (
          <>
            <div className="relative w-full h-64 bg-black rounded-xl overflow-hidden">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <div className="mt-3">
              <label className="text-white/50 text-xs">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full accent-[var(--bt-accent)]"
              />
            </div>
            <div className="flex gap-2 mt-3">
              <Button
                variant="outline"
                onClick={() => setImageSrc(null)}
                disabled={uploading}
                className="flex-1 border-white/20 text-white/70"
              >
                Changer
              </Button>
              <Button
                onClick={handleSave}
                disabled={uploading}
                className="flex-1 text-white border-none"
                style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                data-testid="avatar-save-btn"
              >
                {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Envoi…</> : <><Check className="w-4 h-4 mr-2" /> Valider</>}
              </Button>
            </div>
          </>
        )}

        {error && <p className="mt-3 text-red-400 text-sm text-center">{error}</p>}

        {onCancel && (
          <button
            onClick={onCancel}
            className="absolute top-3 right-3 p-1 text-white/40 hover:text-white/70"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};

export default AvatarUploadCrop;
