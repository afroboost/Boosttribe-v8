import React, { useState, useRef, useCallback } from 'react';
import { Upload, Music, X, Loader2, AlertCircle, CheckCircle, Sparkles, Lock, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { uploadAudioFile, isSupabaseConfigured, UploadResult } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { Track } from './PlaylistDnD';
import { Link } from 'react-router-dom';

interface TrackUploaderProps {
  sessionId: string;
  onTrackUploaded: (track: Track) => void;
  currentTrackCount: number;
  maxTracks?: number;
  disabled?: boolean;
}

type UploadStatus = 'idle' | 'selecting' | 'uploading' | 'success' | 'error' | 'limit_reached';

export const TrackUploader: React.FC<TrackUploaderProps> = ({
  sessionId,
  onTrackUploaded,
  currentTrackCount,
  maxTracks = 10,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Get auth context
  const { isAdmin, canUploadTrack, trackLimit } = useAuth();

  // Check upload limits - Admin bypasses all limits
  const effectiveMaxTracks = isAdmin ? 999 : (trackLimit === -1 ? maxTracks : Math.min(maxTracks, trackLimit));
  const canUpload = canUploadTrack(currentTrackCount) && currentTrackCount < effectiveMaxTracks && !disabled;
  const isDemoMode = !isSupabaseConfigured;
  const isTrialLimitReached = !isAdmin && trackLimit > 0 && currentTrackCount >= trackLimit;

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.includes('audio/') && !file.name.endsWith('.mp3')) {
      setError('Seuls les fichiers MP3 sont acceptés');
      setStatus('error');
      return;
    }

    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      setError('Le fichier ne doit pas dépasser 50 Mo');
      setStatus('error');
      return;
    }

    setSelectedFile(file);
    setStatus('selecting');
    setError(null);
  }, []);

  // Handle upload
  const handleUpload = useCallback(async () => {
    if (!selectedFile || !sessionId) return;

    setStatus('uploading');
    setProgress(0);
    setError(null);

    // Progress simulation for UX
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 15;
      });
    }, 300);

    try {
      let result: UploadResult;

      if (isSupabaseConfigured) {
        // Real Supabase upload
        // Production: log removed
        result = await uploadAudioFile(selectedFile, sessionId);
      } else {
        // Demo mode - local file simulation
        await new Promise(resolve => setTimeout(resolve, 1200));
        result = {
          success: true,
          url: URL.createObjectURL(selectedFile),
          path: `demo/${sessionId}/${selectedFile.name}`,
        };
      }

      clearInterval(progressInterval);

      if (result.success && result.url) {
        setProgress(100);
        
        // Extract title from filename
        const title = selectedFile.name
          .replace(/\.[^/.]+$/, '')
          .replace(/[_-]/g, ' ')
          .trim();

        // Create new track
        const newTrack: Track = {
          id: Date.now(),
          title: title || 'Sans titre',
          artist: isDemoMode ? 'Mode Démo' : 'Upload',
          src: result.url,
        };

        // Production: log removed

        // Short delay to show 100% before success state
        setTimeout(() => {
          setStatus('success');
          onTrackUploaded(newTrack);
        }, 300);

        // Reset after success animation
        setTimeout(() => {
          setStatus('idle');
          setSelectedFile(null);
          setProgress(0);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }, 2500);
      } else {
        setProgress(0);
        setStatus('error');
        setError(result.error || 'Erreur lors de l\'upload');
      }
    } catch (err) {
      clearInterval(progressInterval);
      setProgress(0);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    }
  }, [selectedFile, sessionId, onTrackUploaded, isDemoMode]);

  // Cancel selection
  const handleCancel = useCallback(() => {
    setStatus('idle');
    setSelectedFile(null);
    setError(null);
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Trigger file picker
  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="space-y-3" data-testid="track-uploader">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mp3,audio/mpeg,.mp3"
        onChange={handleFileSelect}
        className="hidden"
        disabled={!canUpload || status === 'uploading'}
        data-testid="file-input"
      />

      {/* Trial Limit Reached - Show upgrade prompt */}
      {isTrialLimitReached && status === 'idle' && (
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
              <Lock size={20} className="text-yellow-400" />
            </div>
            <div className="flex-1">
              <p className="text-yellow-400 text-sm font-medium">
                Limite de la version d'essai : {trackLimit} chanson{trackLimit > 1 ? 's' : ''} max
              </p>
              <p className="text-yellow-400/60 text-xs">
                Passez à un abonnement pour uploader plus de musique
              </p>
            </div>
          </div>
          <Link to="/pricing">
            <Button
              size="sm"
              className="w-full text-white border-none"
              style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}
            >
              <Crown size={14} className="mr-2" />
              Voir les offres
            </Button>
          </Link>
        </div>
      )}

      {/* Admin badge */}
      {isAdmin && status === 'idle' && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-purple-500/10 border border-purple-500/30">
          <Crown size={14} className="text-purple-400" />
          <span className="text-xs text-purple-400">Mode Admin - Upload illimité</span>
        </div>
      )}

      {/* Upload Area */}
      {status === 'idle' && !isTrialLimitReached && (
        <button
          onClick={triggerFilePicker}
          disabled={!canUpload}
          data-testid="upload-trigger-btn"
          className={`
            w-full p-4 rounded-lg border-2 border-dashed transition-all
            flex flex-col items-center justify-center gap-2
            ${canUpload 
              ? 'border-white/20 hover:border-[#8A2EFF]/50 hover:bg-white/5 cursor-pointer' 
              : 'border-white/10 opacity-50 cursor-not-allowed'
            }
          `}
        >
          {isDemoMode ? (
            <>
              <div className="flex items-center gap-2">
                <Sparkles size={20} strokeWidth={1.5} className="text-yellow-400/70" />
                <Upload size={24} strokeWidth={1.5} className="text-white/50" />
              </div>
              <span className="text-sm text-white/50">
                {canUpload 
                  ? 'Mode Démo - Ajouter un MP3 local' 
                  : `Limite atteinte (${maxTracks} titres max)`
                }
              </span>
              <span className="text-xs text-yellow-400/60">
                Fichier disponible uniquement dans cette session
              </span>
            </>
          ) : (
            <>
              <Upload size={24} strokeWidth={1.5} className="text-white/50" />
              <span className="text-sm text-white/50">
                {canUpload 
                  ? 'Cliquez pour ajouter un MP3' 
                  : `Limite atteinte (${effectiveMaxTracks} titres max)`
                }
              </span>
              <span className="text-xs text-white/30">
                {currentTrackCount}/{effectiveMaxTracks} titres • Max 50 Mo
                {isAdmin && ' • Admin'}
              </span>
            </>
          )}
        </button>
      )}

      {/* File Selected - Ready to upload */}
      {status === 'selecting' && selectedFile && (
        <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-3">
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: isDemoMode 
                ? 'linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)' 
                : 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' 
              }}
            >
              <Music size={18} strokeWidth={1.5} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm truncate">{selectedFile.name}</p>
              <p className="text-white/50 text-xs">
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} Mo
              </p>
            </div>
            <button
              onClick={handleCancel}
              className="p-1.5 rounded text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
              data-testid="cancel-selection-btn"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
          
          <div className="flex gap-2">
            <Button
              onClick={handleCancel}
              variant="outline"
              size="sm"
              className="flex-1 border-white/20 text-white/70 hover:bg-white/10"
            >
              Annuler
            </Button>
            <Button
              onClick={handleUpload}
              size="sm"
              data-testid="upload-btn"
              className="flex-1 text-white border-none"
              style={{
                background: isDemoMode 
                  ? 'linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)' 
                  : 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)',
              }}
            >
              {isDemoMode ? (
                <>
                  <Sparkles size={14} strokeWidth={1.5} className="mr-1" />
                  Simuler
                </>
              ) : (
                <>
                  <Upload size={14} strokeWidth={1.5} className="mr-1" />
                  Upload
                </>
              )}
            </Button>
          </div>

          {/* Demo mode indicator */}
          {isDemoMode && (
            <div className="flex items-center justify-center gap-2 py-1.5 px-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
              <Sparkles size={12} className="text-yellow-400" />
              <p className="text-xs text-yellow-400/80">
                Mode Démo - Le fichier sera lu localement
              </p>
            </div>
          )}
        </div>
      )}

      {/* Uploading */}
      {status === 'uploading' && (
        <div className={`p-4 rounded-lg bg-white/5 border space-y-3 ${
          progress === 100 ? 'border-green-500/30' : isDemoMode ? 'border-yellow-500/30' : 'border-[#8A2EFF]/30'
        }`}>
          <div className="flex items-center gap-3">
            {progress === 100 ? (
              <CheckCircle size={20} strokeWidth={1.5} className="text-green-400" />
            ) : (
              <Loader2 size={20} strokeWidth={1.5} className={`animate-spin ${
                isDemoMode ? 'text-yellow-400' : 'text-[#8A2EFF]'
              }`} />
            )}
            <div className="flex-1">
              <p className="text-white text-sm">
                {progress === 100 
                  ? 'Finalisation...' 
                  : isDemoMode 
                    ? 'Simulation en cours...' 
                    : 'Upload en cours...'
                }
              </p>
              <p className="text-white/50 text-xs">{selectedFile?.name}</p>
            </div>
            <span className={`text-sm font-mono ${
              progress === 100 ? 'text-green-400' : isDemoMode ? 'text-yellow-400' : 'text-[#8A2EFF]'
            }`}>
              {progress}%
            </span>
          </div>
          
          {/* Progress bar - turns green at 100% */}
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div 
              className="h-full rounded-full transition-all duration-300"
              style={{ 
                width: `${progress}%`,
                background: progress === 100
                  ? 'linear-gradient(90deg, #22c55e 0%, #10b981 100%)'
                  : isDemoMode 
                    ? 'linear-gradient(90deg, #F59E0B 0%, #EF4444 100%)'
                    : 'linear-gradient(90deg, #8A2EFF 0%, #FF2FB3 100%)',
              }}
            />
          </div>
        </div>
      )}

      {/* Success */}
      {status === 'success' && (
        <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-3">
          <CheckCircle size={20} strokeWidth={1.5} className="text-green-400" />
          <div className="flex-1">
            <p className="text-green-400 text-sm">
              {isDemoMode ? 'Simulation réussie !' : 'Upload réussi !'}
            </p>
            <p className="text-green-400/60 text-xs">Titre ajouté à la playlist</p>
          </div>
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 space-y-2">
          <div className="flex items-center gap-3">
            <AlertCircle size={20} strokeWidth={1.5} className="text-red-400" />
            <div className="flex-1">
              <p className="text-red-400 text-sm">Erreur</p>
              <p className="text-red-400/60 text-xs">{error}</p>
            </div>
          </div>
          <Button
            onClick={handleCancel}
            variant="outline"
            size="sm"
            className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            Réessayer
          </Button>
        </div>
      )}
    </div>
  );
};

export default TrackUploader;
