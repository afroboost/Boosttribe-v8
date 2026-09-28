// BANC CAMÉRA — monte le VRAI LiveVisioPanel avec de VRAIES pistes vidéo :
//  - caméra : getUserMedia (Chromium --use-fake-device-for-media-stream → motif Chrome) ;
//  - écran  : getDisplayMedia si le navigateur l'accorde, sinon canvas.captureStream() animé.
// Scénario par l'URL : ?sc=A|B|C|D|E|F. Un clic sur #demarrer (geste utilisateur) lance tout.
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@/index.css';
import { LiveVisioPanel } from '@/components/session/LiveVisioPanel';

type W = Window & {
  __camStream?: MediaStream | null;
  __ecranStream?: MediaStream | null;
  __sourceEcran?: string;
  __pret?: boolean;
  __erreur?: string;
};
const w = window as W;

const sc = (new URLSearchParams(location.search).get('sc') || 'C').toUpperCase();
const AVEC_CAMERA = sc !== 'B';
const AVEC_ECRAN = sc !== 'A';

function ecranCanvas(): MediaStream {
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 720;
  const ctx = c.getContext('2d')!;
  let t = 0;
  const dessiner = () => {
    t += 1;
    ctx.fillStyle = '#1e3a8a'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(40, 40, 1200, 70);
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 40px sans-serif'; ctx.fillText('ÉCRAN PARTAGÉ (canvas)', 60, 90);
    for (let i = 0; i < 8; i++) { ctx.fillStyle = `hsl(${(i * 45 + t) % 360} 70% 55%)`; ctx.fillRect(60 + i * 145, 160, 120, 480); }
    ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(640 + 400 * Math.sin(t / 30), 400, 50, 0, Math.PI * 2); ctx.fill();
  };
  dessiner();
  setInterval(dessiner, 33);
  return c.captureStream(30);
}

async function obtenirEcran(): Promise<MediaStream> {
  if (new URLSearchParams(location.search).get('ecran') === 'canvas') { w.__sourceEcran = 'canvas.captureStream (forcé)'; return ecranCanvas(); }
  try {
    const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (c: unknown) => Promise<MediaStream> };
    if (!md.getDisplayMedia) throw new Error('getDisplayMedia absent');
    const s = await Promise.race([
      md.getDisplayMedia({ video: true, audio: false }),
      new Promise<MediaStream>((_, rej) => setTimeout(() => rej(new Error('délai getDisplayMedia')), 3000)),
    ]);
    if (!s.getVideoTracks().length) throw new Error('aucune piste');
    w.__sourceEcran = 'getDisplayMedia';
    return s;
  } catch (e) {
    w.__sourceEcran = `canvas.captureStream (getDisplayMedia : ${(e as Error)?.message || e})`;
    return ecranCanvas();
  }
}

const participants = [
  { id: 'hote', name: 'Coach Hôte', isHost: true, isCurrentUser: true, isMicActive: true },
  { id: 'invite', name: 'Invité Sans Caméra', isHost: false, isCurrentUser: false, isMicActive: false },
];

const noop = () => {};
const Coeur = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
  </svg>
);

function Banc() {
  const [cam, setCam] = useState<MediaStream | null>(null);
  const [ecran, setEcran] = useState<MediaStream | null>(null);
  const [demarre, setDemarre] = useState(false);

  const demarrer = async () => {
    try {
      // Écran d'abord : getDisplayMedia exige le geste utilisateur encore « frais ».
      const e = AVEC_ECRAN ? await obtenirEcran() : null;
      const c = AVEC_CAMERA ? await navigator.mediaDevices.getUserMedia({ video: true, audio: false }) : null;
      w.__camStream = c; w.__ecranStream = e;
      setCam(c); setEcran(e); setDemarre(true);
      w.__pret = true;
    } catch (err) {
      w.__erreur = String((err as Error)?.message || err);
    }
  };

  const panneau = demarre ? (
    <LiveVisioPanel
      participants={participants}
      myUserId="hote"
      localStream={cam}
      remoteCameras={[]}
      cameraOn={!!cam}
      activeCameraCount={cam ? 1 : 0}
      maxCameras={6}
      micActive
      onToggleMic={noop}
      onToggleCamera={noop}
      onLeaveLive={noop}
      canManageStage
      estHote
      onToggleScreenShare={noop}
      screenSharing={!!ecran}
      screenSupported
      screenShareDisponible
      ecranStream={ecran}
      ecranLocal
      chatOverlayNode={<div className="text-white/80 text-xs space-y-1"><p><b>Awa</b> : Bravo coach !</p><p><b>Yann</b> : On voit bien l'écran</p></div>}
      reactionsNode={<div className="text-pink-400 text-xs text-right" aria-hidden="true">♥</div>}
      commentInputNode={
        <div className="flex items-center gap-2">
          <input placeholder="Écrire un commentaire…" className="flex-1 min-w-0 h-10 px-3 rounded-full bg-black/60 border border-white/20 text-white text-sm" />
          <button type="button" aria-label="J'aime" className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-full bg-black/60 text-white"><Coeur /></button>
        </div>
      }
    />
  ) : null;

  return (
    <>
      {!demarre && (
        <button id="demarrer" type="button" onClick={demarrer} style={{ position: 'fixed', top: 0, left: 0, zIndex: 999, padding: 8 }}>Démarrer</button>
      )}
      {/* Même gabarit que SessionPage : max-w-7xl, grille 3 colonnes en lg (panneau = colonne de droite ≈ 384 px). */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="hidden lg:block lg:col-span-2 space-y-6">
            <div className="aspect-video rounded-2xl bg-white/5 border border-white/10" data-testid="banc-lecteur-factice" />
          </div>
          <div className="space-y-6">{panneau}</div>
        </div>
      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Banc />);
