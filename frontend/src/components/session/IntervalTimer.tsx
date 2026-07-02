import React, { useEffect, useRef, useState, useCallback } from 'react';
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
const PHASE_COLOR: Record<IntervalPhaseKey, string> = {
  prepare: '#F5A524', work: '#16C784', rest: '#3B82F6', done: '#D91CD2',
};

interface Props {
  run: IntervalRun | null;
  isHost: boolean;
  onStop: () => void;
}

export const IntervalTimer: React.FC<Props> = ({ run, isHost, onStop }) => {
  const [phase, setPhase] = useState<PhaseState | null>(null);

  // 🔊 Moteur son ISOLÉ (jamais le mixeur musique/micro).
  const ctxRef = useRef<AudioContext | null>(null);
  const voiceElRef = useRef<HTMLAudioElement | null>(null);
  const soundStateRef = useRef<{ key: IntervalPhaseKey; round: number; lastCount: number | null }>({ key: 'done', round: -1, lastCount: null });
  const doneFiredRef = useRef(false);

  const ensureCtx = useCallback((): AudioContext | null => {
    if (!ctxRef.current) {
      const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      if (!Ctor) return null;
      try { ctxRef.current = new Ctor(); } catch { return null; }
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  }, []);

  const beep = useCallback((freq: number, durMs: number, gain = 0.25) => {
    const ctx = ensureCtx();
    if (!ctx) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
      o.start(t);
      o.stop(t + durMs / 1000 + 0.03);
    } catch { /* no-op */ }
  }, [ensureCtx]);

  const playUrl = useCallback((url?: string) => {
    if (!url) return;
    try {
      if (!voiceElRef.current) { voiceElRef.current = new Audio(); voiceElRef.current.preload = 'auto'; }
      const a = voiceElRef.current;
      a.src = url;
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch { /* no-op */ }
  }, []);

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

  // Débloquer l'autoplay des sons du timer sur un geste (participants qui n'ont pas cliqué « Démarrer »).
  useEffect(() => {
    if (!run) return;
    const unlock = () => { ensureCtx(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [run, ensureCtx]);

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
      // décompte 3-2-1 en fin de préparation / repos (bips uniquement)
      if (run.config.soundMode === 'beep' && (ph.key === 'prepare' || ph.key === 'rest') && !ph.done) {
        const c = Math.ceil(ph.remaining);
        if (c <= 3 && c >= 1 && c !== soundStateRef.current.lastCount) {
          soundStateRef.current.lastCount = c;
          beep(1000, 90, 0.2);
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
        style={{ background: 'rgba(10,10,15,0.72)', border: `2px solid ${color}`, minWidth: 260 }}
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
            className="pointer-events-auto mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white/90 text-sm font-medium bg-white/10 hover:bg-white/20 transition-colors"
            data-testid="interval-timer-stop"
          >
            {phase.key === 'done' ? <X size={16} /> : <Pause size={16} />}
            {phase.key === 'done' ? 'Fermer' : 'Arrêter'}
          </button>
        )}
      </div>
    </div>
  );
};

export default IntervalTimer;
