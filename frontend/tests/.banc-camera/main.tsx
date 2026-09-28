// BANC CAMÉRA — monte le VRAI LiveVisioPanel avec de VRAIES pistes vidéo :
//  - caméra : getUserMedia (Chromium --use-fake-device-for-media-stream → motif Chrome) ;
//  - écran  : getDisplayMedia si le navigateur l'accorde, sinon canvas.captureStream() animé.
// Scénario par l'URL : ?sc=A|B|C|D|E|F  &media=0 (aucune musique chargée).
// Un clic sur #demarrer (geste utilisateur) lance tout.
//
// Même empilement que SessionPage : racine `min-h-screen overflow-x-hidden`, en-tête sticky
// z-40 flouté AVANT le contenu, puis `<main className="relative z-10">` qui contient le panneau.
// Calques Live RÉELS : LiveChatOverlay (3 messages), LiveCommentInput + LiveReactionButton,
// LiveReactionOverlay — les mêmes nœuds que SessionPage passe au panneau.
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@/index.css';
import { LiveVisioPanel } from '@/components/session/LiveVisioPanel';
import { LiveChatOverlay } from '@/components/session/LiveChatOverlay';
import { LiveCommentInput } from '@/components/session/LiveCommentInput';
import { LiveReactionButton, LiveReactionOverlay } from '@/components/session/LiveReactionOverlay';

type W = Window & {
  __camStream?: MediaStream | null;
  __ecranStream?: MediaStream | null;
  __sourceEcran?: string;
  __pret?: boolean;
  __erreur?: string;
  __play?: number;
  __commentaires?: string[];
};
const w = window as W;

const params = new URLSearchParams(location.search);
const sc = (params.get('sc') || 'C').toUpperCase();
const AVEC_CAMERA = sc !== 'B';
const AVEC_ECRAN = sc !== 'A';
const AVEC_MEDIA = params.get('media') !== '0';

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
  if (params.get('ecran') === 'canvas') { w.__sourceEcran = 'canvas.captureStream (forcé)'; return ecranCanvas(); }
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

// `?seul=1` : l'hôte SEUL (cas prod du 28/09 : panneau compact, colonne ~284 px).
const participants = [
  { id: 'hote', name: 'Coach Hôte', isHost: true, isCurrentUser: true, isMicActive: true },
  ...(params.get('seul') === '1' ? [] : [{ id: 'invite', name: 'Invité Sans Caméra', isHost: false, isCurrentUser: false, isMicActive: false }]),
];

const T0 = Date.now();
const TROIS = [
  { id: 'm1', userId: 'awa', name: 'Awa', text: 'Bravo coach !', ts: T0 - 30000 },
  { id: 'm2', userId: 'yann', name: 'Yann', text: "On voit bien l'écran", ts: T0 - 20000 },
  { id: 'm3', userId: 'hote', name: 'Coach Hôte', text: 'Merci à tous, on continue', ts: T0 - 10000 },
];
// `?msg=0|1|3|long` : aucun message, un seul, trois (défaut), ou des messages très longs.
const LONG = 'Super séance ce matin, merci pour les explications sur la respiration et le rythme, on continue comme ça toute la semaine avec le groupe !';
const MESSAGES = (() => {
  const v = params.get('msg') || '3';
  if (v === '0') return [];
  if (v === '1') return TROIS.slice(2);
  if (v === 'long') return [{ ...TROIS[0], text: LONG }, { ...TROIS[2], text: LONG }];
  return TROIS;
})();

const noop = () => {};

function Banc() {
  const [cam, setCam] = useState<MediaStream | null>(null);
  const [ecran, setEcran] = useState<MediaStream | null>(null);
  const [demarre, setDemarre] = useState(false);
  const [total, setTotal] = useState(3);

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

  const chatOverlayNode = (
    <LiveChatOverlay messages={MESSAGES} meUserId="hote" hostUserIds={['hote']} masques={false} />
  );
  const reactionButtonNode = (
    <LiveReactionButton onReagir={() => setTotal((t) => t + 1)} total={total} types={['like', 'bravo', 'feu', 'pouce', 'main', 'rire']} />
  );
  const commentInputNode = (
    <LiveCommentInput
      onEnvoyer={(texte) => { (w.__commentaires ||= []).push(texte); return true; }}
      peutPoserQuestion={false}
      slotDroite={reactionButtonNode}
    />
  );
  const reactionsNode = <LiveReactionOverlay bulles={[]} onFin={noop} />;

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
      // Jeu de commandes réel de l'hôte (mêmes portes que SessionPage).
      onTerminerLive={noop}
      onRecordDirect={noop}
      onToggleRecord={noop}
      recordSupporte
      recordEtat="inactif"
      recordDureeSec={0}
      onTogglePrompteur={noop}
      prompteurOuvert={false}
      onToggleBroadcast={noop}
      broadcastOpen={false}
      broadcastLive={false}
      onToggleStageRequests={noop}
      stageRequestCount={2}
      onStartTimer={noop}
      onToggleStudio={noop}
      studioOpen={false}
      commentairesMasques={false}
      onToggleCommentaires={noop}
      lecture={AVEC_MEDIA ? {
        enCours: false,
        titre: 'Morceau test',
        onPlayPause: () => { w.__play = (w.__play || 0) + 1; },
        onSuivant: noop,
      } : null}
      onToggleScreenShare={noop}
      screenSharing={!!ecran}
      screenSupported
      screenShareDisponible
      ecranStream={ecran}
      ecranLocal
      chatOverlayNode={chatOverlayNode}
      reactionsNode={reactionsNode}
      commentInputNode={commentInputNode}
    />
  ) : null;

  return (
    <div className="min-h-screen overflow-x-hidden" data-bt-racine>
      {!demarre && (
        <button id="demarrer" type="button" onClick={demarrer} style={{ position: 'fixed', top: 0, left: 0, zIndex: 999, padding: 8 }}>Démarrer</button>
      )}
      {/* En-tête de SessionPage : sticky, z-40, flouté — AVANT le contenu. */}
      <header
        data-bt-entete
        className="sticky top-0 z-40 h-16 border-b border-white/10 flex items-center px-4 text-white font-semibold"
        style={{ background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(20px)' }}
      >
        Afroboost Live
      </header>
      {/* Même contexte d'empilement que SessionPage : main relative z-10, max-w-7xl,
          grille 3 colonnes en lg (panneau = colonne de droite ≈ 384 px). */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="hidden lg:block lg:col-span-2 space-y-6">
            <div className="aspect-video rounded-2xl bg-white/5 border border-white/10" data-testid="banc-lecteur-factice" />
          </div>
          <div className="space-y-6">{panneau}</div>
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Banc />);
