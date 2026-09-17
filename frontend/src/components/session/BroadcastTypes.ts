/**
 * 📡 Diffuser en direct — CONTRAT lu par l'UI (miroir structurel du hook `useBroadcast`,
 * lot « moteur multistream »). L'UI ne connaît ni clé, ni URL RTMP, ni jeton : elle ne voit
 * que des STATUTS et des rappels. Tout secret vit côté serveur.
 */
export type BroadcastPlatform = 'instagram' | 'facebook' | 'youtube' | 'tiktok';

export type BroadcastStatus =
  | 'connected'      // compte relié, prêt à être sélectionné
  | 'not_connected'  // rien de relié → action « Connecter »
  | 'reauth'         // jeton expiré → « Reconnecter »
  | 'unavailable'    // plateforme non prise en charge sur ce compte / cet appareil
  | 'starting'       // démarrage en cours
  | 'live'           // en direct
  | 'error'          // n'a pas pu démarrer / s'est arrêtée en erreur
  | 'off';           // pendant un direct : non sélectionnée, donc non diffusée

export interface BroadcastDestination {
  platform: BroadcastPlatform;
  label: string;
  status: BroadcastStatus;
  selected: boolean;
  error?: string;
}

export interface BroadcastLike {
  destinations: BroadcastDestination[];
  live: boolean;
  elapsedSec: number;
  select: (platform: BroadcastPlatform, on: boolean) => void;
  start: () => void;
  stopAll: () => void;
  stop: (platform: BroadcastPlatform) => void;
  retry: (platform: BroadcastPlatform) => void;
  connectUrl: (platform: BroadcastPlatform) => string | null;
}
