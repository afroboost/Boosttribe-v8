/**
 * HARNAIS NAVIGATEUR — panneau Studio avec les VRAIS composants.
 *
 * Servi par Vite (`yarn dev --port 5182` → http://localhost:5182/tests/harness/studio.html).
 * Rend `LiveVisioPanel` (réel) avec `StudioPanel` (réel) + `useStudio` (réel) + `SceneRenderer`
 * (réel) dans un conteneur de la largeur RÉELLE de la colonne droite de SessionPage
 * (max-w-7xl, px-8, grille 3 colonnes gap-8 → 384 px à 1280/1440) ; sur mobile, pleine largeur
 * moins les gouttières (px-4). Les SOURCES sont synthétiques (canvas.captureStream) : aucun
 * LiveKit, aucun Supabase — seule l'UI est sous test.
 *
 * Paramètres : `?mobile=1` force le mode mobile du panneau (SessionPage : matchMedia ≤ 1023 px).
 * Aucune maquette : ce sont les composants de production.
 */
import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@/index.css';
import { LiveVisioPanel } from '@/components/session/LiveVisioPanel';
import { StudioPanel } from '@/components/session/StudioPanel';
import SceneRenderer from '@/components/session/SceneRenderer';
import { useStudio } from '@/hooks/useStudio';

function fluxSynthetique(couleur: string, texte: string): MediaStream {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 180;
  const g = c.getContext('2d')!;
  const peindre = () => {
    g.fillStyle = couleur; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff'; g.font = '20px sans-serif'; g.fillText(texte, 12, 32);
    requestAnimationFrame(peindre);
  };
  peindre();
  return c.captureStream(15);
}

const q = new URLSearchParams(location.search);
const MOBILE = q.get('mobile') === '1';
const LARGEUR = Number(q.get('w') || (MOBILE ? 0 : 384));

function Harnais() {
  const flux = useMemo(() => ({
    coach: fluxSynthetique('#334', 'Coach'),
    cam2: fluxSynthetique('#433', 'Cam 2'),
    p1: fluxSynthetique('#343', 'Participant 1'),
    p2: fluxSynthetique('#443', 'Participant 2'),
    ecran: fluxSynthetique('#222', 'Écran'),
  }), []);
  const participants = useMemo(() => [
    { identity: 'p1', name: 'Amina', stream: flux.p1 },
    { identity: 'p2', name: 'Karim', stream: flux.p2 },
  ], [flux]);
  const camerasSecondaires = useMemo(() => [{ deviceId: 'cam2', label: 'Caméra USB', stream: flux.cam2 }], [flux]);
  const [studioOpen, setStudioOpen] = useState(q.get('open') !== '0');
  const studio = useStudio({
    coachLabel: 'Coach',
    localStream: flux.coach,
    secondaryCameras: camerasSecondaires,
    participants,
    screenShareActive: true,
    localScreen: flux.ecran,
  });
  // Exposé pour les assertions Playwright (« clic réel → état réellement changé »).
  (window as unknown as { __studio: unknown }).__studio = studio;

  const studioNode = (
    <StudioPanel
      studio={studio}
      participants={participants.map((p) => ({ identity: p.identity, name: p.name }))}
      open={studioOpen}
      onClose={() => setStudioOpen(false)}
      mobile={MOBILE}
      renderScene={(zone) => (
        <SceneRenderer zone={zone} boxes={zone === 'preview' ? studio.boxesPreview : studio.boxesProgram} resolveMedia={studio.resolveMedia} />
      )}
    />
  );

  return (
    <div style={{ padding: MOBILE ? '16px' : '32px', width: LARGEUR ? `${LARGEUR + (MOBILE ? 32 : 64)}px` : 'auto', boxSizing: 'border-box' }} data-testid="harnais">
      <LiveVisioPanel
        participants={[
          { id: 'moi', name: 'Coach', isHost: true, isCurrentUser: true, isMicActive: true },
          { id: 'p1', name: 'Amina' },
          { id: 'p2', name: 'Karim' },
        ]}
        myUserId="moi"
        localStream={flux.coach}
        remoteCameras={[{ userId: 'p1', stream: flux.p1 }, { userId: 'p2', stream: flux.p2 }] as never}
        cameraOn
        activeCameraCount={3}
        maxCameras={6}
        micActive
        onToggleMic={() => {}}
        hideMicButton
        onToggleCamera={() => {}}
        onLeaveLive={() => {}}
        canManageStage
        onSelectCamera={() => {}}
        studioNode={studioNode}
        studioOpen={studioOpen}
        onToggleStudio={() => setStudioOpen((o) => !o)}
        screenSupported
        screenShareDisponible
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harnais />);
