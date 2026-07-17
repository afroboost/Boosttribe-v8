import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Timer, Mic, Square, Upload, Play, Check, Loader2, Users, User } from 'lucide-react';
import { uploadIntervalSound } from '@/lib/supabaseClient';
import { useFullscreenPortalTarget } from '@/hooks/useFullscreenPortalTarget';
import {
  DEFAULT_INTERVAL, intervalTotalSeconds, suggestRounds,
  type IntervalConfig, type IntervalSoundMode, type IntervalVisibility,
} from './IntervalTimer';

// ⏱️ Modale de configuration d'un interval training pour une chanson (menu 3 points).
//   100% additif : n'utilise ni le micro live, ni l'élément audio musique.
//   L'enregistrement voix ouvre un flux getUserMedia SÉPARÉ, arrêté juste après.

const VOICE_LABELS: { key: 'prepare' | 'work' | 'rest' | 'done'; label: string }[] = [
  { key: 'prepare', label: 'Prépare-toi' },
  { key: 'work', label: 'Go / Effort' },
  { key: 'rest', label: 'Repos' },
  { key: 'done', label: 'Terminé' },
];

const AFRO_GRADIENT = 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)';

function fmt(total: number): string {
  const s = Math.max(0, Math.round(total));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60}s` : `${s}s`;
}

interface Props {
  trackTitle: string;
  sessionId: string;
  initial?: IntervalConfig;
  musicDuration?: number; // durée du morceau (lecture seule) pour la suggestion
  onClose: () => void;
  onSave: (config: IntervalConfig) => void;
  onStart: (config: IntervalConfig) => void;
  onNotify?: (msg: string, type?: 'success' | 'error' | 'default' | 'warning') => void;
}

export const IntervalConfigModal: React.FC<Props> = ({
  trackTitle, sessionId, initial, musicDuration, onClose, onSave, onStart, onNotify,
}) => {
  const base = initial || DEFAULT_INTERVAL;
  const [prepare, setPrepare] = useState(base.prepare);
  const [work, setWork] = useState(base.work);
  const [rest, setRest] = useState(base.rest);
  const [rounds, setRounds] = useState(base.rounds);
  const [visibility, setVisibility] = useState<IntervalVisibility>(base.visibility);
  const [soundMode, setSoundMode] = useState<IntervalSoundMode>(base.soundMode);
  const [soundUrl, setSoundUrl] = useState<string | undefined>(base.soundUrl);
  const [voiceUrls, setVoiceUrls] = useState<IntervalConfig['voiceUrls']>(base.voiceUrls || {});

  const [recording, setRecording] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const config: IntervalConfig = useMemo(() => ({
    prepare: Math.max(0, prepare), work: Math.max(0, work), rest: Math.max(0, rest),
    rounds: Math.max(1, rounds), visibility, soundMode,
    ...(soundMode === 'file' ? { soundUrl } : {}),
    ...(soundMode === 'voice' ? { voiceUrls } : {}),
  }), [prepare, work, rest, rounds, visibility, soundMode, soundUrl, voiceUrls]);

  const total = intervalTotalSeconds(config);
  const suggested = suggestRounds(config, musicDuration);
  const tooLong = !!musicDuration && isFinite(musicDuration) && total > musicDuration + 0.5;

  useEffect(() => () => {
    // cleanup : couper un enregistrement en cours si la modale se ferme
    try { recRef.current?.stop(); } catch { /* no-op */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const pickMime = (): string => {
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const m of cands) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  };

  const startRec = async (key: string) => {
    if (recording || uploading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const type = mr.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setUploading(key);
        const { url } = await uploadIntervalSound(blob, sessionId, `voice_${key}`);
        setUploading(null);
        if (url) {
          setVoiceUrls((v) => ({ ...(v || {}), [key]: url }));
          onNotify?.('Annonce enregistrée', 'success');
        } else {
          // 🔁 Fallback : upload échoué → on garde un URL LOCAL (blob). L'hôte étant le seul émetteur
          //    du son du timer, la voix du décompte fonctionne au moins de son côté (pas de perte).
          try {
            const local = URL.createObjectURL(blob);
            setVoiceUrls((v) => ({ ...(v || {}), [key]: local }));
            onNotify?.('Annonce enregistrée (local)', 'warning');
          } catch {
            onNotify?.('Enregistrement impossible', 'error');
          }
        }
      };
      mr.start();
      setRecording(key);
    } catch {
      setRecording(null);
      onNotify?.('Micro indisponible pour l\'enregistrement', 'error');
    }
  };

  const stopRec = () => {
    try { recRef.current?.stop(); } catch { /* no-op */ }
    setRecording(null);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) { onNotify?.('Fichier audio requis', 'error'); return; }
    setUploading('file');
    const { url } = await uploadIntervalSound(file, sessionId, 'file');
    setUploading(null);
    if (url) { setSoundUrl(url); onNotify?.('Son importé', 'success'); }
    else {
      // 🔁 Fallback local si l'upload échoue (le son marche au moins côté hôte).
      try { setSoundUrl(URL.createObjectURL(file)); onNotify?.('Son importé (local)', 'warning'); }
      catch { onNotify?.('Import impossible', 'error'); }
    }
  };

  const preview = (url?: string) => {
    if (!url) return;
    try {
      if (!previewRef.current) previewRef.current = new Audio();
      previewRef.current.src = url;
      previewRef.current.currentTime = 0;
      previewRef.current.play().catch(() => {});
    } catch { /* no-op */ }
  };

  const numField = (label: string, value: number, setter: (n: number) => void, min = 0, max = 3600) => (
    <div>
      <label className="block text-white/60 text-xs mb-1">{label}</label>
      <input
        type="number" inputMode="numeric" min={min} max={max} value={value}
        onChange={(e) => setter(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="w-full rounded-lg bg-white/5 border border-white/15 px-3 py-2 text-white text-sm focus:outline-none focus:border-white/40"
      />
    </div>
  );

  // 🖥️ Portée DANS l'élément plein écran s'il y en a un → la modale s'affiche PAR-DESSUS la scène
  //     caméras en plein écran (sinon document.body, comportement inchangé).
  const portalTarget = useFullscreenPortalTarget();
  if (!portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-[#14141a] border border-white/10 rounded-2xl max-w-lg w-full max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Timer size={18} style={{ color: 'var(--bt-accent-2)' }} />
            <div className="min-w-0">
              <h2 className="text-white font-bold text-base leading-tight">Interval training</h2>
              <p className="text-white/45 text-xs truncate">{trackTitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Durées */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {numField('Préparation (s)', prepare, setPrepare)}
            {numField('Effort (s)', work, setWork)}
            {numField('Repos (s)', rest, setRest)}
            {numField('Répétitions', rounds, setRounds, 1, 99)}
          </div>

          {/* Suggestion / durée totale */}
          <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm">
            <div className="text-white/70">Durée totale de la séance : <span className="text-white font-semibold">{fmt(total)}</span></div>
            {musicDuration && isFinite(musicDuration) ? (
              <div className={`text-xs mt-1 ${tooLong ? 'text-amber-400' : 'text-white/45'}`}>
                Morceau : {fmt(musicDuration)}.{' '}
                {suggested ? <>Suggestion : ~{suggested} répétitions pour rentrer dans le titre. </> : null}
                {tooLong ? 'La config dépasse la durée du morceau.' : ''}
                {suggested && suggested !== rounds ? (
                  <button type="button" onClick={() => setRounds(suggested)} className="ml-1 underline text-white/70 hover:text-white">
                    utiliser {suggested}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="text-white/40 text-xs mt-1">Lance d'abord le morceau pour une suggestion basée sur sa durée.</div>
            )}
          </div>

          {/* Visibilité */}
          <div>
            <label className="block text-white/60 text-xs mb-2">Affichage du décompte</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button" onClick={() => setVisibility('all')}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm border transition-colors ${visibility === 'all' ? 'text-white border-transparent' : 'text-white/60 border-white/15 hover:bg-white/5'}`}
                style={visibility === 'all' ? { background: AFRO_GRADIENT } : {}}
              >
                <Users size={15} /> Visible par tous
              </button>
              <button
                type="button" onClick={() => setVisibility('host')}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm border transition-colors ${visibility === 'host' ? 'text-white border-transparent' : 'text-white/60 border-white/15 hover:bg-white/5'}`}
                style={visibility === 'host' ? { background: AFRO_GRADIENT } : {}}
              >
                <User size={15} /> Pour moi seulement
              </button>
            </div>
          </div>

          {/* Mode de son */}
          <div>
            <label className="block text-white/60 text-xs mb-2">Son du décompte</label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {([['beep', 'Bips auto'], ['voice', 'Ma voix'], ['file', 'Fichier']] as const).map(([m, lbl]) => (
                <button
                  key={m} type="button" onClick={() => setSoundMode(m)}
                  className={`rounded-lg px-2 py-2 text-sm border transition-colors ${soundMode === m ? 'text-white border-transparent' : 'text-white/60 border-white/15 hover:bg-white/5'}`}
                  style={soundMode === m ? { background: AFRO_GRADIENT } : {}}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {soundMode === 'beep' && (
              <p className="text-white/40 text-xs">Bips générés (aucun fichier requis) : décompte 3-2-1, bip d'effort/repos et bip final.</p>
            )}

            {soundMode === 'voice' && (
              <div className="space-y-2">
                <p className="text-white/40 text-xs">Enregistre tes annonces (le micro est utilisé un court instant, séparément du live).</p>
                {VOICE_LABELS.map(({ key, label }) => {
                  const has = !!voiceUrls?.[key];
                  const isRec = recording === key;
                  const isUp = uploading === key;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-white/70 text-sm w-28 flex-shrink-0">{label}</span>
                      {isRec ? (
                        <button type="button" onClick={stopRec} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs bg-red-500/80 hover:bg-red-500">
                          <Square size={13} /> Stop
                        </button>
                      ) : (
                        <button type="button" onClick={() => startRec(key)} disabled={!!recording || !!uploading}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white/85 text-xs bg-white/10 hover:bg-white/20 disabled:opacity-50">
                          {isUp ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />} {isUp ? 'Envoi…' : (has ? 'Refaire' : 'Enregistrer')}
                        </button>
                      )}
                      {has && !isRec && (
                        <>
                          <Check size={15} className="text-emerald-400" />
                          <button type="button" onClick={() => preview(voiceUrls?.[key])} className="p-1 rounded text-white/50 hover:text-white" aria-label="Écouter">
                            <Play size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {soundMode === 'file' && (
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white/85 text-xs bg-white/10 hover:bg-white/20 cursor-pointer">
                  {uploading === 'file' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {uploading === 'file' ? 'Envoi…' : 'Choisir un fichier'}
                  <input type="file" accept="audio/*" className="hidden" onChange={onFile} />
                </label>
                {soundUrl && (
                  <>
                    <Check size={15} className="text-emerald-400" />
                    <button type="button" onClick={() => preview(soundUrl)} className="p-1 rounded text-white/50 hover:text-white" aria-label="Écouter">
                      <Play size={13} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-white/10 flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button" onClick={() => { onSave(config); onNotify?.('Config enregistrée', 'success'); }}
            className="w-full sm:w-auto px-4 py-2 rounded-xl text-white/80 text-sm border border-white/20 hover:bg-white/5"
          >
            Enregistrer la config
          </button>
          <button
            type="button" onClick={() => onStart(config)}
            className="w-full sm:w-auto px-5 py-2 rounded-xl text-white text-sm font-semibold"
            style={{ background: AFRO_GRADIENT }}
            data-testid="interval-start-now"
          >
            Démarrer maintenant
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
};

export default IntervalConfigModal;
