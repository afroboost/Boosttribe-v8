import React from 'react';
import { LiveControls } from '@/components/session/LiveControls';

/**
 * 🎛️ Adaptateur COMPATIBLE vers la barre unique `LiveControls`.
 *
 * Le Live Visio n'utilise plus ce composant : sa barre (vue normale ET plein écran caméra)
 * est `LiveControls`, rendue une seule fois dans la zone caméra. Il reste pour le plein
 * écran de la VIDÉO PARTAGÉE (SessionPage → `sharedVideoControlsNode`), dont le lecteur
 * occupe déjà le bas de l'écran : on y rend la MÊME barre, en colonne à droite.
 * API inchangée ; aucune logique ici, seulement des props transmises.
 * Le chat n'y est pas : la bulle « session-chat-launcher » est l'unique entrée.
 */
export interface VisioControlBarProps {
  micActive?: boolean;
  onToggleMic?: () => void;
  cameraOn?: boolean;
  canManageStage?: boolean;
  onToggleCamera?: () => void;
  onRequestStage?: () => void;
  stageRequestPending?: boolean;
  onStartTimer?: () => void;
  onToggleStageRequests?: () => void; // 🙋 gestion de scène (demandes de prise de caméra)
  stageRequestCount?: number;
  onTogglePrompteur?: () => void;
  prompteurOuvert?: boolean;
  onReduce?: () => void;
}

export const VisioControlBar: React.FC<VisioControlBarProps> = (props) => (
  <LiveControls
    pleinEcran
    orientation="verticale"
    className="absolute z-[115] top-1/2 -translate-y-1/2"
    style={{ right: 'max(0.75rem, env(safe-area-inset-right))' }}
    {...props}
  />
);

export default VisioControlBar;
