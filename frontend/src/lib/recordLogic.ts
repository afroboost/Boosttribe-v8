/**
 * ENREGISTREMENT LOCAL DU PROGRAMME — logique PURE (Phase 4).
 *
 * Rien ici ne touche au DOM ni au réseau : ces fonctions décident de la
 * stratégie d'écriture, du codec, du nom de fichier, des débits et des replis,
 * à partir de ce que le navigateur DIT savoir faire. Le pipeline (hook) ne fait
 * qu'exécuter ces décisions. Aucune vidéo ne part vers un serveur : la capture
 * s'écrit dans le stockage privé du navigateur (OPFS) ou, en dernier recours, en
 * mémoire ; le disque de l'hôte n'est touché qu'à l'export, après finalisation.
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
 * Stratégie de CAPTURE (UX REC, 28/09) — « Enregistrer » démarre IMMÉDIATEMENT, sans aucune boîte de
 * dialogue. Avant, `showSaveFilePicker` s'ouvrait AU DÉMARRAGE et créait un fichier de 0 octet sur le
 * disque de l'hôte (laissé tel quel si le Programme échouait ensuite). Désormais :
 *  1. OPFS écrivable (`createWritable`) : fichier temporaire privé écrit au fil de l'eau ; un crash
 *     laisse le temporaire (reprise possible) ;
 *  2. sinon mémoire (Safari : OPFS sans `createWritable`) — borné, avertissement.
 * Le choix de l'emplacement (`showSaveFilePicker`) n'arrive qu'à l'EXPORT, après finalisation.
 * `fsa` reste dans le type (contrat UI) mais n'est plus jamais choisi pour la capture.
 */
export function choisirStrategie(env: EnvEnregistrement): RecStrategie {
  if (!env.mediaRecorder) return 'aucune';
  if (env.opfs && env.opfsWritable) return 'opfs';
  return 'memoire';
}

/** Étapes d'un enregistrement, dans l'ordre : la capture d'abord, le choix d'emplacement éventuel n'existe qu'à l'export. */
export type EtapeEnregistrement = 'capture' | 'finalisation' | 'export';
export function etapesEnregistrement(capacite: Pick<RecCapacite, 'supporte' | 'strategie'>): EtapeEnregistrement[] {
  if (!capacite.supporte || capacite.strategie === 'aucune') return [];
  return ['capture', 'finalisation', 'export'];
}

/** « Enregistrer sur mon appareil » n'est proposé/exécuté que sur un fichier FINALISÉ (fermé), non vide et pas encore exporté. */
export function exportAutorise(e: { etat: string; fichierFerme: boolean; taille: number; exporte?: boolean }): boolean {
  return e.etat === 'pret' && e.fichierFerme === true && e.taille > 0 && e.exporte !== true;
}

/**
 * Issue d'un export : `ecrit` (sélecteur, copie fermée), `telecharge` (téléchargement lancé), `annule`.
 * Après un export réussi, le temporaire OPFS est retiré : le bouton disparaît (jamais un bouton qui ne
 * fait rien) et une confirmation le remplace. Annulé : le bouton reste, sauf si c'était déjà exporté.
 */
export type IssueExport = 'ecrit' | 'telecharge' | 'annule';
export function apresExport(etat: { exporte: boolean }, issue: IssueExport): { exporte: boolean; boutonExport: boolean; message: string | null } {
  const exporte = etat.exporte || issue === 'ecrit' || issue === 'telecharge';
  return { exporte, boutonExport: !exporte, message: exporte ? 'Enregistré sur votre appareil' : null };
}

/** Option « Enregistrer dès le démarrage » (préférence locale de l'hôte). */
export const CLE_PREF_AUTO = 'bt_rec_auto';
export function lirePrefAuto(raw: string | null | undefined): boolean {
  return raw === '1';
}

/** Démarrage automatique : uniquement au démarrage du live, pour l'hôte, enregistreur inactif et supporté. */
export function doitDemarrerAuto(e: { auto: boolean; evenement: string; estHote: boolean; recEtat: string; supporte: boolean }): boolean {
  return e.auto === true && e.evenement === 'live_demarre' && e.estHote === true && e.recEtat === 'inactif' && e.supporte === true;
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

/**
 * DÉFAUT A (terrain 28/09 : « ● Enregistrement 00:00:19 · 0 o » tout du long, 732 Ko à l'arrêt).
 * Mesuré dans le vrai Chrome 153 : le muxeur MP4 ne livre une tranche (`dataavailable`) qu'à chaque
 * IMAGE CLÉ (un fragment moof/mdat), et l'encodeur n'en pose qu'environ toutes les 100 images : ~3,4 s
 * à 30 i/s, AUCUNE avant l'arrêt à 5 i/s ou 1 i/s (compositeur peu actif, onglet en arrière-plan).
 * `timeslice` seul ne suffit donc pas. Une image clé par seconde (`videoKeyFrameIntervalDuration`,
 * Chrome ; ignoré ailleurs) → une tranche par seconde → la taille affichée suit l'écriture réelle.
 * Même conteneur, mêmes codecs, même débit : seule la cadence des images clés change (GOP 1 s, standard
 * du direct), ce qui rend aussi un fichier coupé net lisible jusqu'à sa dernière seconde écrite.
 */
export const IMAGE_CLE_MS = 1000;

export interface OptionsEnregistreur {
  mimeType: string;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  videoKeyFrameIntervalDuration: number;
}

export function optionsEnregistreur(mime: string, debit: { video: number; audio: number }): OptionsEnregistreur {
  return { mimeType: mime, videoBitsPerSecond: debit.video, audioBitsPerSecond: debit.audio, videoKeyFrameIntervalDuration: IMAGE_CLE_MS };
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

/* ────────────────────────────────────────────────────────────────────────────
 * DÉFAUT B — ENREGISTREMENT INTERROMPU (OPFS). Ce qui est RÉELLEMENT récupérable,
 * mesuré dans le vrai Chrome 153 (28/09) :
 *  - `createWritable()` écrit dans « <nom>.crswap » ; <nom> reste à 0 octet jusqu'à close() ;
 *  - rechargement / fermeture de l'onglet : Chrome JETTE le .crswap → rien à récupérer
 *    (seul reste <nom> à 0 octet, retiré) ;
 *  - arrêt brutal du navigateur (crash, kill, coupure) : le .crswap SURVIT, MP4 fragmenté
 *    lisible jusqu'à la dernière tranche écrite (ffprobe : 3,7 s sur 5) → « partiel » ;
 *  - <nom> non vide = enregistrement terminé et fermé mais jamais téléchargé (« Fermer »
 *    sans « Enregistrer sur mon appareil ») → « complet ».
 * FSA : le fichier est chez l'hôte (hors de portée) ; mémoire : perdu. Ni l'un ni l'autre ici.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface EntreeOpfs { nom: string; taille: number }
export interface ResteOpfs {
  /** Nom de l'entrée dans le dossier OPFS (peut finir par .crswap). */
  source: string;
  /** Nom proposé au téléchargement (.mp4 / .webm). */
  nom: string;
  taille: number;
  nature: 'complet' | 'partiel';
}

const SWAP = '.crswap';
const estVideo = (nom: string) => /\.(mp4|webm)$/i.test(nom);

/**
 * `verrouilles` = noms (sans .crswap) des enregistrements EN COURS (verrou Web Locks tenu, dans cet
 * onglet ou un autre) : jamais proposés, jamais supprimés.
 */
export function classerRestesOpfs(entrees: EntreeOpfs[], verrouilles: string[]): { recuperables: ResteOpfs[]; aSupprimer: string[] } {
  const recuperables: ResteOpfs[] = [];
  const aSupprimer: string[] = [];
  const actifs = new Set(verrouilles);
  for (const e of entrees) {
    const swap = e.nom.endsWith(SWAP);
    const base = swap ? e.nom.slice(0, -SWAP.length) : e.nom;
    if (!estVideo(base) || actifs.has(base)) continue;
    if (e.taille <= 0) { aSupprimer.push(e.nom); continue; }
    recuperables.push({ source: e.nom, nom: base, taille: e.taille, nature: swap ? 'partiel' : 'complet' });
  }
  return { recuperables, aSupprimer };
}
