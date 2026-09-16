import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X, RefreshCw, Mic, MicOff } from 'lucide-react';
import { VuMeterSegmented } from '@/components/audio/VuMeter';
import { estMobile, familleCamera, libelleCamera, libelleMicro, estCameraDeLAppareil } from '@/lib/sourcesLogic';
import type { CameraSecondaire } from '@/hooks/useSecondaryCameras';
import type { UseSecondaryMicReturn } from '@/hooks/useSecondaryMic';

/**
 * 🎛️ SOURCES — Phase 1 du mini studio. Un seul tiroir, épuré : la vidéo reste l'élément principal,
 * le tiroir n'existe que le temps d'un choix. Deux blocs : CAMÉRA (principale = LiveKit, avant/arrière
 * sur téléphone, externes sur ordinateur, aperçus locaux secondaires sur Chromium) et AUDIO (micro
 * principal = le contrôle existant, micro secondaire optionnel branché sur le mixeur).
 * Aucun terme technique à l'écran (pas de deviceId, pas de « user/environment »).
 */
export interface SourcesDrawerProps {
  ouvert: boolean;
  onFermer: () => void;
  // Caméra principale (LiveKit)
  videoDevices: MediaDeviceInfo[];
  videoDeviceId: string | null;
  cameraOn: boolean;
  onSelectCamera: (deviceId: string) => void;
  onRefreshDevices?: (probe?: boolean) => void;
  // Caméras secondaires (aperçus locaux, ordinateur Chromium)
  multiCamPossible: boolean;
  camerasSecondaires: CameraSecondaire[];
  onAjouterCamera: (deviceId: string, label: string) => void;
  onRetirerCamera: (deviceId: string) => void;
  // Micro principal (contrôle existant, via handle)
  micDevices: MediaDeviceInfo[];
  micDeviceId: string | null;
  onSelectMic: (deviceId: string) => void;
  onRefreshMics?: () => void;
  // Micro secondaire (optionnel, mixeur)
  micSecondaire?: UseSecondaryMicReturn;
}

const Puce: React.FC<{ actif: boolean }> = ({ actif }) => (
  <span
    aria-hidden
    className={`inline-block w-2.5 h-2.5 rounded-full border ${actif ? 'bg-[var(--bt-accent)] border-[var(--bt-accent)]' : 'border-white/40'}`}
  />
);

const Ligne: React.FC<{ actif: boolean; onClick?: () => void; testid?: string; children: React.ReactNode; droite?: React.ReactNode }> = ({ actif, onClick, testid, children, droite }) => (
  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      data-testid={testid}
      className={`flex-1 flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-[13px] transition-colors ${actif ? 'text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
    >
      <Puce actif={actif} />
      <span className="truncate">{children}</span>
      {actif && <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--bt-accent)]">Principal</span>}
    </button>
    {droite}
  </div>
);

const ApercuLocal: React.FC<{ stream: MediaStream | null }> = ({ stream }) => {
  const ref = React.useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay muted playsInline className="w-14 h-9 rounded object-cover bg-black/60" />;
};

export const SourcesDrawer: React.FC<SourcesDrawerProps> = ({
  ouvert, onFermer,
  videoDevices, videoDeviceId, cameraOn, onSelectCamera, onRefreshDevices,
  multiCamPossible, camerasSecondaires, onAjouterCamera, onRetirerCamera,
  micDevices, micDeviceId, onSelectMic, onRefreshMics,
  micSecondaire,
}) => {
  const mobile = useMemo(() => typeof navigator !== 'undefined' && estMobile(navigator.userAgent, navigator.maxTouchPoints || 0), []);
  const [ajoutCam, setAjoutCam] = useState(false);
  const [ajoutMic, setAjoutMic] = useState(false);
  useEffect(() => { if (!ouvert) { setAjoutCam(false); setAjoutMic(false); } }, [ouvert]);
  if (!ouvert) return null; // tiroir fermé = AUCUNE liste visible

  // Sur téléphone : avant / arrière d'abord, puis les externes ; sur ordinateur : tout, l'intégrée d'abord.
  const cams = [...videoDevices].sort((a, b) => Number(estCameraDeLAppareil(b.label)) - Number(estCameraDeLAppareil(a.label)));
  const candidatesSecondaires = videoDevices.filter((d) => d.deviceId !== videoDeviceId && !camerasSecondaires.some((c) => c.deviceId === d.deviceId));
  const candidatsMic2 = micDevices.filter((d) => d.deviceId !== micDeviceId && d.deviceId !== micSecondaire?.deviceId);

  return (
    <div className="border-t border-white/10 bg-black/40 px-3 py-3 space-y-3" data-testid="sources-drawer" role="dialog" aria-label="Sources">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-white/50">Sources</span>
        <button type="button" onClick={onFermer} aria-label="Fermer les sources" className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10" data-testid="sources-close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ─── CAMÉRA ─── */}
      <section className="space-y-1" data-testid="sources-camera">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-white/40">Caméra</span>
          <button type="button" onClick={() => onRefreshDevices?.(true)} aria-label="Rafraîchir les caméras" title="Rafraîchir" className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10" data-testid="sources-camera-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {cams.length === 0 ? (
          <p className="text-xs text-white/45 px-2 py-1" data-testid="sources-camera-none">Aucune caméra disponible — le live continue en audio.</p>
        ) : cams.map((d, i) => (
          <Ligne key={d.deviceId} actif={cameraOn && d.deviceId === videoDeviceId} onClick={() => onSelectCamera(d.deviceId)} testid="sources-camera-option">
            {libelleCamera(d, i)}
          </Ligne>
        ))}

        {/* Aperçus locaux secondaires — ordinateur Chromium seulement (mobile/Safari : mono-caméra). */}
        {multiCamPossible && !mobile && (
          <div className="pt-1 space-y-1" data-testid="sources-secondaires">
            {camerasSecondaires.map((c) => (
              <div key={c.deviceId} className="flex items-center gap-2 px-2 py-1 rounded-lg text-[13px] text-white/70" data-testid="sources-secondaire">
                {c.etat === 'ok' ? <ApercuLocal stream={c.stream} /> : <span className="w-14 h-9 rounded bg-black/60 grid place-items-center text-[10px] text-white/40">—</span>}
                <span className="truncate flex-1">{libelleCamera(c, 0)}{c.etat === 'indisponible' && <span className="text-white/40"> · Caméra indisponible</span>}</span>
                <button type="button" onClick={() => onRetirerCamera(c.deviceId)} aria-label="Arrêter cette caméra" className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {!ajoutCam ? (
              <button type="button" onClick={() => { onRefreshDevices?.(true); setAjoutCam(true); }} className="flex items-center gap-1.5 px-2 py-1.5 text-[13px] text-white/60 hover:text-white rounded-lg hover:bg-white/10" data-testid="sources-camera-add">
                <Plus className="w-3.5 h-3.5" /> Ajouter une caméra
              </button>
            ) : (
              <div className="space-y-1 px-2">
                {candidatesSecondaires.length === 0
                  ? <p className="text-xs text-white/45">Branche une caméra (USB, capture HDMI) puis rafraîchis.</p>
                  : candidatesSecondaires.map((d, i) => (
                    <button key={d.deviceId} type="button" onClick={() => { onAjouterCamera(d.deviceId, d.label); setAjoutCam(false); }} className="block w-full text-left px-2 py-1 rounded text-[13px] text-white/70 hover:bg-white/10 hover:text-white" data-testid="sources-camera-add-option">
                      {libelleCamera(d, i)}{familleCamera(d.label) === 'externe' ? '' : ' (intégrée)'}
                    </button>
                  ))}
                <button type="button" onClick={() => setAjoutCam(false)} className="text-xs text-white/45 hover:text-white px-2 py-1">Annuler</button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─── AUDIO ─── */}
      <section className="space-y-1" data-testid="sources-audio">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-white/40">Audio</span>
          <button type="button" onClick={() => onRefreshMics?.()} aria-label="Rafraîchir les micros" title="Rafraîchir" className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10" data-testid="sources-mic-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {micDevices.length === 0 ? (
          <p className="text-xs text-white/45 px-2 py-1">Micro de l’appareil (active le micro pour voir la liste).</p>
        ) : micDevices.map((d, i) => (
          <Ligne key={d.deviceId} actif={d.deviceId === micDeviceId || (!micDeviceId && i === 0)} onClick={() => onSelectMic(d.deviceId)} testid="sources-mic-option">
            {libelleMicro(d.label, i)}
          </Ligne>
        ))}

        {/* Micro secondaire (optionnel) : gain + mute + vumètre, branché sur le mixeur existant. */}
        {micSecondaire && (
          <div className="pt-1 space-y-1" data-testid="sources-mic2">
            {micSecondaire.actif ? (
              <div className="px-2 py-1 rounded-lg space-y-1" data-testid="sources-mic2-actif">
                <div className="flex items-center gap-2 text-[13px] text-white/80">
                  <Puce actif />
                  <span className="truncate flex-1">{libelleMicro(micSecondaire.label, 1)}</span>
                  <button type="button" onClick={() => micSecondaire.setMuted(!micSecondaire.muted)} aria-label={micSecondaire.muted ? 'Réactiver le micro secondaire' : 'Couper le micro secondaire'} className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10" data-testid="sources-mic2-mute">
                    {micSecondaire.muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={micSecondaire.arreter} aria-label="Arrêter le micro secondaire" className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2 pl-5">
                  <input type="range" min={0} max={250} value={Math.round(micSecondaire.gain * 100)} onChange={(e) => micSecondaire.setGain(Number(e.target.value) / 100)} aria-label="Gain du micro secondaire" className="flex-1 accent-[var(--bt-accent)]" data-testid="sources-mic2-gain" />
                  <VuMeterSegmented level={Math.round(micSecondaire.niveau * 100)} />
                </div>
              </div>
            ) : !ajoutMic ? (
              <button type="button" onClick={() => { onRefreshMics?.(); setAjoutMic(true); }} className="flex items-center gap-1.5 px-2 py-1.5 text-[13px] text-white/60 hover:text-white rounded-lg hover:bg-white/10" data-testid="sources-mic-add">
                <Plus className="w-3.5 h-3.5" /> Ajouter un micro
              </button>
            ) : (
              <div className="space-y-1 px-2">
                {candidatsMic2.length === 0
                  ? <p className="text-xs text-white/45">Branche un micro puis rafraîchis.</p>
                  : candidatsMic2.map((d, i) => (
                    <button key={d.deviceId} type="button" onClick={() => { micSecondaire.activer(d.deviceId, d.label); setAjoutMic(false); }} className="block w-full text-left px-2 py-1 rounded text-[13px] text-white/70 hover:bg-white/10 hover:text-white" data-testid="sources-mic-add-option">
                      {libelleMicro(d.label, i + 1)}
                    </button>
                  ))}
                <button type="button" onClick={() => setAjoutMic(false)} className="text-xs text-white/45 hover:text-white px-2 py-1">Annuler</button>
              </div>
            )}
            {micSecondaire.erreur && <p className="text-xs text-white/45 px-2">{micSecondaire.erreur}</p>}
          </div>
        )}
      </section>
    </div>
  );
};

export default SourcesDrawer;
