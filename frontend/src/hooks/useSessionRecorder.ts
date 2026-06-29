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
  // Renvoie les flux audio distants (voix des participants + visio LiveKit) à l'instant T
  getRemoteStreams: () => MediaStream[];
  // 🔴 Flux de la MUSIQUE déjà mixé (son réel) — fourni par le mixeur (getMusicStream).
  // Préféré à element.captureStream() qui est MUET quand l'élément est routé via createMediaElementSource.
  getMusicStream?: () => MediaStream | null;
  fileBaseName?: string;
  // Si false : ne télécharge PAS le fichier à l'arrêt (utilisé par l'option premium qui l'envoie au serveur)
  download?: boolean;
  // Callback à l'arrêt avec le blob enregistré (pour upload + transcription IA).
  // meta.peak = niveau crête capté (0..1), meta.silent = true si aucun son détecté, meta.durationMs = durée.
  onComplete?: (blob: Blob, ext: string, meta: RecordingMeta) => void;
}

export interface RecordingMeta {
  durationMs: number;
  peak: number;     // niveau crête (0..1)
  silent: boolean;  // true si rien d'audible n'a été capté
}

export interface SessionRecorderReturn {
  isRecording: boolean;
  start: () => boolean;
  stop: () => void;
}

// Seuil en-dessous duquel on considère l'enregistrement SILENCIEUX (bruit de fond / aucun signal).
const SILENCE_PEAK_THRESHOLD = 0.012;

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
  const clonedTracksRef = useRef<MediaStreamTrack[]>([]); // clones indépendants (à stopper à l'arrêt)
  const rescanRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<string>('');

  // 🎚️ Métrologie — PREUVE que l'enregistrement capte du SON (niveau crête + durée).
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peakRef = useRef<number>(0);     // niveau crête observé (0..1)
  const startTsRef = useRef<number>(0);  // Date.now() au démarrage

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // ⚠️ NON INTRUSIF : on ne branche JAMAIS le flux LiveKit/micro d'origine sur l'AudioContext
  // (createMediaStreamSource « capte » la piste et peut couper/verrouiller sa lecture côté visio).
  // On CLONE les pistes audio → pistes indépendantes : la visio et le micro du live ne sont jamais touchés.
  const connectStream = useCallback((stream: MediaStream | null) => {
    const ctx = ctxRef.current;
    const dest = destRef.current;
    if (!ctx || !dest || !stream) return;
    if (connectedRef.current.has(stream.id)) return;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;
    try {
      const clones = audioTracks.map((t) => t.clone());            // copie indépendante (tee)
      clonedTracksRef.current.push(...clones);
      const cloned = new MediaStream(clones);
      const src = ctx.createMediaStreamSource(cloned);             // on tape la copie, jamais l'original
      src.connect(dest);
      if (analyserRef.current) src.connect(analyserRef.current);   // 🎚️ alimente le VU-mètre (preuve)
      connectedRef.current.add(stream.id);
    } catch { /* ignore */ }
  }, []);

  const rescanSources = useCallback(() => {
    connectStream(optionsRef.current.getLocalStream());
    optionsRef.current.getRemoteStreams().forEach((s) => connectStream(s));
    // 🎵 Musique : flux post-gain du mixeur (son RÉEL ; element.captureStream() serait muet).
    try { connectStream(optionsRef.current.getMusicStream?.() ?? null); } catch { /* ignore */ }
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
    clonedTracksRef.current = [];

    // 🎚️ VU-mètre : chaque source est aussi branchée sur l'analyseur (sans toucher la sortie).
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;
    peakRef.current = 0;
    startTsRef.current = Date.now();

    // Connecter le micro local + les voix participants + la musique présents
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
      // 🎚️ PREUVE : durée + niveau crête capté. silent=true si rien d'audible n'a été détecté.
      const durationMs = startTsRef.current ? Date.now() - startTsRef.current : 0;
      const peak = peakRef.current;
      const silent = peak < SILENCE_PEAK_THRESHOLD;
      const meta = { durationMs, peak: Math.round(peak * 1000) / 1000, silent };
      console.log(`[REC] terminé — durée=${(durationMs / 1000).toFixed(1)}s niveau_crête=${meta.peak} ${silent ? '⚠️ SILENCIEUX (aucun son capté)' : '✅ son capté'} taille=${blob.size}o`);
      // Premium : remonter le blob (pour upload + transcription IA) sans forcément télécharger.
      try { optionsRef.current.onComplete?.(blob, ext, meta); } catch { /* ignore */ }
      if (optionsRef.current.download === false) return;
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

    // 🎚️ Échantillonnage du niveau crête (RMS/peak) → preuve de captation + détection du silence.
    const buf = new Uint8Array(analyser.fftSize);
    meterRef.current = setInterval(() => {
      const a = analyserRef.current;
      if (!a) return;
      a.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i] - 128) / 128; // 0..1 autour du zéro (128)
        if (v > peak) peak = v;
      }
      if (peak > peakRef.current) peakRef.current = peak;
    }, 200);

    // re-scan périodique pour les participants qui rejoignent pendant l'enregistrement
    rescanRef.current = setInterval(rescanSources, 1500);
    return true;
  }, [rescanSources, fileBaseName]);

  const stop = useCallback(() => {
    if (rescanRef.current) { clearInterval(rescanRef.current); rescanRef.current = null; }
    if (meterRef.current) { clearInterval(meterRef.current); meterRef.current = null; }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;
    // Libérer les nœuds audio + STOPPER les clones (jamais les pistes d'origine du live)
    try { ctxRef.current?.close(); } catch { /* ignore */ }
    ctxRef.current = null;
    destRef.current = null;
    analyserRef.current = null;
    connectedRef.current.clear();
    clonedTracksRef.current.forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    clonedTracksRef.current = [];
    setIsRecording(false);
  }, []);

  // Sécurité : arrêt propre au démontage
  useEffect(() => {
    return () => {
      if (rescanRef.current) clearInterval(rescanRef.current);
      if (meterRef.current) clearInterval(meterRef.current);
      try { recorderRef.current?.stop(); } catch { /* ignore */ }
      try { ctxRef.current?.close(); } catch { /* ignore */ }
      clonedTracksRef.current.forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    };
  }, []);

  return { isRecording, start, stop };
}

export default useSessionRecorder;
