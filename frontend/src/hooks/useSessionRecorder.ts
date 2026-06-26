import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 🔴 useSessionRecorder — enregistre le MÉLANGE des VOIX d'une session (hôte uniquement).
 *
 * Mix = micro local de l'hôte + toutes les voix des participants reçues en WebRTC.
 * N'inclut PAS l'audio de la vidéo partagée (voix seulement → pas de souci de droits d'auteur).
 *
 * Technique : Web Audio API (AudioContext + MediaStreamAudioDestinationNode) → MediaRecorder.
 * Les sources sont (re)connectées dynamiquement (participant qui rejoint/part pendant l'enregistrement).
 * À l'arrêt : téléchargement direct du fichier, rien n'est stocké sur le serveur.
 */

export interface SessionRecorderOptions {
  // Renvoie le flux micro local de l'hôte (ou null)
  getLocalStream: () => MediaStream | null;
  // Renvoie les flux audio distants (voix des participants) à l'instant T
  getRemoteStreams: () => MediaStream[];
  fileBaseName?: string;
}

export interface SessionRecorderReturn {
  isRecording: boolean;
  start: () => boolean;
  stop: () => void;
}

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export function useSessionRecorder(options: SessionRecorderOptions): SessionRecorderReturn {
  const { getLocalStream, getRemoteStreams, fileBaseName = 'boosttribe-session' } = options;

  const [isRecording, setIsRecording] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const connectedRef = useRef<Set<string>>(new Set()); // stream.id déjà connectés
  const rescanRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<string>('');

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connectStream = useCallback((stream: MediaStream | null) => {
    const ctx = ctxRef.current;
    const dest = destRef.current;
    if (!ctx || !dest || !stream) return;
    if (connectedRef.current.has(stream.id)) return;
    if (stream.getAudioTracks().length === 0) return;
    try {
      const src = ctx.createMediaStreamSource(stream);
      src.connect(dest);
      connectedRef.current.add(stream.id);
    } catch { /* ignore */ }
  }, []);

  const rescanSources = useCallback(() => {
    connectStream(optionsRef.current.getLocalStream());
    optionsRef.current.getRemoteStreams().forEach((s) => connectStream(s));
  }, [connectStream]);

  const start = useCallback((): boolean => {
    if (recorderRef.current) return true;
    if (typeof MediaRecorder === 'undefined') return false;
    const mime = pickMime();
    mimeRef.current = mime;

    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    ctxRef.current = ctx;
    const dest = ctx.createMediaStreamDestination();
    destRef.current = dest;
    connectedRef.current = new Set();

    // Connecter le micro local + les voix participants présentes
    rescanSources();

    if (dest.stream.getAudioTracks().length === 0) {
      // rien à enregistrer pour l'instant : on enregistre quand même (les sources arriveront via rescan)
    }

    const recorder = mime ? new MediaRecorder(dest.stream, { mimeType: mime }) : new MediaRecorder(dest.stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const type = mimeRef.current || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBaseName}-${stamp}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });
    recorder.start(1000); // chunks réguliers
    setIsRecording(true);

    // re-scan périodique pour les participants qui rejoignent pendant l'enregistrement
    rescanRef.current = setInterval(rescanSources, 1500);
    return true;
  }, [rescanSources, fileBaseName]);

  const stop = useCallback(() => {
    if (rescanRef.current) { clearInterval(rescanRef.current); rescanRef.current = null; }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;
    // Libérer les nœuds audio
    try { ctxRef.current?.close(); } catch { /* ignore */ }
    ctxRef.current = null;
    destRef.current = null;
    connectedRef.current.clear();
    setIsRecording(false);
  }, []);

  // Sécurité : arrêt propre au démontage
  useEffect(() => {
    return () => {
      if (rescanRef.current) clearInterval(rescanRef.current);
      try { recorderRef.current?.stop(); } catch { /* ignore */ }
      try { ctxRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

  return { isRecording, start, stop };
}

export default useSessionRecorder;
