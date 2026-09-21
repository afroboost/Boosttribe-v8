/**
 * 📡 Diffuser en direct — CONTRAT lu par l'UI (miroir structurel du hook `useBroadcast`,
 * lot « moteur multistream »). L'UI ne connaît ni clé, ni URL RTMP, ni jeton : elle ne voit
 * que des STATUTS et des rappels. Tout secret vit côté serveur.
 *
 * 21/09 — état par plateforme, plus jamais un « Non connecté » générique :
 *  - Facebook / YouTube (`kind: 'oauth'`)  : config_required → not_connected → connected | reauth ;
 *  - Instagram / TikTok (`kind: 'manual'`) : config_required → not_configured → configured.
 */
export type BroadcastPlatform = 'instagram' | 'facebook' | 'youtube' | 'tiktok';

export type BroadcastKind = 'oauth' | 'manual';

export type BroadcastStatus =
  | 'connected'        // OAuth relié au compte Afroboost, prêt à être sélectionné
  | 'not_connected'    // OAuth possible (serveur configuré) → action « Connecter »
  | 'reauth'           // jeton expiré / révoqué → « Reconnecter »
  | 'unavailable'      // plateforme non prise en charge sur ce compte / cet appareil
  | 'restricted'       // 403 serveur : identité hors liste blanche Afroboost (SOCIAL_ALLOWED_EMAILS) — la vraie raison, pas « Indisponible »
  | 'config_required'  // variables serveur manquantes → diagnostic (NOMS), aucun bouton
  | 'not_configured'   // Instagram / TikTok : URL RTMPS + clé à saisir → « Configurer »
  | 'configured'       // Instagram / TikTok : clé enregistrée (chiffrée) → prêt à être sélectionné
  | 'starting'         // démarrage en cours
  | 'live'             // en direct
  | 'error'            // n'a pas pu démarrer / s'est arrêtée en erreur
  | 'off';             // pendant un direct : non sélectionnée, donc non diffusée

export interface BroadcastDestination {
  platform: BroadcastPlatform;
  label: string;
  status: BroadcastStatus;
  selected: boolean;
  error?: string;
  kind: BroadcastKind;
  /** `config_required` : noms des variables serveur manquantes (jamais des valeurs). */
  missing: string[];
  /** `configured` : 4 derniers caractères de la clé enregistrée, ou null. Jamais la clé. */
  keyHint: string | null;
  accountLabel: string | null;
}

/** Saisie du formulaire « Configurer » (IG / TikTok) : vit en mémoire le temps de l'envoi, jamais stockée. */
export interface BroadcastSaisie { url: string; cle: string; libelle?: string }

export interface BroadcastResultat { ok: boolean; message: string; missing?: string[] }

/** 🧪 État du test interne « Programme → Egress → fichier » (jamais RTMP). Jamais de secret dedans. */
export interface QaFichierEtat {
  actif: boolean;
  egress_id?: string;
  fichier?: string;
  statut?: string;
  erreur?: string | null;
  video_sid?: string | null;
  audio_sid?: string | null;
  fichiers?: { fichier: string; taille: number; duree_ms: number }[];
  dernier?: boolean;
  debutLocal?: number;
  audioPublie?: boolean;
}

export interface BroadcastLike {
  destinations: BroadcastDestination[];
  live: boolean;
  elapsedSec: number;
  /** false = le serveur est en simulation : rien ne part vers les réseaux (mode mock / verrou fermé). */
  directAutorise: boolean;
  select: (platform: BroadcastPlatform, on: boolean) => void;
  start: () => void;
  stopAll: () => void;
  stop: (platform: BroadcastPlatform) => void;
  retry: (platform: BroadcastPlatform) => void;
  /** Lance le VRAI parcours OAuth (Facebook / Google) ; renvoie l'échec (diagnostic) sinon. */
  connect: (platform: BroadcastPlatform) => Promise<BroadcastResultat>;
  /** Enregistre l'URL RTMPS + clé (IG / TikTok) côté serveur, chiffrées. */
  configure: (platform: BroadcastPlatform, saisie: BroadcastSaisie) => Promise<BroadcastResultat>;
  /** Supprime la configuration / le lien d'une plateforme. */
  forget: (platform: BroadcastPlatform) => Promise<BroadcastResultat>;
  /** Relit l'état serveur (après un retour OAuth, par exemple). */
  refresh: () => Promise<void>;
  /** Message court (retour OAuth, refus, panne réseau), sinon null. */
  avis: string | null;
  /** 🧪 Test interne (compte Afroboost) : Programme → LiveKit → Egress → fichier dans le conteneur, aucun réseau. */
  qaFichier?: QaFichierEtat;
  qaFichierStart?: () => Promise<BroadcastResultat>;
  qaFichierStop?: () => Promise<BroadcastResultat>;
  qaFichierStatus?: () => Promise<QaFichierEtat>;
}
