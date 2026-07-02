import React, { useEffect, useRef, useState, useCallback, useImperativeHandle } from 'react';
import { X, Pause } from 'lucide-react';

// ===========================================================================
// ⏱️ Interval training (HIIT) — composant 100% ADDITIF.
//   • Ne touche JAMAIS l'audio musique/micro/visio : sons via AudioContext dédié + new Audio().
//   • Piloté par un timestamp de départ partagé (Date.now()) → aligné, sans dérive de setInterval.
// ===========================================================================

export type IntervalPhaseKey = 'prepare' | 'work' | 'rest' | 'done';
export type IntervalVisibility = 'all' | 'host';
export type IntervalSoundMode = 'beep' | 'voice' | 'file';

export interface IntervalConfig {
  prepare: number;   // secondes de préparation
  work: number;      // secondes d'effort
  rest: number;      // secondes de repos
  rounds: number;    // nombre de cycles effort/repos
  visibility: IntervalVisibility;
  soundMode: IntervalSoundMode;
  soundUrl?: string;                                           // mode 'file'
  voiceUrls?: { prepare?: string; work?: string; rest?: string; done?: string }; // mode 'voice'
}

export interface IntervalRun {
  config: IntervalConfig;
  startedAt: number; // Date.now() en ms (horloge partagée hôte→participants)
}

export const DEFAULT_INTERVAL: IntervalConfig = {
  prepare: 10, work: 30, rest: 15, rounds: 8, visibility: 'all', soundMode: 'beep',
};

interface PhaseState {
  key: IntervalPhaseKey;
  round: number;       // 1..rounds (0 pendant la préparation)
  remaining: number;   // secondes restantes dans la phase
  phaseTotal: number;  // durée totale de la phase
  done: boolean;
}

export function intervalTotalSeconds(c: IntervalConfig): number {
  return Math.max(0, c.prepare) + Math.max(0, c.rounds) * (Math.max(0, c.work) + Math.max(0, c.rest));
}

/** Suggère un nombre de rounds qui « rentre » dans une durée de morceau (lecture seule). */
export function suggestRounds(c: IntervalConfig, durationSec?: number): number | null {
  if (!durationSec || !isFinite(durationSec) || durationSec <= 0) return null;
  const cycle = Math.max(0, c.work) + Math.max(0, c.rest);
  if (cycle <= 0) return null;
  return Math.max(1, Math.floor((durationSec - Math.max(0, c.prepare)) / cycle));
}

// 🍏 iOS : l'oscillateur Web Audio est suspendu écran verrouillé. On génère (UNE SEULE FOIS, sans réseau)
//    un court bip WAV en data-URI, rejoué via un <audio playsinline> dédié. Best effort.
let BEEP_URI: string | null = null;
function beepDataUri(): string {
  if (BEEP_URI) return BEEP_URI;
  const sr = 8000, dur = 0.09, freq = 880, n = Math.floor(sr * dur);
  const dataSize = n * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const wr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wr(36, 'data'); dv.setUint32(40, dataSize, true);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.max(0, Math.min(1, t / 0.005, (dur - t) / 0.005)); // fondu anti-clic
    const v = Math.sin(2 * Math.PI * freq * t) * 0.6 * env;
    dv.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  let bin = '';
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  BEEP_URI = 'data:audio/wav;base64,' + btoa(bin);
  return BEEP_URI;
}

function computePhase(c: IntervalConfig, t: number): PhaseState {
  const prepare = Math.max(0, c.prepare);
  const work = Math.max(0, c.work);
  const rest = Math.max(0, c.rest);
  const rounds = Math.max(0, c.rounds);
  const total = prepare + rounds * (work + rest);
  if (t < 0) t = 0;
  if (t >= total) return { key: 'done', round: rounds, remaining: 0, phaseTotal: 0, done: true };
  if (t < prepare) return { key: 'prepare', round: 0, remaining: prepare - t, phaseTotal: prepare, done: false };
  const rem = t - prepare;
  const cycle = work + rest;
  const round = cycle > 0 ? Math.floor(rem / cycle) : 0;
  const within = rem - round * cycle;
  if (within < work) return { key: 'work', round: round + 1, remaining: work - within, phaseTotal: work, done: false };
  return { key: 'rest', round: round + 1, remaining: rest - (within - work), phaseTotal: rest, done: false };
}

const PHASE_LABEL: Record<IntervalPhaseKey, string> = {
  prepare: 'Préparation', work: 'Effort', rest: 'Repos', done: 'Terminé',
};
// 🎨 Couleurs de la marque BoostTribe (violet → magenta).
const AFRO_GRADIENT = 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)';
// Phases aux couleurs du site, tout en restant distinguables : effort = magenta, repos = violet,
// préparation = ambre (« prépare-toi »), terminé = magenta profond.
const PHASE_COLOR: Record<IntervalPhaseKey, string> = {
  prepare: '#F5A524', work: '#FF2FB3', rest: '#8A2EFF', done: '#D91CD2',
};

interface Props {
  run: IntervalRun | null;
  isHost: boolean;
  onStop: () => void;
  // 🔊 Mixeur optionnel (PC/Android) : si fourni, les sons du timer sont MÉLANGÉS à la musique/voix
  //    et capturés dans l'enregistrement. iOS : non fourni (musique hors Web Audio) → sons via <audio>.
  getMixerContext?: () => AudioContext | null;
  getTimerOutput?: () => AudioNode | null;
}

export interface IntervalTimerHandle {
  /** Débloque le moteur son du timer — à appeler sur le MÊME geste que « Activer le son » de la musique. */
  unlock: () => void;
}

const IS_IOS = typeof navigator !== 'undefined' && (
  /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && ((navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints || 0) > 1)
);

export const IntervalTimer = React.forwardRef<IntervalTimerHandle, Props>((
  { run, isHost, onStop, getMixerContext, getTimerOutput }, ref,
) => {
  const [phase, setPhase] = useState<PhaseState | null>(null);

  // 🔊 Moteur son. PC/Android : réutilise le CONTEXTE DU MIXEUR + une sortie dédiée (getTimerOutput)
  //    → mélangé avec musique/voix ET capturé dans l'enregistrement. iOS / pas de mixeur : contexte
  //    propre + élément <audio> (la musique iOS reste hors Web Audio, intacte).
  const ownCtxRef = useRef<AudioContext | null>(null);
  const usingMixerRef = useRef(false);
  const voiceElRef = useRef<HTMLAudioElement | null>(null);
  const voiceSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const beepElRef = useRef<HTMLAudioElement | null>(null); // 🍏 iOS : bips via asset WAV data-URI
  const soundStateRef = useRef<{ key: IntervalPhaseKey; round: number; lastCount: number | null }>({ key: 'done', round: -1, lastCount: null });
  const doneFiredRef = useRef(false);

  // Contexte courant : mixeur (PC/Android) si dispo, sinon contexte propre (fallback / iOS).
  const getCtx = useCallback((): AudioContext | null => {
    if (!IS_IOS && getMixerContext) {
      const mc = getMixerContext();
      if (mc) { usingMixerRef.current = true; return mc; }
    }
    usingMixerRef.current = false;
    if (!ownCtxRef.current) {
      const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      if (!Ctor) return null;
      try { ownCtxRef.current = new Ctor(); } catch { return null; }
    }
    return ownCtxRef.current;
  }, [getMixerContext]);

  const ensureCtx = useCallback((): AudioContext | null => {
    const ctx = getCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }, [getCtx]);

  // Nœud de sortie : sortie dédiée du mixeur (mélange + enregistrement) si dispo, sinon HP directs.
  const outputNode = useCallback((ctx: AudioContext): AudioNode => {
    if (usingMixerRef.current && getTimerOutput) {
      const out = getTimerOutput();
      if (out) return out;
    }
    return ctx.destination;
  }, [getTimerOutput]);

  const ensureVoiceEl = useCallback((): HTMLAudioElement => {
    if (!voiceElRef.current) {
      const a = new Audio();
      a.preload = 'auto';
      a.setAttribute('playsinline', 'true');
      voiceElRef.current = a;
    }
    return voiceElRef.current;
  }, []);

  const ensureBeepEl = useCallback((): HTMLAudioElement => {
    if (!beepElRef.current) {
      const a = new Audio();
      a.preload = 'auto';
      a.setAttribute('playsinline', 'true');
      a.src = beepDataUri();
      beepElRef.current = a;
    }
    return beepElRef.current;
  }, []);

  const playBeepAsset = useCallback(() => {
    try { const a = ensureBeepEl(); a.currentTime = 0; a.play().catch(() => {}); } catch { /* no-op */ }
  }, [ensureBeepEl]);

  const beep = useCallback((freq: number, durMs: number, gain = 0.25) => {
    // 🍏 iOS : oscillateur Web Audio suspendu écran verrouillé → asset WAV via <audio> dédié (best effort).
    if (IS_IOS) { playBeepAsset(); return; }
    const ctx = ensureCtx();
    if (!ctx) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g); g.connect(outputNode(ctx));
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
      o.start(t);
      o.stop(t + durMs / 1000 + 0.03);
    } catch { /* no-op */ }
  }, [ensureCtx, outputNode, playBeepAsset]);

  const playUrl = useCallback((url?: string) => {
    if (!url) return;
    try {
      const a = ensureVoiceEl();
      const ctx = ensureCtx(); // met à jour usingMixerRef (mixeur dispo ?) avant de décider du routage
      // PC/Android : router l'élément <audio> via le mixeur (mélange + enregistrement), une seule fois.
      if (!IS_IOS && usingMixerRef.current && getTimerOutput && ctx && !voiceSrcRef.current) {
        try { voiceSrcRef.current = ctx.createMediaElementSource(a); voiceSrcRef.current.connect(outputNode(ctx)); } catch { /* déjà routé */ }
      }
      a.src = url;
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch { /* no-op */ }
  }, [ensureVoiceEl, ensureCtx, getTimerOutput, outputNode]);

  const onEnterPhase = useCallback((cfg: IntervalConfig, ph: PhaseState) => {
    if (cfg.soundMode === 'voice') {
      if (ph.key === 'prepare') playUrl(cfg.voiceUrls?.prepare);
      else if (ph.key === 'work') playUrl(cfg.voiceUrls?.work);
      else if (ph.key === 'rest') playUrl(cfg.voiceUrls?.rest);
    } else if (cfg.soundMode === 'file') {
      if (ph.key === 'work') playUrl(cfg.soundUrl);
    } else { // beep
      if (ph.key === 'work') beep(880, 180, 0.3);
      else if (ph.key === 'rest') beep(440, 160, 0.22);
    }
  }, [beep, playUrl]);

  const onDone = useCallback((cfg: IntervalConfig) => {
    if (cfg.soundMode === 'voice') playUrl(cfg.voiceUrls?.done);
    else if (cfg.soundMode === 'file') playUrl(cfg.soundUrl);
    else { beep(660, 500, 0.3); }
  }, [beep, playUrl]);

  // 🔓 Débloquer le moteur son : (a) API impérative appelée par « Activer le son » de la musique
  //    (même geste hôte→participant), (b) 1er geste local, (c) retour au 1er plan → resume du contexte
  //    PROPRE du timer UNIQUEMENT (jamais celui de la musique).
  const unlock = useCallback(() => {
    ensureCtx();
    const prime = (a: HTMLAudioElement) => {
      try {
        a.muted = true;
        const p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
        } else { a.muted = false; }
      } catch { /* no-op */ }
    };
    prime(ensureVoiceEl());
    if (IS_IOS) prime(ensureBeepEl()); // 🍏 débloquer aussi l'<audio> des bips sur ce même geste
  }, [ensureCtx, ensureVoiceEl, ensureBeepEl]);

  useImperativeHandle(ref, () => ({ unlock }), [unlock]);

  useEffect(() => {
    if (!run) return;
    const onGesture = () => { unlock(); };
    window.addEventListener('pointerdown', onGesture, { once: true });
    const onVis = () => {
      // resume UNIQUEMENT le contexte propre du timer (jamais celui de la musique/mixeur).
      if (document.visibilityState === 'visible' && ownCtxRef.current?.state === 'suspended') {
        ownCtxRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [run, unlock]);

  // Boucle de tick : recalcule la phase depuis le timestamp partagé (pas de dérive).
  useEffect(() => {
    if (!run) { setPhase(null); return; }
    // reset détection sons pour ce run
    soundStateRef.current = { key: 'idle' as IntervalPhaseKey, round: -1, lastCount: null };
    doneFiredRef.current = false;
    ensureCtx();

    const tick = () => {
      const t = (Date.now() - run.startedAt) / 1000;
      const ph = computePhase(run.config, t);
      setPhase(ph);

      // transitions de phase → son d'entrée (chaque client, localement)
      if (ph.key !== soundStateRef.current.key || ph.round !== soundStateRef.current.round) {
        if (ph.done) {
          if (!doneFiredRef.current) { doneFiredRef.current = true; onDone(run.config); }
        } else {
          onEnterPhase(run.config, ph);
        }
        soundStateRef.current = { key: ph.key, round: ph.round, lastCount: null };
      }
      // décompte 3-2-1 en fin de préparation / repos / EFFORT (bips ; fin d'effort = bip plus grave).
      if (run.config.soundMode === 'beep' && (ph.key === 'prepare' || ph.key === 'rest' || ph.key === 'work') && !ph.done) {
        const c = Math.ceil(ph.remaining);
        if (c <= 3 && c >= 1 && c !== soundStateRef.current.lastCount) {
          soundStateRef.current.lastCount = c;
          beep(ph.key === 'work' ? 700 : 1000, 90, 0.2);
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [run, onEnterPhase, onDone, beep, ensureCtx]);

  if (!run || !phase) return null;

  const color = PHASE_COLOR[phase.key];
  const secs = Math.max(0, Math.ceil(phase.remaining));
  const mm = Math.floor(secs / 60).toString().padStart(2, '0');
  const ss = (secs % 60).toString().padStart(2, '0');
  const rounds = Math.max(0, run.config.rounds);

  return (
    <div className="fixed inset-0 z-[130] pointer-events-none flex items-start justify-center pt-20 sm:pt-24">
      <div
        className="pointer-events-none select-none rounded-3xl px-8 py-6 text-center shadow-2xl backdrop-blur-md"
        style={{ background: 'rgba(10,10,15,0.72)', border: `2px solid ${color}`, minWidth: 260, boxShadow: `0 0 44px ${color}55, 0 10px 44px rgba(138,46,255,0.30)` }}
        data-testid="interval-timer-overlay"
      >
        <div className="text-sm font-semibold tracking-wide mb-1" style={{ color }}>
          {PHASE_LABEL[phase.key]}
          {phase.key !== 'done' && phase.round > 0 ? ` · ${phase.round}/${rounds}` : ''}
        </div>
        <div className="font-bold text-white leading-none" style={{ fontSize: 64, fontVariantNumeric: 'tabular-nums' }}>
          {phase.key === 'done' ? '✓' : `${mm}:${ss}`}
        </div>
        {phase.key !== 'done' && (
          <div className="mt-3 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{ width: `${phase.phaseTotal > 0 ? (1 - phase.remaining / phase.phaseTotal) * 100 : 0}%`, background: color }}
            />
          </div>
        )}
        {isHost && (
          <button
            type="button"
            onClick={onStop}
            className="pointer-events-auto mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            style={{ background: AFRO_GRADIENT }}
            data-testid="interval-timer-stop"
          >
            {phase.key === 'done' ? <X size={16} /> : <Pause size={16} />}
            {phase.key === 'done' ? 'Fermer' : 'Arrêter'}
          </button>
        )}
      </div>
    </div>
  );
});

IntervalTimer.displayName = 'IntervalTimer';

export default IntervalTimer;
