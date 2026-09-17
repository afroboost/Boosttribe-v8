/**
 * ENREGISTREMENT LOCAL DU PROGRAMME — logique PURE (Phase 4).
 *
 * Rien ici ne touche au DOM ni au réseau : ces fonctions décident de la
 * stratégie d'écriture, du codec, du nom de fichier, des débits et des replis,
 * à partir de ce que le navigateur DIT savoir faire. Le pipeline (hook) ne fait
 * qu'exécuter ces décisions. Aucune vidéo ne part vers un serveur : la seule
 * destination est le disque de l'hôte (File System Access), le stockage privé
 * du navigateur (OPFS, puis téléchargement) ou, en dernier recours, la mémoire.
 */

export type RecQualite = '720p' | '1080p';
export type RecStrategie = 'fsa' | 'opfs' | 'memoire' | 'aucune';

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

/** Ce que le hook lit sur `window`/`navigator` — passé en paramètre pour rester testable. */
export interface EnvEnregistrement {
  mediaRecorder: boolean;
  isTypeSupported?: (mime: string) => boolean;
  showSaveFilePicker: boolean;
  opfs: boolean;            // navigator.storage.getDirectory
  opfsWritable: boolean;    // FileSystemFileHandle.createWritable (Chrome/Firefox) — Safari : SyncAccessHandle seulement
  userAgent: string;
  memoireGo?: number;       // navigator.deviceMemory si connu
}

/** Ordre de préférence des codecs : H.264/AAC d'abord (lecture universelle), puis WebM. */
export const MIMES_PREFERES: { mime: string; codec: string; extension: 'mp4' | 'webm' }[] = [
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', codec: 'H.264 + AAC', extension: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', codec: 'H.264 + AAC', extension: 'mp4' },
  { mime: 'video/mp4', codec: 'MP4 (codecs du navigateur)', extension: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', codec: 'VP9 + Opus', extension: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', codec: 'VP8 + Opus', extension: 'webm' },
  { mime: 'video/webm', codec: 'WebM (codecs du navigateur)', extension: 'webm' },
];

export function choisirMime(isTypeSupported?: (m: string) => boolean): { mime: string; codec: string; extension: 'mp4' | 'webm' } | null {
  if (!isTypeSupported) return null;
  for (const c of MIMES_PREFERES) {
    try { if (isTypeSupported(c.mime)) return c; } catch { /* navigateur capricieux */ }
  }
  return null;
}

export function estMobile(userAgent: string): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent || '');
}

export function estIOS(userAgent: string): boolean {
  return /iphone|ipad|ipod/i.test(userAgent || '');
}

/**
 * Stratégie d'écriture, du plus sûr au moins sûr :
 *  1. File System Access (`showSaveFilePicker`) : le fichier est choisi AVANT
 *     l'enregistrement et écrit au fil de l'eau → rien à télécharger à la fin,
 *     et un crash laisse sur le disque tout ce qui a été écrit.
 *  2. OPFS : fichier temporaire privé du navigateur, écrit au fil de l'eau,
 *     téléchargé à l'arrêt. Un crash laisse le temporaire (reprise possible).
 *  3. Mémoire : les morceaux restent en RAM — borné, à éviter pour un long live.
 */
export function choisirStrategie(env: EnvEnregistrement): RecStrategie {
  if (!env.mediaRecorder) return 'aucune';
  if (env.showSaveFilePicker) return 'fsa';
  if (env.opfs) return 'opfs';
  return 'memoire';
}

export function detecterCapacite(env: EnvEnregistrement): RecCapacite {
  const mobile = estMobile(env.userAgent);
  const strategie = choisirStrategie(env);
  const codec = choisirMime(env.isTypeSupported);
  if (strategie === 'aucune' || !codec) {
    return { supporte: false, strategie: 'aucune', mime: '', codec: '', extension: 'webm', qualites: [], mobile,
      motif: mobile ? 'Enregistrement haute qualité disponible sur ordinateur' : 'Ce navigateur ne sait pas enregistrer la vidéo' };
  }
  // Mobile : 720p par défaut ; 1080p reste proposé, le repli automatique tranche si la machine ne suit pas.
  const qualites: RecQualite[] = mobile ? ['720p', '1080p'] : ['1080p', '720p'];
  const motif = strategie === 'memoire' ? 'Écriture progressive indisponible : l’enregistrement reste en mémoire (durée limitée).' : undefined;
  return { supporte: true, strategie, mime: codec.mime, codec: codec.codec, extension: codec.extension, qualites, mobile, motif };
}

/** Débits cibles (bit/s) — nets sans être lourds : ~1 Go / 15 min à 1080p. */
export function bitratePour(qualite: RecQualite): { video: number; audio: number } {
  return qualite === '1080p'
    ? { video: 8_000_000, audio: 128_000 }
    : { video: 4_500_000, audio: 128_000 };
}

export function qualiteParDefaut(cap: RecCapacite): RecQualite {
  return cap.qualites[0] ?? '720p';
}

/** Nom automatique `Afroboost-Live-AAAA-MM-JJ-HHMM.ext` (heure locale). */
export function nomFichier(date: Date, extension: 'mp4' | 'webm', marque = 'Afroboost'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${marque}-Live-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.${extension}`;
}

/**
 * Espace : `navigator.storage.estimate()` donne quota/usage (approximatifs).
 * On avertit si moins de `minutesVoulues` d'enregistrement tiennent au débit choisi.
 */
export function estimerEspace(quota: number | undefined, usage: number | undefined, bitrateTotal: number, minutesVoulues = 60):
  { suffisant: boolean; minutesDisponibles: number | null; message: string | null } {
  if (!quota || quota <= 0) return { suffisant: true, minutesDisponibles: null, message: null };
  const libre = Math.max(0, quota - (usage ?? 0));
  const octetsParMinute = (bitrateTotal / 8) * 60;
  const minutes = Math.floor(libre / octetsParMinute);
  if (minutes < minutesVoulues) {
    return { suffisant: minutes >= 5, minutesDisponibles: minutes,
      message: minutes < 5 ? 'Espace disque insuffisant pour enregistrer.' : `Espace disque limité : environ ${minutes} min disponibles.` };
  }
  return { suffisant: true, minutesDisponibles: minutes, message: null };
}

/** Repli 1080p → 720p si le compositeur tombe sous 24 i/s pendant 5 s après le démarrage. */
export interface EtatRepli { sousSeuilDepuis: number | null; replie: boolean }
export const REPLI_SEUIL_FPS = 24;
export const REPLI_DUREE_MS = 5_000;
export function doitReplier720(etat: EtatRepli, fps: number, maintenant: number, qualite: RecQualite): EtatRepli & { replier: boolean } {
  if (qualite !== '1080p' || etat.replie) return { ...etat, replier: false };
  if (fps >= REPLI_SEUIL_FPS || fps === 0) return { sousSeuilDepuis: null, replie: false, replier: false };
  const depuis = etat.sousSeuilDepuis ?? maintenant;
  if (maintenant - depuis >= REPLI_DUREE_MS) return { sousSeuilDepuis: depuis, replie: true, replier: true };
  return { sousSeuilDepuis: depuis, replie: false, replier: false };
}

/** Durée maximale raisonnable en mémoire, d'après la RAM déclarée (ordre de grandeur, 1 Go ≈ 15 min à 1080p). */
export function minutesMaxMemoire(qualite: RecQualite, memoireGo?: number): number {
  const budgetOctets = Math.max(0.5, (memoireGo ?? 4) * 0.25) * 1_073_741_824; // un quart de la RAM
  const { video, audio } = bitratePour(qualite);
  return Math.floor(budgetOctets / ((video + audio) / 8) / 60);
}

export function formaterTaille(octets: number): string {
  if (octets < 1_048_576) return `${Math.round(octets / 1024)} Ko`;
  if (octets < 1_073_741_824) return `${(octets / 1_048_576).toFixed(1)} Mo`;
  return `${(octets / 1_073_741_824).toFixed(2)} Go`;
}

export function formaterDuree(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
