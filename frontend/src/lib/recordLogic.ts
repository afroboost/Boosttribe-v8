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

/* ────────────────────────────────────────────────────────────────────────────
 * FIX MP4/QuickTime (terrain, 17/09) — le fichier faisait 0 octet.
 *
 * Cause prouvée avec le vrai Chrome : « Enregistrer » sans scène à l'antenne →
 * le recorder démarre le programme, puis l'effet de SessionPage (« rien à
 * l'antenne → programme.arreter() ») coupe les pistes 1 s plus tard → le
 * MediaRecorder s'arrête TOUT SEUL (0 octet reçu) sans que le hook l'écoute :
 * le compteur continuait, « Arrêter » fermait un fichier vide et annonçait
 * « Fichier enregistré ». QuickTime refusait un fichier de 0 octet.
 *
 * Deux règles PURES, testées :
 *  - `antennePourEnregistrer` : ce qu'il faut faire AVANT de démarrer quand
 *    rien n'est à l'antenne (mettre la caméra du coach à l'antenne, ou refuser
 *    clairement) ;
 *  - `verdictFinalisation` : un fichier de 0 octet n'est JAMAIS « prêt ».
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AntenneVerdict {
  action: 'rien' | 'mettre_coach' | 'refuser';
  message?: string;
}

/**
 * Rien à l'antenne au moment d'enregistrer : la caméra du coach y est mise
 * (scène « Coach plein écran ») si elle existe ; sinon on refuse en le disant.
 * `sources` = les sources du studio (`kind` suffit).
 */
export function antennePourEnregistrer(programmeALAntenne: boolean, sources: { kind: string }[]): AntenneVerdict {
  if (programmeALAntenne) return { action: 'rien' };
  if (sources.some((s) => s.kind === 'coach')) return { action: 'mettre_coach' };
  return { action: 'refuser', message: 'Rien à enregistrer : allumez votre caméra ou mettez une scène à l’antenne dans le Studio.' };
}

export interface FinalisationEntree {
  /** Octets réellement écrits dans le fichier. */
  octets: number;
  /** `true` si l'hôte a cliqué « Arrêter » ; `false` si l'enregistreur s'est arrêté seul (piste finie, erreur). */
  arretDemande: boolean;
  dureeSec: number;
}

export interface FinalisationVerdict {
  etat: 'pret' | 'erreur';
  /** Message affiché (erreur) ou avis (prêt mais écourté). `null` = rien à dire. */
  message: string | null;
}

export function verdictFinalisation(e: FinalisationEntree): FinalisationVerdict {
  if (e.octets <= 0) {
    return { etat: 'erreur', message: e.arretDemande
      ? 'Aucune image enregistrée : le Programme s’est arrêté avant la première image. Mettez une scène à l’antenne, puis réessayez.'
      : 'Enregistrement interrompu avant la première image : le Programme s’est arrêté. Mettez une scène à l’antenne, puis réessayez.' };
  }
  if (!e.arretDemande) {
    return { etat: 'pret', message: `Le Programme s’est arrêté : l’enregistrement a été finalisé à ${formaterDuree(e.dureeSec)}.` };
  }
  return { etat: 'pret', message: null };
}

/* ────────────────────────────────────────────────────────────────────────────
 * RÉSOLUTION AFFICHÉE = RÉSOLUTION ENCODÉE (terrain 20/09).
 *
 * Le panneau « Enregistrement prêt » disait « 1920×1080 » quand ffprobe lisait
 * 1280×720. Cause : l'affichage venait de la qualité DEMANDÉE (`choisirResolution`),
 * alors que MediaRecorder encode ce que la piste lui fournit. Mesuré dans le vrai
 * Chrome 153 (21/09) :
 *  - `track.getSettings()` d'une piste canvas suit le canvas (~100 ms après un
 *    redimensionnement) ;
 *  - le conteneur (MP4/WebM) fige la résolution de la PREMIÈRE image encodée : un
 *    fichier démarré en 720 puis passé en 1080 reste « 1280×720 » pour ffprobe (et
 *    l'inverse) ; un redimensionnement juste avant `start()` peut même laisser une
 *    image de l'ancienne taille en tête (conteneur 1080, piste mesurée 720).
 * Ordre de vérité, du plus sûr au moins sûr :
 *  1. `fichier`  : l'en-tête écrit dans la 1re tranche (`resolutionFichier`) — ce que
 *                  ffprobe lit, par construction ;
 *  2. `piste`    : `getSettings()` de la piste encodée (1re tranche, puis finalisation) ;
 *  3. `demandee` : la valeur demandée, dernier recours, dite comme telle via `source`.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Largeur/hauteur telles que `MediaStreamTrack.getSettings()` ou l'en-tête du fichier les donnent (peuvent manquer). */
export interface MesurePiste { width?: number; height?: number }

export interface ResolutionEncodee {
  largeur: number;
  hauteur: number;
  /** `fichier` = en-tête du fichier ; `piste` = piste réellement encodée ; `demandee` = aucune mesure valide. */
  source: 'fichier' | 'piste' | 'demandee';
}

const mesureValide = (m: MesurePiste | null | undefined): m is Required<MesurePiste> =>
  !!m && typeof m.width === 'number' && typeof m.height === 'number' && m.width > 0 && m.height > 0;

/**
 * En-tête du fichier d'abord, puis la première mesure VALIDE de `pistes` (1re tranche, puis
 * finalisation), sinon `demandee`. Une mesure est valide si largeur et hauteur sont des nombres > 0.
 */
export function resolutionEncodee(
  entete: MesurePiste | null | undefined,
  pistes: (MesurePiste | null | undefined)[],
  demandee: { largeur: number; hauteur: number },
): ResolutionEncodee {
  if (mesureValide(entete)) return { largeur: entete.width, hauteur: entete.height, source: 'fichier' };
  for (const m of pistes) if (mesureValide(m)) return { largeur: m.width, hauteur: m.height, source: 'piste' };
  return { largeur: demandee.largeur, hauteur: demandee.hauteur, source: 'demandee' };
}

/** « 1280 × 720 » — espaces autour du ×, valeurs entières. */
export function libelleResolution(r: { largeur: number; hauteur: number }): string {
  return `${Math.round(r.largeur)} × ${Math.round(r.hauteur)}`;
}
