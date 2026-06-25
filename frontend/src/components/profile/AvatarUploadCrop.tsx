import React, { useState, useCallback, useRef } from 'react';
import RawCropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { Camera, Check, X, Loader2 } from 'lucide-react';

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

interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AvatarUploadCropProps {
  // userId connecté → upload Supabase ; null (participant anonyme) → data URL locale
  userId: string | null;
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
    }, 'image/jpeg', 0.9);
  });
}

export const AvatarUploadCrop: React.FC<AvatarUploadCropProps> = ({
  userId,
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

  const onCropComplete = useCallback((_: unknown, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choisissez une image');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleSave = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels);
      if (userId) {
        // Utilisateur connecté → upload vers le bucket "avatars" + profiles.avatar_url
        const { url, error: upErr } = await uploadAvatar(blob, userId);
        if (url) onComplete(url);
        else setError(upErr || 'Échec de l\'envoi');
      } else {
        // Participant anonyme → data URL locale (affichée via la présence)
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
  }, [imageSrc, croppedAreaPixels, userId, onComplete]);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
      <div className="relative z-10 w-full max-w-md rounded-2xl border-2 border-[#8A2EFF]/40 bg-[#15151b] p-5 shadow-2xl">
        <div className="text-center mb-4">
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{title}</h2>
          <p className="text-white/50 text-sm">{subtitle}</p>
        </div>

        {!imageSrc ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-24 h-24 rounded-full flex items-center justify-center bg-white/5 border-2 border-dashed border-white/20">
              <Camera className="w-10 h-10 text-white/40" />
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" data-testid="avatar-file-input" />
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="text-white border-none"
              style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}
            >
              <Camera className="w-4 h-4 mr-2" /> Choisir une photo
            </Button>
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
                className="w-full accent-[#8A2EFF]"
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
                style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}
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
