/**
 * ⏺ Enregistrement local du Programme — contrat vu par l'UI (miroir structurel de
 * `useProgramRecorder`, agent pipeline). À l'intégration, le retour réel du hook s'y branche
 * tel quel. L'UI ne connaît ni MediaRecorder, ni fichiers, ni réseau : seulement des états,
 * des chiffres et des rappels.
 */
export type RecQualite = '720p' | '1080p';
export type RecStrategie = 'fsa' | 'opfs' | 'memoire' | 'aucune';
export type RecEtat = 'inactif' | 'preparation' | 'enregistrement' | 'finalisation' | 'pret' | 'erreur';

export interface RecCapacite {
  supporte: boolean;
  strategie: RecStrategie;
  mime: string;
  codec: string;
  extension: 'mp4' | 'webm';
  qualites: RecQualite[];
  mobile: boolean;
  motif?: string;
}

export interface RecResultat {
  nom: string;
  dureeSec: number;
  tailleOctets: number;
  resolution: string;
  format: string;
  /** `true` = déjà écrit sur le disque (File System Access) : rien à télécharger. */
  dejaEcrit: boolean;
  emplacement?: string;
  sauvegarderSurAppareil: () => Promise<void>;
}

export interface RecorderLike {
  etat: RecEtat;
  capacite: RecCapacite;
  qualite: RecQualite;
  choisirQualite: (q: RecQualite) => void;
  dureeSec: number;
  tailleOctets: number;
  demarrer: () => Promise<void>;
  arreter: () => Promise<void>;
  resultat: RecResultat | null;
  avis: string | null;
  fermerResultat: () => void;
}
