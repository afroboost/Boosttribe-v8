import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * 🎧 AUDIO MIXER HOOK - Boosttribe v8
 * 
 * Crée un mixeur avec des canaux indépendants pour :
 * - Musique (HTML5 Audio)
 * - Micro Hôte (WebRTC)
 * - Volume Tribu (Participants entrants)
 * - Volume Voix Hôte (Pour participants)
 */

export interface MixerState {
  musicVolume: number;      // 0-1 - Volume musique
  micVolume: number;        // 0-1 - Volume micro hôte
  tribeVolume: number;      // 0-1 - Volume participants (pour l'hôte)
  hostVoiceVolume: number;  // 0-1 - Volume voix hôte (pour participants)
  timerVolume: number;      // 0-1 - Volume des sons de l'Interval Training (bips/voix/fichier)
  isInitialized: boolean;
}

export interface UseAudioMixerOptions {
  onInitialized?: () => void;
}

export interface UseAudioMixerReturn {
  state: MixerState;
  initialize: () => boolean;
  setMusicVolume: (volume: number) => void;
  setMicVolume: (volume: number) => void;
  setTribeVolume: (volume: number) => void;
  setHostVoiceVolume: (volume: number) => void;
  // ⏱️ Volume des sons du timer interval (bips/voix/fichier) — pilote le GainNode de getTimerOutput().
  setTimerVolume: (volume: number) => void;
  // 🎚️ Compense le ducking (musique ~-20%) quand le micro hôte est actif (additif, no-op sur iOS).
  setMicDuckCompensation: (active: boolean) => void;
  connectMusicSource: (audioElement: HTMLAudioElement) => void;
  connectMicSource: (stream: MediaStream) => MediaStream;
  connectTribeStream: (stream: MediaStream, peerId: string) => void;
  disconnectTribeStream: (peerId: string) => void;
  connectHostVoice: (audioElement: HTMLAudioElement) => void;
  disconnectMusic: () => void;
  disconnectMic: () => void;
  getContext: () => AudioContext | null;
  // 🔴 Flux de la musique (son RÉEL post-gain) pour l'enregistrement — jamais muet contrairement à
  //    element.captureStream() (l'élément est routé via createMediaElementSource).
  getMusicStream: () => MediaStream | null;
  // ⏱️ Sortie ADDITIVE pour les sons du timer interval (bips/voix) → master (HP) + recTap (enregistrement).
  //    Crée un GainNode dédié à la volée ; n'affecte AUCUN canal existant (musique/tribu/voix/micro).
  getTimerOutput: () => GainNode | null;
  // 🔊 « M'entendre » : l'hôte s'écoute (monitoring local, anti-larsen, on/off).
  setSelfMonitor: (on: boolean) => void;
  // 🎙️ VAD mains-libres : détecte la parole (analyser en dérivation) → onSpeechStart/onSpeechEnd.
  startVoiceActivity: (onSpeechStart: () => void, onSpeechEnd: () => void, opts?: { thresholdOffsetDb?: number }) => void;
  stopVoiceActivity: () => void;
}

// 🔊 Plages : 1.0 = pleine puissance RÉELLE (aucune atténuation) ; au-delà = amplification (headroom).
const MUSIC_MAX_GAIN = 2.5; // musique amplifiable jusqu'à 250%
const MIC_MAX_GAIN = 2.5;   // micro hôte amplifiable jusqu'à 250% (indépendant de la musique)
// 🎚️ Compense le DUCKING navigateur/OS (théorie : Chrome/macOS baisseraient ~20% les autres sons quand un
//    micro est actif). Facteur multiplicatif appliqué SUR la musique quand le micro hôte est actif.
//    ⚠️ BUG 4 : sur le web (Chrome/Firefox desktop), ouvrir un micro NE ducke PAS l'audio Web Audio de la
//    même page → aucun -20% à compenser ; il ne restait qu'un boost +25% audible à l'activation (et -20% à
//    la coupure) = « le volume monte quand j'active le micro ». Neutralisé à 1.0 (aucun saut de volume).
const MIC_DUCK_COMPENSATION = 1.0;
const MASTER_MAKEUP_GAIN = 1.0; // 🔊 sortie maître à l'UNITÉ : 100% = plein volume réel (plus d'atténuation)
const SELF_MONITOR_GAIN = 0.6;  // 🔊 3b : niveau d'auto-écoute (« M'entendre ») modéré → anti-saturation/larsen

const initialState: MixerState = {
  musicVolume: 1.0, // 🔊 plein volume par défaut (avant : 0.8 → atténuation perçue)
  micVolume: 1.0,
  tribeVolume: 1.0,
  hostVoiceVolume: 1.4, // 🔊 voix de l'hôte au-dessus de la musique par défaut
  timerVolume: 1.0,     // ⏱️ sons du timer à plein volume par défaut
  isInitialized: false,
};

/**
 * Hook pour gérer le mixage audio avec des canaux indépendants
 * La musique et le micro ne s'affectent PAS mutuellement
 */
export function useAudioMixer(options: UseAudioMixerOptions = {}): UseAudioMixerReturn {
  const { onInitialized } = options;
  
  const [state, setState] = useState<MixerState>(initialState);
  
  // Refs pour l'AudioContext et les nœuds
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // GainNodes séparés
  const musicGainRef = useRef<GainNode | null>(null);
  // 🎚️ Compensation du ducking (1 = neutre) appliquée PAR-DESSUS le slider Volume Musique, sans en
  //    changer la valeur. Passe à MIC_DUCK_COMPENSATION quand le micro hôte est actif.
  const micDuckCompRef = useRef(1);
  const micGainRef = useRef<GainNode | null>(null);
  const tribeGainRef = useRef<GainNode | null>(null);
  const hostVoiceGainRef = useRef<GainNode | null>(null);
  // 🔊 Sortie maître : (sources HP) → masterGain → compresseur → destination
  // → relève la puissance perçue sans clipping brutal (> 1.0).
  const masterGainRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  
  // Source nodes
  const musicSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const hostVoiceSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // 🎤 POINT 5: destination de flux pour le micro hôte (sortie WebRTC, JAMAIS les HP de l'hôte)
  const micStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // 🎙️ ANTI-DUCKING : le micro vit dans son PROPRE AudioContext, SÉPARÉ de celui de la musique.
  //    Chrome « duck » (baisse ~20%) la sortie d'un AudioContext qui contient une source micro live ;
  //    en isolant le micro, le contexte musique reste à PLEIN volume quand le micro est actif.
  const micCtxRef = useRef<AudioContext | null>(null);
  // 👥 POINT 5: sources des micros participants entrants (mixés via tribeGain → HP hôte)
  const tribeSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());

  // 🔴 ENREGISTREMENT — dérivation SÉPARÉE du chemin principal (cf. demande : "source → gain →
  //    destination plein volume ET dérivation séparée vers le recorder, SANS réduire le chemin principal").
  //    Capte la MUSIQUE post-gain (élément routé via createMediaElementSource → captureStream() serait MUET).
  //    La voix de l'hôte et des participants est captée séparément par le recorder (clone micro + flux tribu).
  const musicTapDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // ⏱️ Sortie ADDITIVE pour le timer interval (créée à la demande via getTimerOutput).
  const timerOutputRef = useRef<GainNode | null>(null);
  // ⏱️ Volume voulu pour le timer (0..1). Mémorisé même si le GainNode n'est pas encore créé → appliqué
  //    à la création dans getTimerOutput. Piloté par setTimerVolume (curseur « Timer / Bips »).
  const timerVolumeRef = useRef(1);
  // 🔊 MONITORING « M'entendre » (#6) : micSource → monitorGain(0 par défaut) → master.
  //    Activable par l'hôte pour s'écouter (anti-larsen : gain 0 tant que désactivé).
  const monitorGainRef = useRef<GainNode | null>(null);

  // 🎙️ VAD (voix mains-libres) : AnalyserNode en DÉRIVATION sur la source micro (dead-end, non connecté
  //    en aval) + boucle ~50ms. N'altère PAS le graphe de diffusion. Vit sur micCtx (fermé au démontage).
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadTimerRef = useRef<number | null>(null);
  const vadStartCbRef = useRef<(() => void) | null>(null);
  const vadEndCbRef = useRef<(() => void) | null>(null);

  // Track connected elements
  const connectedMusicElement = useRef<HTMLAudioElement | null>(null);
  const connectedHostVoiceElement = useRef<HTMLAudioElement | null>(null);

  // 🍏 iOS (#7 — son écran verrouillé) : Safari iOS SUSPEND l'AudioContext dès l'écran verrouillé /
  //    onglet en arrière-plan. Une <audio> routée via createMediaElementSource devient alors MUETTE
  //    (sa sortie ne passe plus que par le graphe suspendu). En NE routant PAS la musique dans Web
  //    Audio sur iOS, l'élément <audio playsinline> joue DIRECTEMENT sur le matériel → la lecture
  //    continue écran verrouillé (avec MediaSession pour les contrôles). Le volume reste piloté par
  //    element.volume (0..1). Compromis assumé : pas de boost > 100% ni de captation musique pour
  //    l'enregistrement sur iPhone (rare), au profit de la lecture en arrière-plan qui est prioritaire.
  const isIOS = typeof navigator !== 'undefined' && (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS 13+ se présente comme « MacIntel » mais avec un écran tactile
    (navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints ? ((navigator as unknown as { maxTouchPoints: number }).maxTouchPoints > 1) : false)
  );

  /**
   * Initialise l'AudioContext et les GainNodes
   */
  const initialize = useCallback((): boolean => {
    if (audioContextRef.current) {
      // Déjà initialisé — s'assurer qu'il tourne (évite une diffusion muette si suspendu)
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => { /* ignore */ });
      }
      return true;
    }

    try {
      // Créer l'AudioContext en mode faible latence (POINT 1 : voix temps réel)
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass({ latencyHint: 'interactive' });
      audioContextRef.current = ctx;
      // S'assurer que le contexte tourne (politique autoplay → parfois 'suspended')
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => { /* ignore */ });
      }
      // Filet de sécurité : reprendre le contexte à chaque geste (survit à un passage en arrière-plan)
      // → la musique routée via Web Audio ne reste jamais muette après un retour d'onglet.
      const resumeOnGesture = () => { audioContextRef.current?.resume().catch(() => { /* ignore */ }); };
      document.addEventListener('click', resumeOnGesture);
      document.addEventListener('touchstart', resumeOnGesture, { passive: true });
      // #7 : au retour d'arrière-plan (onglet redevient visible), on relance le contexte s'il a été
      //     suspendu par l'OS → la musique routée via Web Audio ne reste jamais muette au réveil.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resumeOnGesture();
      });

      // 🔊 SORTIE MAÎTRE à l'UNITÉ (1.0) : masterGain → limiteur de crêtes → destination.
      // ⚠️ L'ancien compresseur (seuil -18 dB, ratio 3) atténuait fortement (~5x ressenti) → SUPPRIMÉ.
      // Le limiteur ci-dessous est quasi TRANSPARENT à 100% (n'attrape que les toutes dernières crêtes
      // pour éviter une distorsion brutale quand on pousse à 200-250%). 100% = plein volume réel.
      const master = ctx.createGain();
      master.gain.value = MASTER_MAKEUP_GAIN; // 1.0
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -1.5; // n'agit que sur les crêtes proches de 0 dBFS
      compressor.knee.value = 0;
      compressor.ratio.value = 20;       // brickwall limiter (anti-clipping), pas un compresseur de volume
      compressor.attack.value = 0.002;
      compressor.release.value = 0.1;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      masterGainRef.current = master;
      compressorRef.current = compressor;

      // Créer les GainNodes indépendants
      // 🔴 Dérivation d'enregistrement de la MUSIQUE (séparée du chemin HP).
      //    UNIQUEMENT la musique : la voix de l'hôte et les participants sont captés séparément par
      //    le recorder (clone du micro + flux tribu) → pas de double-captation/écho de la voix de l'hôte.
      const recTap = ctx.createMediaStreamDestination();
      musicTapDestRef.current = recTap;

      // 🎵 Canal A: Musique → master → compresseur → HP. + dérivation → recTap (enregistrement réel).
      musicGainRef.current = ctx.createGain();
      musicGainRef.current.gain.value = Math.max(1, state.musicVolume); // jamais < 1.0 (pas d'atténuation par le gain)
      musicGainRef.current.connect(master);
      musicGainRef.current.connect(recTap); // 🔴 capte la musique pour l'enregistrement (son réel, pas muet)

      // 🎤 Canal B (micro hôte) : créé dans un AudioContext SÉPARÉ (cf. micCtxRef) à l'activation du micro
      //    → le contexte musique ne contient AUCUNE source micro → plus de ducking de la musique.

      // 👥 Canal C: Volume Tribu (participants entrants) → master → HP de l'hôte
      tribeGainRef.current = ctx.createGain();
      tribeGainRef.current.gain.value = state.tribeVolume;
      tribeGainRef.current.connect(master);

      // 🔊 Canal D: Voix Hôte (pour participants) → master → HP
      hostVoiceGainRef.current = ctx.createGain();
      hostVoiceGainRef.current.gain.value = state.hostVoiceVolume;
      hostVoiceGainRef.current.connect(master);
      
      // Message unique de démarrage (production)
      console.log('🚀 Boosttribe Engine Active');
      
      setState(prev => ({ ...prev, isInitialized: true }));
      onInitialized?.();
      
      return true;
    } catch (err) {
      // Silencieux en production - ne pas bloquer l'app
      return false;
    }
  }, [state.musicVolume, state.micVolume, state.tribeVolume, state.hostVoiceVolume, onInitialized]);

  /**
   * Connecte un élément audio HTML5 au canal musique
   */
  const connectMusicSource = useCallback((audioElement: HTMLAudioElement) => {
    // 🍏 iOS : NE PAS router la musique via Web Audio (sinon muet écran verrouillé). L'élément
    //    <audio playsinline> joue directement → lecture continue en arrière-plan. On s'assure juste
    //    qu'il n'est pas coupé et que son volume suit l'état du mixeur.
    if (isIOS) {
      try {
        audioElement.muted = false;
        audioElement.volume = Math.max(0, Math.min(1, state.musicVolume > 1 ? 1 : state.musicVolume));
      } catch { /* ignore */ }
      connectedMusicElement.current = audioElement;
      return;
    }

    const ctx = audioContextRef.current;
    if (!ctx || !musicGainRef.current) {
      initialize();
      setTimeout(() => connectMusicSource(audioElement), 100);
      return;
    }

    // Éviter de reconnecter le même élément
    if (connectedMusicElement.current === audioElement && musicSourceRef.current) {
      return;
    }
    
    // Déconnecter l'ancienne source
    if (musicSourceRef.current) {
      try {
        musicSourceRef.current.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
    
    try {
      // Créer la source à partir de l'élément audio
      const source = ctx.createMediaElementSource(audioElement);
      source.connect(musicGainRef.current);
      
      musicSourceRef.current = source;
      connectedMusicElement.current = audioElement;
    } catch (err) {
      // L'élément est peut-être déjà connecté - silencieux
    }
  }, [initialize, isIOS, state.musicVolume]);

  /**
   * 🎤 POINT 5: Connecte le micro hôte au GainNode "Mon Micro" et retourne le flux
   * traité (gain appliqué) destiné à la diffusion WebRTC. Ce flux ne passe JAMAIS
   * par les haut-parleurs de l'hôte (micGain → micStreamDest uniquement) → anti-larsen.
   */
  const connectMicSource = useCallback((stream: MediaStream): MediaStream => {
    try {
      // 🎙️ Le micro est traité dans son PROPRE AudioContext (séparé de la musique) → AUCUN ducking.
      let micCtx = micCtxRef.current;
      if (!micCtx) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        micCtx = new Ctx({ latencyHint: 'interactive' }); // faible latence pour la voix
        micCtxRef.current = micCtx;
        // micGain → micStreamDest (diffusion WebRTC). PAS branché aux HP → anti-larsen.
        const micGain = micCtx.createGain();
        micGain.gain.value = state.micVolume;
        const micDest = micCtx.createMediaStreamDestination();
        micGain.connect(micDest);
        micGainRef.current = micGain;
        micStreamDestRef.current = micDest;
        // « M'entendre » (monitoring local, #6 / 3b) : SÉPARÉ du chemin diffusé et NON saturant.
        //   - On tape la SOURCE micro AVANT micGain (le boost de diffusion peut monter à 250% et
        //     saturerait l'auto-écoute) → le raccord source→monitor est fait plus bas, après la source.
        //   - Gain d'auto-écoute MODÉRÉ (SELF_MONITOR_GAIN) → limite le larsen (l'auto-écoute qui
        //     revient dans le micro, AEC volontairement OFF sur le flux diffusé).
        //   - Limiteur brickwall avant les HP → plus de grésillement/clipping.
        const monitor = micCtx.createGain();
        monitor.gain.value = 0; // off par défaut (silencieux tant que non demandé → anti-larsen)
        const monLimiter = micCtx.createDynamicsCompressor();
        monLimiter.threshold.value = -3;
        monLimiter.knee.value = 0;
        monLimiter.ratio.value = 20;   // brickwall (anti-saturation), pas un compresseur de volume
        monLimiter.attack.value = 0.002;
        monLimiter.release.value = 0.1;
        monitor.connect(monLimiter);
        monLimiter.connect(micCtx.destination);
        monitorGainRef.current = monitor;
      }
      if (micCtx.state === 'suspended') micCtx.resume().catch(() => { /* ignore */ });

      // Remplacer l'ancienne source micro
      if (micSourceRef.current) { try { micSourceRef.current.disconnect(); } catch { /* ignore */ } }
      const source = micCtx.createMediaStreamSource(stream);
      source.connect(micGainRef.current!); // source → micGain → micStreamDest (diffusion WebRTC)
      // 3b : auto-écoute tapée sur la SOURCE (pré-boost) → indépendante du volume de diffusion.
      if (monitorGainRef.current) source.connect(monitorGainRef.current);
      micSourceRef.current = source;
      // 🎙️ VAD : analyser branché EN PARALLÈLE sur la source (dead-end, aucun aval) → ne modifie NI la
      //    diffusion WebRTC NI le monitoring. Recréé si le contexte a changé.
      if (!vadAnalyserRef.current || vadAnalyserRef.current.context !== micCtx) {
        const analyser = micCtx.createAnalyser();
        analyser.fftSize = 1024;
        vadAnalyserRef.current = analyser;
      }
      try { source.connect(vadAnalyserRef.current); } catch { /* ignore */ }
      return micStreamDestRef.current!.stream;
    } catch {
      return stream; // Fallback : flux brut si Web Audio indisponible
    }
  }, [state.micVolume]);

  /**
   * 👥 POINT 5: Mixe un flux micro participant entrant via le GainNode "Volume Tribu".
   * source(participant) → tribeGain → HP de l'hôte. Piloté par le slider Volume Tribu.
   */
  const connectTribeStream = useCallback((stream: MediaStream, peerId: string) => {
    const ctx = audioContextRef.current;
    if (!ctx || !tribeGainRef.current) {
      initialize();
      setTimeout(() => connectTribeStream(stream, peerId), 100);
      return;
    }

    // Remplacer une éventuelle source existante pour ce participant
    const existing = tribeSourcesRef.current.get(peerId);
    if (existing) {
      try { existing.disconnect(); } catch (e) { /* ignore */ }
    }

    try {
      const source = ctx.createMediaStreamSource(stream);
      source.connect(tribeGainRef.current);
      tribeSourcesRef.current.set(peerId, source);
    } catch (err) {
      // Silencieux
    }
  }, [initialize]);

  /**
   * 👥 POINT 5: Retire un flux participant (quand il rend la parole / se déconnecte)
   */
  const disconnectTribeStream = useCallback((peerId: string) => {
    const source = tribeSourcesRef.current.get(peerId);
    if (source) {
      try { source.disconnect(); } catch (e) { /* ignore */ }
      tribeSourcesRef.current.delete(peerId);
    }
  }, []);

  /**
   * Connecte l'audio de la voix hôte pour les participants
   */
  const connectHostVoice = useCallback((audioElement: HTMLAudioElement) => {
    const ctx = audioContextRef.current;
    if (!ctx || !hostVoiceGainRef.current) {
      initialize();
      setTimeout(() => connectHostVoice(audioElement), 100);
      return;
    }
    
    if (connectedHostVoiceElement.current === audioElement && hostVoiceSourceRef.current) {
      return;
    }
    
    if (hostVoiceSourceRef.current) {
      try {
        hostVoiceSourceRef.current.disconnect();
      } catch (e) {
        // Ignore
      }
    }
    
    try {
      const source = ctx.createMediaElementSource(audioElement);
      source.connect(hostVoiceGainRef.current);
      
      hostVoiceSourceRef.current = source;
      connectedHostVoiceElement.current = audioElement;
    } catch (err) {
      // Silencieux
    }
  }, [initialize]);

  /**
   * Définit le volume de la musique
   */
  const setMusicVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(MUSIC_MAX_GAIN, volume)); // 🔊 0..200% (affichage + feed vidéo)
    setState(prev => ({ ...prev, musicVolume: clamped }));

    // Le GainNode ne sert QUE de boost (≥ 1.0) : l'atténuation 0..100% reste pilotée par
    // element.volume (côté SessionPage) → pas de double atténuation, et headroom > 100% réel.
    if (musicGainRef.current) {
      // La compensation de ducking (micDuckCompRef) s'ajoute par-dessus, de façon transparente.
      musicGainRef.current.gain.setValueAtTime(Math.max(1, clamped) * micDuckCompRef.current, audioContextRef.current?.currentTime || 0);
    }
  }, []);

  /**
   * 🎚️ Compense le DUCKING (le navigateur/OS baisse ~20% les autres sons quand un micro est actif).
   * Applique/retire un facteur multiplicatif sur le canal MUSIQUE, SANS toucher la valeur du slider
   * « Volume Musique » (celui-ci continue de piloter le mix). iOS : la musique ne passe pas par le Web
   * Audio (pas de ducking Web Audio) → méthode NEUTRE, aucun impact sur la lecture écran verrouillé.
   */
  const setMicDuckCompensation = useCallback((active: boolean) => {
    if (isIOS) return; // musique iOS hors Web Audio → ne rien changer
    micDuckCompRef.current = active ? MIC_DUCK_COMPENSATION : 1;
    if (musicGainRef.current) {
      const base = Math.max(1, state.musicVolume);
      musicGainRef.current.gain.setValueAtTime(base * micDuckCompRef.current, audioContextRef.current?.currentTime || 0);
    }
  }, [isIOS, state.musicVolume]);

  /**
   * Définit le volume du micro (avec un peu de marge pour passer au-dessus de la musique)
   */
  const setMicVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(MIC_MAX_GAIN, volume));
    setState(prev => ({ ...prev, micVolume: clamped }));

    if (micGainRef.current) {
      micGainRef.current.gain.setValueAtTime(clamped, micCtxRef.current?.currentTime || 0); // micGain vit dans micCtx
    }
  }, []);

  /**
   * Définit le volume de la tribu (participants)
   */
  const setTribeVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(2.5, volume)); // 🔊 P4 : "Volume Tribu" amplifiable jusqu'à 250%
    setState(prev => ({ ...prev, tribeVolume: clamped }));

    if (tribeGainRef.current) {
      tribeGainRef.current.gain.setValueAtTime(clamped, audioContextRef.current?.currentTime || 0);
    }
  }, []);

  /**
   * Définit le volume de la voix hôte (pour participants)
   */
  const setHostVoiceVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(2.5, volume)); // 🔊 voix hôte amplifiable jusqu'à 250%
    setState(prev => ({ ...prev, hostVoiceVolume: clamped }));

    if (hostVoiceGainRef.current) {
      hostVoiceGainRef.current.gain.setValueAtTime(clamped, audioContextRef.current?.currentTime || 0);
    }
    // NB : le gain RÉEL de la voix hôte est piloté par usePeerAudio.setHostVoiceVolume (GainNode dédié).
    // On NE touche PLUS element.volume ici : l'élément est routé/muet via Web Audio (sinon double contrôle).
  }, []);

  /**
   * Déconnecte la source musique
   */
  const disconnectMusic = useCallback(() => {
    if (musicSourceRef.current) {
      try {
        musicSourceRef.current.disconnect();
      } catch (e) {
        // Ignore
      }
      musicSourceRef.current = null;
      connectedMusicElement.current = null;
    }
  }, []);

  /**
   * Déconnecte la source micro
   */
  const disconnectMic = useCallback(() => {
    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch (e) {
        // Ignore
      }
      micSourceRef.current = null;
    }
    // 🎙️ VAD : arrêter la boucle + libérer l'analyser (dérivation) — pas de fuite.
    if (vadTimerRef.current != null) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
    vadStartCbRef.current = null;
    vadEndCbRef.current = null;
    if (vadAnalyserRef.current) { try { vadAnalyserRef.current.disconnect(); } catch { /* ignore */ } vadAnalyserRef.current = null; }
  }, []);

  /**
   * Retourne l'AudioContext
   */
  const getContext = useCallback(() => audioContextRef.current, []);

  /**
   * 🔴 Flux audio de la MUSIQUE (son réel, post-gain) destiné à l'enregistrement.
   * On dérive musicGain → musicTapDest : contrairement à audioElement.captureStream() (muet car
   * l'élément est déjà routé via createMediaElementSource), ce flux contient bien le son de la musique.
   */
  const getMusicStream = useCallback((): MediaStream | null => {
    return musicTapDestRef.current?.stream ?? null;
  }, []);

  /**
   * ⏱️ Sortie ADDITIVE pour les sons du timer interval (bips oscillateur + voix/fichier via
   * MediaElementSource). Crée un GainNode dédié branché sur master (HP) ET recTap (enregistrement),
   * SANS toucher aux canaux musique/tribu/voix/micro. Renvoie null si le contexte n'existe pas encore.
   */
  const getTimerOutput = useCallback((): GainNode | null => {
    const ctx = audioContextRef.current;
    if (!ctx) return null;
    // (re)créer si absent ou rattaché à un ancien contexte fermé
    if (!timerOutputRef.current || timerOutputRef.current.context !== ctx) {
      const g = ctx.createGain();
      g.gain.value = timerVolumeRef.current; // ⏱️ respecte le volume « Timer / Bips » courant dès la création
      if (masterGainRef.current) g.connect(masterGainRef.current);       // → HP (avec la musique/voix)
      if (musicTapDestRef.current) g.connect(musicTapDestRef.current);   // → enregistrement
      timerOutputRef.current = g;
    }
    return timerOutputRef.current;
  }, []);

  /**
   * ⏱️ Volume des sons du timer interval (bips/voix/fichier). Pilote le GainNode ADDITIF de getTimerOutput()
   * (→ master + recTap). Strictement additif : ne touche AUCUN autre canal. Mémorise la valeur même si le
   * GainNode n'existe pas encore (appliqué à sa création).
   */
  const setTimerVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    timerVolumeRef.current = clamped;
    setState(prev => ({ ...prev, timerVolume: clamped }));
    if (timerOutputRef.current) {
      timerOutputRef.current.gain.setValueAtTime(clamped, audioContextRef.current?.currentTime || 0);
    }
  }, []);

  /**
   * 🔊 « M'entendre » (#6) : active/désactive le monitoring local de la voix de l'hôte.
   * micSource → monitorGain → master. Gain 0 = silencieux (anti-larsen). Geste utilisateur requis.
   */
  const setSelfMonitor = useCallback((on: boolean) => {
    const micCtx = micCtxRef.current;
    if (micCtx?.state === 'suspended') micCtx.resume().catch(() => { /* ignore */ });
    if (monitorGainRef.current) {
      // 3b : niveau modéré (pas 1.0) → auto-écoute claire sans saturation ni larsen.
      monitorGainRef.current.gain.setValueAtTime(on ? SELF_MONITOR_GAIN : 0, micCtx?.currentTime || 0);
    }
  }, []);

  /**
   * 🎙️ VAD MAINS-LIBRES : détecte la parole sur la source micro (analyser en dérivation) et appelle
   * onSpeechStart / onSpeechEnd. Le micro reste TOUJOURS diffusé (on ne touche pas au broadcast) ; seule
   * la détection pilote l'auto-pause musique côté SessionPage.
   *  - Onset : RMS > seuil pendant ≥120ms → onSpeechStart.
   *  - Fin   : RMS < seuil pendant ≥900ms (hangover) → onSpeechEnd.
   *  - Seuil adaptatif anti-bleed : plancher de bruit calibré ~500ms (musique incluse) puis threshold =
   *    plancher + offset dB (défaut 8), réajusté doucement pendant les silences confirmés.
   */
  const startVoiceActivity = useCallback((
    onSpeechStart: () => void,
    onSpeechEnd: () => void,
    opts?: { thresholdOffsetDb?: number },
  ) => {
    const analyser = vadAnalyserRef.current;
    if (!analyser) return; // micro pas encore connecté → rien à analyser
    const micCtx = micCtxRef.current;
    if (micCtx?.state === 'suspended') micCtx.resume().catch(() => { /* ignore */ });
    vadStartCbRef.current = onSpeechStart;
    vadEndCbRef.current = onSpeechEnd;
    if (vadTimerRef.current != null) return; // déjà en cours (callbacks rafraîchis ci-dessus)

    const OFFSET = opts?.thresholdOffsetDb ?? 8; // dB au-dessus du plancher de bruit
    const ONSET_MS = 120, HANG_MS = 900, CALIB_MS = 500;
    const buf = new Float32Array(analyser.fftSize);
    let speaking = false;
    let overSince = 0, underSince = 0;
    let noiseFloor = -50, calibrated = false;
    const t0 = Date.now();

    const tick = () => {
      const a = vadAnalyserRef.current;
      if (!a) return;
      a.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const db = rms > 1e-7 ? 20 * Math.log10(rms) : -120;
      const now = Date.now();

      // Calibration initiale du plancher de bruit (musique ambiante incluse) → anti-bleed.
      if (now - t0 < CALIB_MS) {
        noiseFloor = calibrated ? noiseFloor * 0.8 + db * 0.2 : db;
        calibrated = true;
        return; // pas de déclenchement pendant la calibration
      }

      const threshold = noiseFloor + OFFSET;
      if (db > threshold) {
        underSince = 0;
        if (!speaking) {
          if (overSince === 0) overSince = now;
          else if (now - overSince >= ONSET_MS) { speaking = true; overSince = 0; vadStartCbRef.current?.(); }
        }
      } else {
        overSince = 0;
        if (speaking) {
          if (underSince === 0) underSince = now;
          else if (now - underSince >= HANG_MS) { speaking = false; underSince = 0; vadEndCbRef.current?.(); }
        } else {
          // Silence confirmé → réajuste doucement le plancher (dérive du bruit/musique).
          noiseFloor = noiseFloor * 0.98 + db * 0.02;
        }
      }
    };
    vadTimerRef.current = window.setInterval(tick, 50);
  }, []);

  const stopVoiceActivity = useCallback(() => {
    if (vadTimerRef.current != null) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
    vadStartCbRef.current = null;
    vadEndCbRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectMusic();
      disconnectMic();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      // Fermer aussi le contexte micro séparé
      if (micCtxRef.current && micCtxRef.current.state !== 'closed') {
        try { micCtxRef.current.close(); } catch { /* ignore */ }
      }
    };
  }, [disconnectMusic, disconnectMic]);

  return {
    state,
    initialize,
    setMusicVolume,
    setMicVolume,
    setTribeVolume,
    setHostVoiceVolume,
    setTimerVolume,
    connectMusicSource,
    connectMicSource,
    connectTribeStream,
    disconnectTribeStream,
    connectHostVoice,
    disconnectMusic,
    disconnectMic,
    getContext,
    getMusicStream,
    getTimerOutput,
    setMicDuckCompensation,
    setSelfMonitor,
    startVoiceActivity,
    stopVoiceActivity,
  };
}

export default useAudioMixer;
