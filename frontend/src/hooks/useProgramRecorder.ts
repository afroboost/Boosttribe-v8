/**
 * ENREGISTREMENT LOCAL DU PROGRAMME (Phase 4).
 *
 * Source = EXACTEMENT `programStream` (vidéo composée par le compositeur + bus
 * audio programme) : ce que les participants voient et ce qu'un direct social
 * recevrait. Aucune 2ᵉ composition, aucun 2ᵉ mixeur, aucune 2ᵉ beauté ; le
 * prompteur et l'interface n'y sont pas par construction (Phase 3).
 *
 * RÈGLE ABSOLUE : la vidéo ne part JAMAIS vers un serveur. Capture locale, décidée par
 * `recordLogic.detecterCapacite`, SANS aucune boîte de dialogue (UX REC 28/09) :
 *  - `opfs`    : fichier temporaire du navigateur écrit au fil de l'eau ;
 *  - `memoire` : morceaux en RAM (durée limitée, avertissement).
 * Le choix de l'emplacement (`showSaveFilePicker`, sinon téléchargement) n'arrive qu'à
 * l'EXPORT, sur un fichier finalisé et non vide (`exportAutorise`) : plus de fichier 0 octet.
 *
 * Chaque `dataavailable` (toutes les secondes) est écrit immédiatement : la
 * RAM ne grandit pas avec la durée en `opfs`. Un seul `MediaRecorder`
 * par enregistrement : les changements de scène ne touchent pas la piste
 * (le compositeur redessine dans le même canvas) → un seul fichier continu.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bitratePour, classerRestesOpfs, CLE_PREF_AUTO, detecterCapacite, exportAutorise, lirePrefAuto, doitReplier720, estimerEspace, formaterTaille, libelleResolution, minutesMaxMemoire,
  nomFichier, optionsEnregistreur, qualiteParDefaut, resolutionEncodee, verdictFinalisation, type EnvEnregistrement, type EtatRepli, type MesurePiste, type RecCapacite, type RecQualite, type RecStrategie, type ResteOpfs,
} from '@/lib/recordLogic';
import { dureeEnUnites, encoderDuree, preparerEnteteWebm } from '@/lib/webmDuree';
import { choisirResolution, type ResolutionProgramme } from '@/lib/programCompositor';
import { resolutionFichier } from '@/lib/resolutionFichier';

export type { RecQualite, RecStrategie, RecCapacite, ResteOpfs } from '@/lib/recordLogic';
export type RecEtat = 'inactif' | 'preparation' | 'enregistrement' | 'finalisation' | 'pret' | 'erreur';

export interface RecResultat {
  nom: string;
  dureeSec: number;
  tailleOctets: number;
  /** « 1280 × 720 » — LUE dans l'en-tête écrit (1re tranche, = ffprobe), secours getSettings de la piste ; jamais la qualité demandée. */
  resolution: string;
  /** `fichier` = lue dans l'en-tête écrit ; `piste` = getSettings ; `demandee` = aucune mesure possible (secours). */
  resolutionSource: 'fichier' | 'piste' | 'demandee';
  format: string;
  dejaEcrit: boolean;
  emplacement?: string;
  sauvegarderSurAppareil: () => Promise<void>;
}

export interface UseProgramRecorderReturn {
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
  /** DÉFAUT B — restes OPFS d'un enregistrement interrompu / jamais téléchargé (hôte seulement, lus à l'ouverture). */
  restes: ResteOpfs[];
  recupererReste: (r: ResteOpfs) => Promise<void>;
  supprimerReste: (r: ResteOpfs) => Promise<void>;
  /** Option « Enregistrer dès le démarrage » (localStorage `bt_rec_auto`). Le déclenchement est fait par la page (`doitDemarrerAuto`). */
  autoStart: boolean;
  setAutoStart: (v: boolean) => void;
}

export const AVIS_ARRIERE_PLAN = 'Live Visio en arrière-plan : vidéo réduite à 1 image/s (le son continue). Gardez Live Visio visible pendant l’enregistrement pour conserver une vidéo fluide.';

export interface UseProgramRecorderOptions {
  programStream: MediaStream | null;
  demarrerProgramme: () => Promise<MediaStream | null>;
  resolutionProgramme?: (q: RecQualite) => void;
  /** i/s courants du compositeur (pour le repli 720p) — optionnel. */
  fpsProgramme?: number;
  /** true quand l'onglet est masqué : le Programme tourne à 1 i/s (Worker, seule cadence que Chrome horodate), la garde de performance
   *  est suspendue — le repli 720p (basé sur `fpsProgramme`) ne doit alors PAS se déclencher. */
  arrierePlanProgramme?: boolean;
  /** DÉFAUT B — true pour l'HÔTE : cherche à l'ouverture les enregistrements interrompus (OPFS). Jamais pour un participant. */
  detecterInterrompus?: boolean;
}

const OPFS_DOSSIER = 'afroboost-enregistrements';
const TIMESLICE_MS = 1000;
/** Verrou Web Locks tenu pendant un enregistrement OPFS : un autre onglet ne le prend jamais pour un reste « interrompu ». */
const VERROU_PREFIXE = 'afroboost-rec:';

/** Prend le verrou `afroboost-rec:<nom>` (non bloquant) ; renvoie de quoi le libérer. Sans Web Locks : rien. */
function prendreVerrou(nom: string): () => void {
  const locks: any = (navigator as any).locks;
  if (typeof locks?.request !== 'function') return () => undefined;
  let liberer: () => void = () => undefined; let libere = false;
  locks.request(VERROU_PREFIXE + nom, () => new Promise<void>((res) => { liberer = res; if (libere) res(); })).catch(() => undefined);
  return () => { libere = true; liberer(); };
}

/** Ce que le navigateur sait faire — lu une fois, sans rien ouvrir. */
export function lireEnvironnement(): EnvEnregistrement {
  const nav: any = typeof navigator !== 'undefined' ? navigator : {};
  const win: any = typeof window !== 'undefined' ? window : {};
  const MR: any = win.MediaRecorder;
  return {
    mediaRecorder: typeof MR === 'function',
    isTypeSupported: typeof MR?.isTypeSupported === 'function' ? (m: string) => MR.isTypeSupported(m) : undefined,
    showSaveFilePicker: typeof win.showSaveFilePicker === 'function',
    opfs: typeof nav.storage?.getDirectory === 'function',
    opfsWritable: typeof win.FileSystemFileHandle?.prototype?.createWritable === 'function',
    userAgent: nav.userAgent || '',
    memoireGo: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
  };
}

/** Écrivain abstrait : même interface pour OPFS et mémoire. */
interface Ecrivain {
  ecrire(chunk: Blob): Promise<void>;
  /** Réécrit `octets` à une position absolue (correction de durée WebM). */
  corriger(position: number, octets: Uint8Array): Promise<void>;
  terminer(): Promise<{ taille: number; fichier?: File; blob?: Blob }>;
  abandonner(): Promise<void>;
  /** Retire le fichier (après `terminer()`), pour ne jamais laisser un fichier VIDE sur l'appareil. */
  supprimer(): Promise<void>;
}

async function ecrivainOpfs(nom: string): Promise<{ ecrivain: Ecrivain; handle: any; dossier: any }> {
  const root = await (navigator as any).storage.getDirectory();
  const dossier = await root.getDirectoryHandle(OPFS_DOSSIER, { create: true });
  const handle = await dossier.getFileHandle(nom, { create: true });
  const w = await handle.createWritable({ keepExistingData: false });
  let pos = 0;
  return {
    handle, dossier,
    ecrivain: {
      async ecrire(chunk) { await w.write(chunk); pos += chunk.size; },
      async corriger(position, octets) { await w.write({ type: 'write', position, data: octets }); },
      async terminer() { await w.close(); const f = await handle.getFile(); return { taille: f.size, fichier: f }; },
      async abandonner() { try { await w.abort(); } catch { /* déjà fermé */ } },
      async supprimer() { try { await dossier.removeEntry(nom); } catch { /* déjà retiré */ } },
    },
  };
}

function ecrivainMemoire(mime: string): Ecrivain {
  const morceaux: Blob[] = [];
  let entete: Uint8Array | null = null;
  return {
    async ecrire(chunk) { morceaux.push(chunk); },
    async corriger(position, octets) {
      // Le premier morceau contient l'en-tête : on le reconstruit avec la durée.
      if (!morceaux.length) return;
      const premier = new Uint8Array(await morceaux[0].arrayBuffer());
      if (position + octets.length <= premier.length) { premier.set(octets, position); entete = premier; morceaux[0] = new Blob([premier], { type: mime }); }
    },
    async terminer() { const blob = new Blob(morceaux, { type: mime }); void entete; return { taille: blob.size, blob }; },
    async abandonner() { morceaux.length = 0; },
    async supprimer() { morceaux.length = 0; },
  };
}

/**
 * Largeur × hauteur RÉELLES de la piste vidéo que le MediaRecorder encode (`getSettings()`), ou null.
 * Mesuré (Chrome 153, 21/09) : pour une piste canvas, `getSettings()` reflète le canvas ~100 ms après un
 * redimensionnement — d'où la lecture à la 1re tranche (1 s), jamais à `start()`.
 */
function mesurerPiste(stream: MediaStream | null | undefined): MesurePiste | null {
  try {
    const t = stream?.getVideoTracks()[0];
    if (!t || typeof t.getSettings !== 'function') return null;
    const s = t.getSettings();
    return { width: s.width, height: s.height };
  } catch { return null; }
}

function telecharger(blobOuFichier: Blob, nom: string): void {
  const url = URL.createObjectURL(blobOuFichier);
  const a = document.createElement('a');
  a.href = url; a.download = nom; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 10_000);
}

/**
 * EXPORT d'un fichier FINALISÉ (UX REC) : c'est ICI, et seulement ici, que l'hôte choisit l'emplacement.
 * `showSaveFilePicker` si le navigateur l'offre (copie écrite puis FERMÉE : le fichier n'existe sur le
 * disque que complet), sinon téléchargement. Annulation = rien (le temporaire reste pour un nouvel essai) ;
 * sélecteur refusé (iframe sans délégation, politique) = téléchargement.
 */
async function exporterFichier(source: Blob, nom: string): Promise<'ecrit' | 'telecharge' | 'annule'> {
  const win: any = typeof window !== 'undefined' ? window : {};
  if (typeof win.showSaveFilePicker === 'function') {
    const ext = /\.mp4$/i.test(nom) ? 'mp4' : 'webm';
    let handle: any = null;
    try {
      handle = await win.showSaveFilePicker({
        suggestedName: nom,
        types: [{ description: ext === 'mp4' ? 'Vidéo MP4' : 'Vidéo WebM', accept: { [ext === 'mp4' ? 'video/mp4' : 'video/webm']: [`.${ext}`] } }],
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'annule';
      handle = null; // refusé ici : repli téléchargement
    }
    if (handle) {
      const w = await handle.createWritable();
      try { await w.write(source); } catch (e) { try { await w.abort(); } catch { /* déjà fermé */ } throw e; }
      await w.close();
      return 'ecrit';
    }
  }
  telecharger(source, nom);
  return 'telecharge';
}

export function useProgramRecorder(o: UseProgramRecorderOptions): UseProgramRecorderReturn {
  const capacite = useMemo(() => detecterCapacite(lireEnvironnement()), []);
  const [qualite, setQualite] = useState<RecQualite>(() => qualiteParDefaut(capacite));
  const [etat, setEtat] = useState<RecEtat>('inactif');
  const etatRef = useRef<RecEtat>('inactif'); etatRef.current = etat;
  const [dureeSec, setDureeSec] = useState(0);
  const [tailleOctets, setTailleOctets] = useState(0);
  const [resultat, setResultat] = useState<RecResultat | null>(null);
  const [avis, setAvis] = useState<string | null>(null);
  const [restes, setRestes] = useState<ResteOpfs[]>([]);
  const [autoStart, setAutoStartEtat] = useState<boolean>(() => {
    try { return lirePrefAuto(window.localStorage.getItem(CLE_PREF_AUTO)); } catch { return false; }
  });
  const setAutoStart = useCallback((v: boolean) => {
    setAutoStartEtat(v);
    try { if (v) window.localStorage.setItem(CLE_PREF_AUTO, '1'); else window.localStorage.removeItem(CLE_PREF_AUTO); } catch { /* stockage bloqué : préférence de la session seulement */ }
  }, []);
  const verrouRef = useRef<(() => void) | null>(null);
  const libererVerrou = useCallback(() => { verrouRef.current?.(); verrouRef.current = null; }, []);

  const recRef = useRef<MediaRecorder | null>(null);
  const ecrivainRef = useRef<Ecrivain | null>(null);
  const opfsRef = useRef<{ handle: any; dossier: any; nom: string } | null>(null);
  // Stratégie EFFECTIVE de l'enregistrement en cours (OPFS ou mémoire — jamais de sélecteur à la capture).
  const strategieRef = useRef<RecStrategie>(capacite.strategie);
  const debutRef = useRef<number>(0);
  const tailleRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const fileEcritureRef = useRef<Promise<void>>(Promise.resolve());
  const webmRef = useRef<{ offset: number | null; timecodeScale: number; premier: boolean }>({ offset: null, timecodeScale: 1_000_000, premier: true });
  const repliRef = useRef<EtatRepli>({ sousSeuilDepuis: null, replie: false });
  const qualiteRef = useRef<RecQualite>(qualite); qualiteRef.current = qualite;
  const resolutionEffectiveRef = useRef<ResolutionProgramme>(choisirResolution(qualite));
  // Terrain 20/09 : le panneau disait « 1920×1080 » (qualité demandée) pour un fichier 1280×720. La résolution
  // AFFICHÉE est désormais LUE dans l'en-tête écrit par la 1re tranche (ce que ffprobe lit), avec en secours
  // `getSettings()` de la piste encodée ; `resolutionEffectiveRef` ne sert plus qu'au repli 720p et de dernier recours.
  const enteteRef = useRef<Promise<MesurePiste | null>>(Promise.resolve(null));
  const resolutionPisteRef = useRef<MesurePiste | null>(null);
  // FIX 0 octet (terrain 17/09) : la finalisation est UNIQUE et déclenchée par l'événement `stop` du
  // MediaRecorder, que l'arrêt soit demandé (« Arrêter »), spontané (pistes du Programme finies : rien
  // à l'antenne, compositeur abandonné) ou dû au démontage. Avant, seul « Arrêter » écoutait `stop` :
  // un recorder mort passait inaperçu, le compteur tournait, et « Arrêter » fermait un fichier VIDE
  // annoncé « Fichier enregistré ». Un fichier de 0 octet n'est plus jamais « prêt ».
  const arretDemandeRef = useRef(false);
  const finalisationRef = useRef<Promise<void> | null>(null);
  const demonteRef = useRef(false);

  const choisirQualite = useCallback((q: RecQualite) => { if (etat === 'inactif' || etat === 'pret') setQualite(q); }, [etat]);

  /** Sérialise les écritures : les morceaux arrivent dans l'ordre, jamais accumulés. */
  const pousserEcriture = useCallback((chunk: Blob) => {
    const ecrivain = ecrivainRef.current; if (!ecrivain) return;
    fileEcritureRef.current = fileEcritureRef.current.then(async () => {
      let data: Blob = chunk;
      if (webmRef.current.premier) {
        webmRef.current.premier = false;
        if (capacite.extension === 'webm') {
          try {
            const prep = preparerEnteteWebm(new Uint8Array(await chunk.arrayBuffer()));
            webmRef.current = { offset: prep.offsetDuree, timecodeScale: prep.timecodeScale, premier: false };
            data = new Blob([prep.octets.buffer.slice(prep.octets.byteOffset, prep.octets.byteOffset + prep.octets.byteLength) as ArrayBuffer], { type: chunk.type });
          } catch { webmRef.current.offset = null; }
        }
      }
      await ecrivain.ecrire(data);
      tailleRef.current += data.size;
      setTailleOctets(tailleRef.current);
    }).catch((e) => { setAvis(`Écriture interrompue : ${(e as Error).message}`); });
  }, [capacite.extension]);

  const nettoyer = useCallback(() => {
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
    recRef.current = null; ecrivainRef.current = null;
  }, []);

  const demarrer = useCallback(async () => {
    if (!capacite.supporte || etat === 'enregistrement' || etat === 'preparation') return;
    setEtat('preparation'); setAvis(null); setResultat(null);
    setDureeSec(0); setTailleOctets(0); tailleRef.current = 0;
    webmRef.current = { offset: null, timecodeScale: 1_000_000, premier: true };
    repliRef.current = { sousSeuilDepuis: null, replie: false };
    resolutionPisteRef.current = null; enteteRef.current = Promise.resolve(null);
    const q = qualiteRef.current;
    const debit = bitratePour(q);
    const nom = nomFichier(new Date(), capacite.extension);
    try {
      // Espace disque (approximatif) — avant toute ouverture de fichier.
      if (capacite.strategie !== 'memoire' && typeof (navigator as any).storage?.estimate === 'function') {
        const est = await (navigator as any).storage.estimate();
        const e = estimerEspace(est?.quota, est?.usage, debit.video + debit.audio);
        if (!e.suffisant) { setAvis(e.message); setEtat('inactif'); return; }
        if (e.message) setAvis(e.message);
      } else if (capacite.strategie === 'memoire') {
        setAvis(`Écriture progressive indisponible ici : limite d’environ ${minutesMaxMemoire(q, lireEnvironnement().memoireGo)} min en mémoire.`);
      }
      // 1. Destination — AVANT la première image, pour que rien ne soit perdu. AUCUNE boîte de dialogue :
      //    le choix de l'emplacement n'arrive qu'à l'export, sur le fichier finalisé.
      strategieRef.current = capacite.strategie;
      if (capacite.strategie === 'opfs') {
        const { ecrivain, handle, dossier } = await ecrivainOpfs(nom);
        ecrivainRef.current = ecrivain; opfsRef.current = { handle, dossier, nom }; verrouRef.current = prendreVerrou(nom);
      } else {
        ecrivainRef.current = ecrivainMemoire(capacite.mime);
      }
      // 2. Source = le programme (démarré si besoin) — la piste est partagée avec les participants/réseaux.
      const res = choisirResolution(q);
      resolutionEffectiveRef.current = res;
      o.resolutionProgramme?.(q);
      const stream = o.programStream ?? (await o.demarrerProgramme());
      if (!stream || !stream.getVideoTracks().some((t) => t.readyState === 'live')) throw new Error('Programme indisponible : mettez une scène à l’antenne.');
      // 3. Un seul MediaRecorder, écriture par tranche d'une seconde.
      //    Une image clé par seconde (DÉFAUT A) : sans elle, le muxeur MP4 de Chrome ne livre rien avant l'arrêt à faible cadence → taille « 0 o ».
      const rec = new MediaRecorder(stream, optionsEnregistreur(capacite.mime, debit));
      // 1re tranche non vide = l'en-tête du fichier (ftyp+moov / EBML+Tracks) : on y LIT la résolution que ffprobe lira,
      // et on mesure la piste en secours. Lecture seule (arrayBuffer d'une copie), le morceau est écrit tel quel.
      const ext = capacite.extension; let premiereTranche = true;
      rec.ondataavailable = (ev: BlobEvent) => { if (!ev.data || ev.data.size <= 0) return; if (premiereTranche) { premiereTranche = false; resolutionPisteRef.current = mesurerPiste(rec.stream); enteteRef.current = ev.data.arrayBuffer().then((b) => resolutionFichier(new Uint8Array(b), ext)).catch(() => null); } pousserEcriture(ev.data); };
      rec.onerror = () => { setAvis('L’enregistreur du navigateur a signalé une erreur.'); };
      // Finalisation UNIQUE sur `stop`, quel qu'en soit le déclencheur (voir arretDemandeRef).
      arretDemandeRef.current = false;
      rec.onstop = () => { if (!finalisationRef.current) finalisationRef.current = finaliser(rec); };
      recRef.current = rec;
      rec.start(TIMESLICE_MS);
      debutRef.current = performance.now();
      setEtat('enregistrement');
      tickRef.current = window.setInterval(() => setDureeSec((performance.now() - debutRef.current) / 1000), 500);
    } catch (e) {
      const msg = (e as Error)?.name === 'AbortError' ? null : `Impossible de démarrer : ${(e as Error).message}`;
      setAvis(msg); setEtat('inactif');
      // Aucun fichier 0 octet laissé : l'entrée OPFS créée pour cet essai est retirée.
      await ecrivainRef.current?.abandonner(); await ecrivainRef.current?.supprimer(); opfsRef.current = null; nettoyer(); libererVerrou();
    }
  }, [capacite, etat, o, pousserEcriture, nettoyer, libererVerrou]);

  /**
   * Finalise l'enregistrement de `rec` : attend le dernier morceau, corrige la durée WebM, FERME le
   * fichier (c'est `close()` qui écrit réellement un fichier File System Access sur le disque — avant,
   * il pouvait rester à 0 octet), puis applique le verdict pur : 0 octet = erreur + fichier retiré.
   */
  async function finaliser(rec: MediaRecorder): Promise<void> {
    if (recRef.current !== rec && !demonteRef.current) return;
    const arretDemande = arretDemandeRef.current;
    if (!demonteRef.current) setEtat('finalisation');
    const dureeMs = Math.max(0, performance.now() - debutRef.current);
    await fileEcritureRef.current; // dernier morceau écrit
    const ecrivain = ecrivainRef.current;
    try {
      // Durée WebM : seuls les 8 octets réservés sont réécrits (même longueur, en place).
      if (ecrivain && webmRef.current.offset != null && tailleRef.current > 0) {
        await ecrivain.corriger(webmRef.current.offset, encoderDuree(dureeEnUnites(dureeMs, webmRef.current.timecodeScale)));
      }
      const fini = ecrivain ? await ecrivain.terminer() : { taille: tailleRef.current };
      const verdict = verdictFinalisation({ octets: fini.taille, arretDemande, dureeSec: dureeMs / 1000 });
      if (verdict.etat === 'erreur') {
        await ecrivain?.supprimer();
        opfsRef.current = null; libererVerrou();
        if (!demonteRef.current) { setAvis(verdict.message); setEtat('erreur'); setResultat(null); }
        return;
      }
      // Résolution AFFICHÉE = l'en-tête écrit (ce que ffprobe lit), secours = la piste (1re tranche, puis
      // finalisation), dernier recours = la valeur demandée (dite comme telle par `resolutionSource`).
      const res = resolutionEncodee(await enteteRef.current, [resolutionPisteRef.current, mesurerPiste(rec.stream)], resolutionEffectiveRef.current);
      const nom = opfsRef.current?.nom || nomFichier(new Date(), capacite.extension);
      const base = { nom, dureeSec: dureeMs / 1000, tailleOctets: fini.taille, resolution: libelleResolution(res), resolutionSource: res.source, format: capacite.codec };
      // Fichier FERMÉ (`terminer()` a abouti) et non vide (verdict) : seul cas où l'export est proposé.
      const fichierFerme = true;
      const peutExporter = () => exportAutorise({ etat: etatRef.current, fichierFerme, taille: fini.taille });
      let resultat: RecResultat;
      if (strategieRef.current === 'opfs') {
        const ref = opfsRef.current;
        resultat = { ...base, dejaEcrit: false, sauvegarderSurAppareil: async () => {
          if (!ref || !peutExporter()) return;
          const f: File = await ref.handle.getFile();
          const r = await exporterFichier(f, nom);
          if (r === 'annule') return; // le temporaire reste : nouvel essai possible
          // Le temporaire est retiré une fois la copie écrite / le téléchargement lancé (le blob est déjà lu).
          setTimeout(() => { ref.dossier.removeEntry(ref.nom).catch(() => { /* déjà retiré */ }); }, r === 'ecrit' ? 0 : 15_000);
        } };
      } else {
        const blob = fini.blob as Blob;
        resultat = { ...base, dejaEcrit: false, sauvegarderSurAppareil: async () => { if (peutExporter()) await exporterFichier(blob, nom); } };
      }
      if (!demonteRef.current) { setResultat(resultat); setEtat('pret'); setAvis(verdict.message); }
    } catch (e) {
      if (!demonteRef.current) { setAvis(`Finalisation impossible : ${(e as Error).message}`); setEtat('erreur'); }
      libererVerrou(); // le fichier reste : il sera proposé comme « interrompu » à la prochaine ouverture
    } finally { nettoyer(); finalisationRef.current = null; if (demonteRef.current) libererVerrou(); }
  }

  const arreter = useCallback(async () => {
    const rec = recRef.current; if (!rec) return;
    arretDemandeRef.current = true;
    setEtat('finalisation');
    if (rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* déjà arrêté */ }
    } else if (!finalisationRef.current) {
      // Le recorder s'était déjà arrêté seul et `stop` a été manqué : finaliser quand même.
      finalisationRef.current = finaliser(rec);
    }
    // `stop` → finaliser() ; on attend sa fin (contrat Promise<void> pour l'UI). Si `stop` ne vient
    // pas (navigateur muet), on finalise quand même après 10 s : le fichier est toujours fermé.
    const limite = performance.now() + 10_000;
    await new Promise<void>((resolve) => {
      const attendre = () => {
        const f = finalisationRef.current;
        if (f) { f.finally(resolve); return; }
        if (!recRef.current) { resolve(); return; }
        if (performance.now() > limite) { finalisationRef.current = finaliser(rec); finalisationRef.current.finally(resolve); return; }
        setTimeout(attendre, 50);
      };
      attendre();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repli 1080p → 720p si le compositeur ne suit pas (à chaud, même piste, même fichier).
  useEffect(() => {
    if (etat !== 'enregistrement' || typeof o.fpsProgramme !== 'number') return;
    if (o.arrierePlanProgramme) { repliRef.current = { sousSeuilDepuis: null, replie: repliRef.current.replie }; return; } // 1 i/s voulu en arrière-plan, pas une machine sollicitée
    const r = doitReplier720(repliRef.current, o.fpsProgramme, performance.now(), qualiteRef.current);
    repliRef.current = r;
    if (r.replier) {
      resolutionEffectiveRef.current = choisirResolution('720p');
      o.resolutionProgramme?.('720p');
      setAvis('Machine sollicitée : l’enregistrement continue en 720p.');
    }
  }, [o.fpsProgramme, o.arrierePlanProgramme, etat, o]);

  // Onglet masqué pendant l'enregistrement : l'interface dit la réalité mesurée (15 i/s), sans rien arrêter.
  useEffect(() => {
    if (etat !== 'enregistrement') return;
    if (o.arrierePlanProgramme) setAvis(AVIS_ARRIERE_PLAN);
    else setAvis((a) => (a === AVIS_ARRIERE_PLAN ? null : a));
  }, [o.arrierePlanProgramme, etat]);

  // Onglet fermé pendant un enregistrement : on prévient (FSA/OPFS gardent ce qui est écrit).
  useEffect(() => {
    if (etat !== 'enregistrement') return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [etat]);

  // Démontage pendant un enregistrement (page quittée, live terminé) : on STOPPE le recorder et on laisse
  //    `onstop` → finaliser() FERMER le fichier (dernier morceau + close()). Avant : `nettoyer()` jetait
  //    l'écrivain sans `close()` → le fichier File System Access restait à 0 octet sur le disque.
  useEffect(() => {
    demonteRef.current = false; // StrictMode (dev) rejoue monter/démonter/monter : on repart propre.
    return () => {
      demonteRef.current = true;
      const rec = recRef.current;
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* fini */ } }
      else if (rec && !finalisationRef.current) { finalisationRef.current = finaliser(rec); }
      else if (!rec) nettoyer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fermerResultat = useCallback(() => { setResultat(null); setEtat('inactif'); setDureeSec(0); setTailleOctets(0); libererVerrou(); }, [libererVerrou]);

  // DÉFAUT B — à l'ouverture (hôte seulement, avant tout enregistrement de cet onglet) : restes OPFS.
  useEffect(() => {
    if (!o.detecterInterrompus) return;
    let vivant = true;
    void enregistrementsInterrompus().then((r) => { if (vivant) setRestes(r); });
    return () => { vivant = false; };
  }, [o.detecterInterrompus]);

  const recupererReste = useCallback(async (r: ResteOpfs) => {
    const dossier = await dossierOpfs(); if (!dossier) return;
    const handle = await dossier.getFileHandle(r.source);
    const f: File = await handle.getFile();
    if (f.size <= 0) return;
    if ((await exporterFichier(f, r.nom)) === 'annule') return;
    setRestes((l) => l.filter((x) => x.source !== r.source));
    // Même règle que « Enregistrer sur mon appareil » : le temporaire est retiré une fois le téléchargement lancé.
    setTimeout(() => { dossier.removeEntry(r.source).catch(() => undefined); }, 15_000);
  }, []);

  const supprimerReste = useCallback(async (r: ResteOpfs) => {
    const dossier = await dossierOpfs();
    if (dossier) await dossier.removeEntry(r.source).catch(() => undefined);
    setRestes((l) => l.filter((x) => x.source !== r.source));
  }, []);

  return { etat, capacite, qualite, choisirQualite, dureeSec, tailleOctets, demarrer, arreter, resultat, avis, fermerResultat, restes, recupererReste, supprimerReste, autoStart, setAutoStart };
}

async function dossierOpfs(): Promise<any | null> {
  const nav: any = navigator;
  if (typeof nav.storage?.getDirectory !== 'function') return null;
  try { return await (await nav.storage.getDirectory()).getDirectoryHandle(OPFS_DOSSIER, { create: false }); } catch { return null; }
}

/**
 * DÉFAUT B — restes OPFS récupérables (voir `classerRestesOpfs` pour ce que Chrome laisse réellement).
 * Exclut les enregistrements EN COURS (verrou Web Locks tenu, cet onglet ou un autre) ; retire les
 * entrées vides (fichier jamais fermé après un rechargement : son .crswap a été jeté par Chrome).
 */
export async function enregistrementsInterrompus(): Promise<ResteOpfs[]> {
  const dossier = await dossierOpfs(); if (!dossier) return [];
  try {
    let verrouilles: string[] = [];
    try {
      const q = await (navigator as any).locks?.query?.();
      verrouilles = (q?.held || []).map((l: any) => String(l.name || '')).filter((n: string) => n.startsWith(VERROU_PREFIXE)).map((n: string) => n.slice(VERROU_PREFIXE.length));
    } catch { /* sans Web Locks : aucun verrou connu */ }
    const entrees: { nom: string; taille: number }[] = [];
    for await (const [nom, handle] of dossier.entries()) {
      if (handle.kind !== 'file') continue;
      try { entrees.push({ nom, taille: (await handle.getFile()).size }); } catch { /* illisible (verrouillé) : ignoré */ }
    }
    const { recuperables, aSupprimer } = classerRestesOpfs(entrees, verrouilles);
    for (const nom of aSupprimer) await dossier.removeEntry(nom).catch(() => undefined);
    return recuperables;
  } catch { return []; }
}

export { formaterTaille };
export default useProgramRecorder;
