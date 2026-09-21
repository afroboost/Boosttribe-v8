/**
 * ENREGISTREMENT LOCAL DU PROGRAMME (Phase 4).
 *
 * Source = EXACTEMENT `programStream` (vidéo composée par le compositeur + bus
 * audio programme) : ce que les participants voient et ce qu'un direct social
 * recevrait. Aucune 2ᵉ composition, aucun 2ᵉ mixeur, aucune 2ᵉ beauté ; le
 * prompteur et l'interface n'y sont pas par construction (Phase 3).
 *
 * RÈGLE ABSOLUE : la vidéo ne part JAMAIS vers un serveur. Trois destinations,
 * toutes locales, décidées par `recordLogic.detecterCapacite` :
 *  - `fsa`     : fichier choisi par l'hôte AVANT le démarrage, écrit au fil de l'eau ;
 *  - `opfs`    : fichier temporaire du navigateur écrit au fil de l'eau, téléchargé à l'arrêt ;
 *  - `memoire` : morceaux en RAM (durée limitée, avertissement).
 *
 * Chaque `dataavailable` (toutes les secondes) est écrit immédiatement : la
 * RAM ne grandit pas avec la durée en `fsa`/`opfs`. Un seul `MediaRecorder`
 * par enregistrement : les changements de scène ne touchent pas la piste
 * (le compositeur redessine dans le même canvas) → un seul fichier continu.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bitratePour, detecterCapacite, doitReplier720, estimerEspace, formaterTaille, minutesMaxMemoire,
  nomFichier, qualiteParDefaut, verdictFinalisation, type EnvEnregistrement, type EtatRepli, type RecCapacite, type RecQualite, type RecStrategie,
} from '@/lib/recordLogic';
import { dureeEnUnites, encoderDuree, preparerEnteteWebm } from '@/lib/webmDuree';
import { choisirResolution, type ResolutionProgramme } from '@/lib/programCompositor';

export type { RecQualite, RecStrategie, RecCapacite } from '@/lib/recordLogic';
export type RecEtat = 'inactif' | 'preparation' | 'enregistrement' | 'finalisation' | 'pret' | 'erreur';

export interface RecResultat {
  nom: string;
  dureeSec: number;
  tailleOctets: number;
  resolution: string;
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
}

export interface UseProgramRecorderOptions {
  programStream: MediaStream | null;
  demarrerProgramme: () => Promise<MediaStream | null>;
  resolutionProgramme?: (q: RecQualite) => void;
  /** i/s courants du compositeur (pour le repli 720p) — optionnel. */
  fpsProgramme?: number;
}

const OPFS_DOSSIER = 'afroboost-enregistrements';
const TIMESLICE_MS = 1000;

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

/** Écrivain abstrait : même interface pour FSA, OPFS et mémoire. */
interface Ecrivain {
  ecrire(chunk: Blob): Promise<void>;
  /** Réécrit `octets` à une position absolue (correction de durée WebM). */
  corriger(position: number, octets: Uint8Array): Promise<void>;
  terminer(): Promise<{ taille: number; fichier?: File; blob?: Blob }>;
  abandonner(): Promise<void>;
  /** Retire le fichier (après `terminer()`), pour ne jamais laisser un fichier VIDE sur l'appareil. */
  supprimer(): Promise<void>;
}

async function ecrivainFsa(handle: any): Promise<Ecrivain> {
  const w = await handle.createWritable({ keepExistingData: false });
  let pos = 0;
  return {
    async ecrire(chunk) { await w.write(chunk); pos += chunk.size; },
    async corriger(position, octets) { await w.write({ type: 'write', position, data: octets }); },
    async terminer() { await w.close(); const f = await handle.getFile(); return { taille: f.size, fichier: f }; },
    async abandonner() { try { await w.abort(); } catch { /* déjà fermé */ } },
    // FileSystemFileHandle.remove() : Chrome ≥ 110 ; ailleurs le fichier vide reste, mais l'hôte est prévenu.
    async supprimer() { try { if (typeof handle.remove === 'function') await handle.remove(); } catch { /* verrouillé : on laisse */ } },
  };
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

function telecharger(blobOuFichier: Blob, nom: string): void {
  const url = URL.createObjectURL(blobOuFichier);
  const a = document.createElement('a');
  a.href = url; a.download = nom; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 10_000);
}

export function useProgramRecorder(o: UseProgramRecorderOptions): UseProgramRecorderReturn {
  const capacite = useMemo(() => detecterCapacite(lireEnvironnement()), []);
  const [qualite, setQualite] = useState<RecQualite>(() => qualiteParDefaut(capacite));
  const [etat, setEtat] = useState<RecEtat>('inactif');
  const [dureeSec, setDureeSec] = useState(0);
  const [tailleOctets, setTailleOctets] = useState(0);
  const [resultat, setResultat] = useState<RecResultat | null>(null);
  const [avis, setAvis] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const ecrivainRef = useRef<Ecrivain | null>(null);
  const opfsRef = useRef<{ handle: any; dossier: any; nom: string } | null>(null);
  const fsaNomRef = useRef<string | null>(null);
  // QA Phase 4 : la stratégie EFFECTIVE de l'enregistrement en cours. `capacite.strategie` dit ce que le
  // navigateur SAIT faire ; mais `showSaveFilePicker` peut être refusé au moment du geste (iframe sans
  // délégation — afroboost.com/live embarque BoostTribe —, contexte sans geste utilisateur, politique
  // d'entreprise). Avant : l'appel échouait, `setEtat('inactif')`, et l'hôte ne voyait RIEN. Désormais :
  // toute erreur autre qu'une annulation replie sur l'OPFS (fichier temporaire + « Enregistrer sur mon
  // appareil ») ; une annulation volontaire est dite en une ligne.
  const strategieRef = useRef<RecStrategie>(capacite.strategie);
  const debutRef = useRef<number>(0);
  const tailleRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const fileEcritureRef = useRef<Promise<void>>(Promise.resolve());
  const webmRef = useRef<{ offset: number | null; timecodeScale: number; premier: boolean }>({ offset: null, timecodeScale: 1_000_000, premier: true });
  const repliRef = useRef<EtatRepli>({ sousSeuilDepuis: null, replie: false });
  const qualiteRef = useRef<RecQualite>(qualite); qualiteRef.current = qualite;
  const resolutionEffectiveRef = useRef<ResolutionProgramme>(choisirResolution(qualite));
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
      // 1. Destination — AVANT la première image, pour que rien ne soit perdu.
      strategieRef.current = capacite.strategie;
      if (capacite.strategie === 'fsa') {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: nom,
            types: [{ description: capacite.extension === 'mp4' ? 'Vidéo MP4' : 'Vidéo WebM', accept: { [capacite.extension === 'mp4' ? 'video/mp4' : 'video/webm']: [`.${capacite.extension}`] } }],
          });
          ecrivainRef.current = await ecrivainFsa(handle);
          fsaNomRef.current = handle.name || nom;
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') {
            // Annulation volontaire du sélecteur : on le dit, on ne devine rien.
            setAvis('Enregistrement annulé : aucun emplacement choisi.'); setEtat('inactif'); nettoyer(); return;
          }
          const opfsPossible = typeof (navigator as any).storage?.getDirectory === 'function';
          if (!opfsPossible) throw e;
          // Sélecteur refusé (iframe, sans geste, politique) → écriture progressive OPFS à la place.
          strategieRef.current = 'opfs';
          const { ecrivain, handle, dossier } = await ecrivainOpfs(nom);
          ecrivainRef.current = ecrivain; opfsRef.current = { handle, dossier, nom };
          setAvis('Le choix du dossier n’est pas disponible ici : le fichier sera proposé au téléchargement à l’arrêt.');
        }
      } else if (capacite.strategie === 'opfs') {
        const { ecrivain, handle, dossier } = await ecrivainOpfs(nom);
        ecrivainRef.current = ecrivain; opfsRef.current = { handle, dossier, nom };
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
      const rec = new MediaRecorder(stream, { mimeType: capacite.mime, videoBitsPerSecond: debit.video, audioBitsPerSecond: debit.audio });
      rec.ondataavailable = (ev: BlobEvent) => { if (ev.data && ev.data.size > 0) pousserEcriture(ev.data); };
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
      await ecrivainRef.current?.abandonner(); nettoyer();
    }
  }, [capacite, etat, o, pousserEcriture, nettoyer]);

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
        opfsRef.current = null;
        if (!demonteRef.current) { setAvis(verdict.message); setEtat('erreur'); setResultat(null); }
        return;
      }
      const res = resolutionEffectiveRef.current;
      const nom = fsaNomRef.current || opfsRef.current?.nom || nomFichier(new Date(), capacite.extension);
      const base = { nom, dureeSec: dureeMs / 1000, tailleOctets: fini.taille, resolution: `${res.largeur}×${res.hauteur}`, format: capacite.codec };
      let resultat: RecResultat;
      if (strategieRef.current === 'fsa') {
        resultat = { ...base, dejaEcrit: true, emplacement: nom, sauvegarderSurAppareil: async () => { /* déjà sur le disque */ } };
      } else if (strategieRef.current === 'opfs') {
        const ref = opfsRef.current;
        resultat = { ...base, dejaEcrit: false, sauvegarderSurAppareil: async () => {
          if (!ref) return;
          const f: File = await ref.handle.getFile();
          telecharger(f, nom);
          // Le temporaire est retiré une fois le téléchargement lancé (le blob est déjà lu par le navigateur).
          setTimeout(() => { ref.dossier.removeEntry(ref.nom).catch(() => { /* déjà retiré */ }); }, 15_000);
        } };
      } else {
        const blob = fini.blob as Blob;
        resultat = { ...base, dejaEcrit: false, sauvegarderSurAppareil: async () => { telecharger(blob, nom); } };
      }
      if (!demonteRef.current) { setResultat(resultat); setEtat('pret'); setAvis(verdict.message); }
    } catch (e) {
      if (!demonteRef.current) { setAvis(`Finalisation impossible : ${(e as Error).message}`); setEtat('erreur'); }
    } finally { nettoyer(); finalisationRef.current = null; }
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
    const r = doitReplier720(repliRef.current, o.fpsProgramme, performance.now(), qualiteRef.current);
    repliRef.current = r;
    if (r.replier) {
      resolutionEffectiveRef.current = choisirResolution('720p');
      o.resolutionProgramme?.('720p');
      setAvis('Machine sollicitée : l’enregistrement continue en 720p.');
    }
  }, [o.fpsProgramme, etat, o]);

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

  const fermerResultat = useCallback(() => { setResultat(null); setEtat('inactif'); setDureeSec(0); setTailleOctets(0); }, []);

  return { etat, capacite, qualite, choisirQualite, dureeSec, tailleOctets, demarrer, arreter, resultat, avis, fermerResultat };
}

/** Reprise après crash (OPFS) : liste les temporaires laissés par une session interrompue. */
export async function enregistrementsInterrompus(): Promise<{ nom: string; taille: number; recuperer: () => Promise<void>; oublier: () => Promise<void> }[]> {
  const nav: any = navigator;
  if (typeof nav.storage?.getDirectory !== 'function') return [];
  try {
    const root = await nav.storage.getDirectory();
    const dossier = await root.getDirectoryHandle(OPFS_DOSSIER, { create: false });
    const out: { nom: string; taille: number; recuperer: () => Promise<void>; oublier: () => Promise<void> }[] = [];
    for await (const [nom, handle] of dossier.entries()) {
      if (handle.kind !== 'file') continue;
      const f: File = await handle.getFile();
      if (f.size === 0) { await dossier.removeEntry(nom).catch(() => undefined); continue; }
      out.push({ nom, taille: f.size,
        recuperer: async () => { telecharger(await handle.getFile(), nom); },
        oublier: async () => { await dossier.removeEntry(nom); } });
    }
    return out;
  } catch { return []; }
}

export { formaterTaille };
export default useProgramRecorder;
