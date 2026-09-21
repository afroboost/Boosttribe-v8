/**
 * 🎬 Phase 3 minimale — COMPOSITEUR DU PROGRAMME (canvas 2D).
 *
 * Il peint les boîtes `layoutBoxes(program)` (normalisées 0..1, ordre z) avec les médias
 * rendus par `resolveMedia(source)` — ceux de l'EXISTANT : coach = `localStream` de
 * useLiveKitStage (déjà la piste traitée par « Embellir » quand l'option est active — aucun
 * second pipeline beauté), coach2 = caméra secondaire, participant = piste LiveKit distante,
 * écran = `localScreen`. `canvas.captureStream(30)` en fait la PISTE VIDÉO DU PROGRAMME.
 *
 * Ce qu'il ne fait JAMAIS : prompteur, chat, timer, overlay, logo. Le prompteur est un overlay
 * DOM local au coach ; rien de ce qui est peint ici ne vient du DOM de la page.
 *
 * `program === null` → `arreter()` : aucun compositing, comportement d'avant inchangé.
 *
 * Partie PURE (testable sans DOM) : `calculerRectangles` (boîtes → rectangles de dessin,
 * découpe « cover » par boîte) et `choisirResolution` (plafond + dégradation).
 */
import type { SceneBox, StudioSourceRef } from '@/lib/studioScenes';

export type ResolveMedia = (src: StudioSourceRef) => MediaStream | MediaStreamTrack | null;

export interface ResolutionProgramme { largeur: number; hauteur: number }
export const RESOLUTION_720P: ResolutionProgramme = { largeur: 1280, hauteur: 720 };
export const RESOLUTION_1080P: ResolutionProgramme = { largeur: 1920, hauteur: 1080 };
export const RESOLUTION_540P: ResolutionProgramme = { largeur: 960, hauteur: 540 };
export const FPS_PROGRAMME = 30;

/** Rectangle de dessin : découpe dans la source (sx, sy, sw, sh) → destination (dx, dy, dw, dh). */
export interface RectangleDessin {
  source: StudioSourceRef;
  z: number;
  dx: number; dy: number; dw: number; dh: number;
  sx: number; sy: number; sw: number; sh: number;
}

/**
 * PUR : boîte normalisée + dimensions réelles de la source → rectangle « cover » (la source
 * remplit la boîte sans déformation, l'excédent est rogné au centre). Trié par z croissant.
 */
export function calculerRectangles(
  boxes: SceneBox[],
  res: ResolutionProgramme,
  dims: (src: StudioSourceRef) => { largeur: number; hauteur: number } | null,
): RectangleDessin[] {
  const out: RectangleDessin[] = [];
  for (const b of [...boxes].sort((a, c) => a.z - c.z)) {
    const d = dims(b.source);
    if (!d || d.largeur <= 0 || d.hauteur <= 0) continue;
    const dx = Math.round(b.x * res.largeur);
    const dy = Math.round(b.y * res.hauteur);
    const dw = Math.round(b.w * res.largeur);
    const dh = Math.round(b.h * res.hauteur);
    if (dw <= 0 || dh <= 0) continue;
    const ratioBoite = dw / dh;
    const ratioSource = d.largeur / d.hauteur;
    let sw = d.largeur; let sh = d.hauteur; let sx = 0; let sy = 0;
    if (ratioSource > ratioBoite) { sw = Math.round(d.hauteur * ratioBoite); sx = Math.round((d.largeur - sw) / 2); }
    else if (ratioSource < ratioBoite) { sh = Math.round(d.largeur / ratioBoite); sy = Math.round((d.hauteur - sh) / 2); }
    out.push({ source: b.source, z: b.z, dx, dy, dw, dh, sx, sy, sw, sh });
  }
  return out;
}

/** PUR : garde de performance — sous 15 i/s pendant 3 s on descend d'un cran ; sous 12 i/s à 540p on abandonne. */
export type VerdictPerf = 'ok' | 'degrader' | 'abandonner';
export function verdictPerformance(fps: number, dureeSousSeuilMs: number, res: ResolutionProgramme): VerdictPerf {
  if (dureeSousSeuilMs < 3000) return 'ok';
  if (res.hauteur > RESOLUTION_540P.hauteur && fps < 15) return 'degrader';
  if (res.hauteur <= RESOLUTION_540P.hauteur && fps < 12) return 'abandonner';
  return 'ok';
}

/**
 * ARRIÈRE-PLAN (mesuré 21/09, vrai Chrome 153, onglet masqué) :
 *  - rAF ne revient JAMAIS (0/s) ; `setTimeout` du fil principal est bridé à 1 réveil/s ; un minuteur
 *    dans un Worker garde sa cadence (76 ticks / 5 s) ; MediaRecorder et l'audio continuent.
 *  - MAIS Chrome n'avance l'horloge de capture du canvas qu'UNE fois par seconde : 15 dessins/s
 *    donnaient 14 doublons d'horodatage par seconde, et un fichier DÉMARRÉ masqué était refusé par
 *    QuickTime. À 1 dessin/s, les horodatages sont distincts et monotones, le fichier s'ouvre.
 *  Donc : en arrière-plan, la composition est cadencée par un Worker à 1 i/s (la seule cadence que
 *  Chrome horodate), et la garde de performance ne juge PAS (son compteur d'images dirait « 0 i/s »
 *  et abandonnerait — c'est ce qui coupait l'enregistrement à 16 s). Au retour visible : mesures
 *  remises à zéro, sursis d'une seconde de mesures propres, puis la garde reprend.
 */
export const FPS_ARRIERE_PLAN = 1;
export const SURSIS_RETOUR_MS = 1000;
/** PUR : la garde de performance ne juge que si l'onglet est visible ET que le sursis du retour est écoulé. */
export function gardePeutJuger(arrierePlan: boolean, gardeReprendA: number, maintenant: number): boolean {
  return !arrierePlan && maintenant >= gardeReprendA;
}
/** PUR : le pas de dessin (ms) selon la cadence en vigueur. */
export function pasDessinMs(arrierePlan: boolean, fpsVisible: number): number {
  return 1000 / (arrierePlan ? FPS_ARRIERE_PLAN : fpsVisible);
}

export function choisirResolution(demandee: '720p' | '1080p' | '540p'): ResolutionProgramme {
  return demandee === '1080p' ? RESOLUTION_1080P : demandee === '540p' ? RESOLUTION_540P : RESOLUTION_720P;
}

export interface StatsCompositeur { fps: number; msParFrame: number; resolution: ResolutionProgramme; frames: number; /** true = onglet masqué, cadence Worker 15 i/s, garde suspendue */ arrierePlan: boolean }

export interface OptionsCompositeur {
  resolution?: ResolutionProgramme;
  fps?: number;
  /** Appelé quand la garde de performance abandonne (l'appelant repasse au flux caméra). */
  onAbandon?: (raison: string) => void;
  onStats?: (s: StatsCompositeur) => void;
}

const cle = (s: StudioSourceRef) => `${s.kind}:${s.id ?? ''}`;

/**
 * Le compositeur DOM : un canvas hors écran + une `<video muted playsInline autoplay>` par source.
 * Boucle : rAF plafonnée à `fps`. Les éléments vidéo ne sont jamais ajoutés au document.
 */
export class ProgramCompositor {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private videos = new Map<string, HTMLVideoElement>();
  private boxes: SceneBox[] = [];
  private resolve: ResolveMedia = () => null;
  private raf = 0;
  private minuteur: ReturnType<typeof setTimeout> | null = null;
  private dernierDessin = 0;
  private frames = 0;
  private fenetreDebut = 0;
  private fenetreFrames = 0;
  private sousSeuilDepuis = 0;
  private stream: MediaStream | null = null;
  private res: ResolutionProgramme;
  private readonly fps: number;
  private readonly opts: OptionsCompositeur;
  private msParFrame = 0;
  private actif = false;
  private arrierePlan = false;
  private gardeReprendA = 0;
  private worker: Worker | null = null;
  private readonly onVisibilite = (): void => { this.basculerCadence(); };

  constructor(opts: OptionsCompositeur = {}) {
    this.opts = opts;
    this.res = opts.resolution ?? RESOLUTION_720P;
    this.fps = opts.fps ?? FPS_PROGRAMME;
  }

  get estActif(): boolean { return this.actif; }
  get pisteVideo(): MediaStreamTrack | null { return this.stream?.getVideoTracks()[0] ?? null; }
  get statistiques(): StatsCompositeur {
    return { fps: this.fpsCourant(), msParFrame: this.msParFrame, resolution: this.res, frames: this.frames, arrierePlan: this.arrierePlan };
  }

  /** Nouvelle scène (boîtes) et/ou nouveaux médias. Sans arrêter la piste : la sortie reste continue. */
  /** Phase 4 : changer la résolution À CHAUD (canvas redimensionné, piste `captureStream` conservée → un seul fichier continu). */
  changerResolution(res: ResolutionProgramme): void {
    this.res = res; this.sousSeuilDepuis = 0;
    if (this.canvas) { this.canvas.width = res.largeur; this.canvas.height = res.hauteur; }
  }

  mettreAJour(boxes: SceneBox[], resolve: ResolveMedia): void {
    this.boxes = boxes;
    this.resolve = resolve;
    if (this.actif) this.synchroniserVideos();
  }

  demarrer(): MediaStream | null {
    if (this.actif) return this.stream;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = this.res.largeur; canvas.height = this.res.hauteur;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx || typeof (canvas as HTMLCanvasElement & { captureStream?: unknown }).captureStream !== 'function') return null;
    this.canvas = canvas; this.ctx = ctx;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.stream = canvas.captureStream(this.fps);
    this.actif = true;
    this.frames = 0; this.fenetreDebut = performance.now(); this.fenetreFrames = 0; this.sousSeuilDepuis = 0;
    this.gardeReprendA = 0; this.arrierePlan = false;
    this.synchroniserVideos();
    document.addEventListener('visibilitychange', this.onVisibilite);
    this.basculerCadence(); // démarre la boucle selon la visibilité ACTUELLE (un démarrage onglet masqué est possible)
    return this.stream;
  }

  arreter(): void {
    this.actif = false;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilite);
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.arreterCadenceArrierePlan();
    for (const v of this.videos.values()) { try { v.pause(); v.srcObject = null; } catch { /* ignore */ } }
    this.videos.clear();
    // La piste de sortie s'arrête : l'appelant ne doit plus la publier.
    this.stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    this.stream = null; this.canvas = null; this.ctx = null;
  }

  private fpsCourant(): number {
    const dt = performance.now() - this.fenetreDebut;
    return dt > 0 ? (this.fenetreFrames * 1000) / dt : 0;
  }

  /** Une <video> par source présente dans les boîtes ; celles disparues sont libérées. */
  private synchroniserVideos(): void {
    const voulues = new Set(this.boxes.map((b) => cle(b.source)));
    for (const [k, v] of this.videos) if (!voulues.has(k)) { try { v.pause(); v.srcObject = null; } catch { /* ignore */ } this.videos.delete(k); }
    for (const b of this.boxes) {
      const k = cle(b.source);
      const media = this.resolve(b.source);
      const flux = media instanceof MediaStream ? media : media ? new MediaStream([media]) : null;
      let v = this.videos.get(k);
      if (!v) {
        v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.autoplay = true;
        this.videos.set(k, v);
      }
      if (flux && v.srcObject !== flux) { v.srcObject = flux; v.play().catch(() => { /* geste requis : la boucle réessaie */ }); }
      if (!flux && v.srcObject) v.srcObject = null;
    }
  }

  /** Un pas de composition : dessine si le pas de la cadence en vigueur est écoulé. */
  private tick(): void {
    if (!this.actif) return;
    const pas = pasDessinMs(this.arrierePlan, this.fps);
    const maintenant = performance.now();
    if (maintenant - this.dernierDessin >= pas - 1) {
      const t0 = maintenant;
      this.dessiner();
      this.dernierDessin = maintenant;
      this.msParFrame = performance.now() - t0;
      this.frames += 1; this.fenetreFrames += 1;
      this.garde(maintenant);
    }
  }

  /** Boucle VISIBLE : rAF plafonnée à `fps`. En arrière-plan elle n'est pas armée (rAF ne reviendrait jamais). */
  private boucle = (): void => {
    if (!this.actif || this.arrierePlan) return;
    this.tick();
    if (this.actif && !this.arrierePlan) this.raf = requestAnimationFrame(this.boucle);
  };

  /** Choisit la cadence d'après la visibilité RÉELLE de l'onglet ; appelé au démarrage et à chaque `visibilitychange`. */
  private basculerCadence(): void {
    if (!this.actif) return;
    const cache = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const dejaCadence = this.raf !== 0 || this.worker !== null || this.minuteur !== null;
    if (cache === this.arrierePlan && dejaCadence) return;
    const retour = this.arrierePlan && !cache;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.arreterCadenceArrierePlan();
    this.arrierePlan = cache;
    // Les mesures accumulées sous l'autre cadence ne valent rien : on repart propre.
    this.fenetreDebut = performance.now(); this.fenetreFrames = 0; this.sousSeuilDepuis = 0;
    if (retour) this.gardeReprendA = performance.now() + SURSIS_RETOUR_MS;
    if (cache) this.demarrerCadenceArrierePlan(); else this.raf = requestAnimationFrame(this.boucle);
    this.opts.onStats?.(this.statistiques);
  }

  /** Cadence ARRIÈRE-PLAN : minuteur dans un Worker (non bridé par l'onglet masqué), repli minuteur principal (~1/s) si Worker impossible. */
  private demarrerCadenceArrierePlan(): void {
    const pas = Math.round(1000 / FPS_ARRIERE_PLAN);
    try {
      const src = `(function tour() { postMessage(0); setTimeout(tour, ${pas}); })();`;
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = () => { if (this.actif && this.arrierePlan) this.tick(); };
      this.worker = w;
    } catch {
      const tour = (): void => { if (!this.actif || !this.arrierePlan) { this.minuteur = null; return; } this.tick(); this.minuteur = setTimeout(tour, pas); };
      this.minuteur = setTimeout(tour, pas);
    }
  }

  private arreterCadenceArrierePlan(): void {
    if (this.worker) { try { this.worker.terminate(); } catch { /* ignore */ } this.worker = null; }
    if (this.minuteur) { clearTimeout(this.minuteur); this.minuteur = null; }
  }

  private garde(maintenant: number): void {
    const dt = maintenant - this.fenetreDebut;
    if (dt < 1000) return;
    const fps = this.fpsCourant();
    if (!gardePeutJuger(this.arrierePlan, this.gardeReprendA, maintenant)) {
      // Onglet masqué (ou sursis du retour) : on publie la cadence RÉELLE, mais on ne juge pas.
      this.sousSeuilDepuis = 0;
      this.opts.onStats?.(this.statistiques);
      this.fenetreDebut = maintenant; this.fenetreFrames = 0;
      return;
    }
    const seuil = this.res.hauteur > RESOLUTION_540P.hauteur ? 15 : 12;
    if (fps < seuil) { if (!this.sousSeuilDepuis) this.sousSeuilDepuis = maintenant; }
    else this.sousSeuilDepuis = 0;
    const verdict = verdictPerformance(fps, this.sousSeuilDepuis ? maintenant - this.sousSeuilDepuis : 0, this.res);
    if (verdict === 'degrader' && this.canvas) {
      this.res = RESOLUTION_540P; this.canvas.width = this.res.largeur; this.canvas.height = this.res.hauteur; this.sousSeuilDepuis = 0;
    } else if (verdict === 'abandonner') {
      const raison = `programme abandonné : ${fps.toFixed(0)} i/s`;
      this.arreter();
      this.opts.onAbandon?.(raison);
      return;
    }
    this.opts.onStats?.(this.statistiques);
    this.fenetreDebut = maintenant; this.fenetreFrames = 0;
  }

  private dessiner(): void {
    const ctx = this.ctx; const canvas = this.canvas;
    if (!ctx || !canvas) return;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rects = calculerRectangles(this.boxes, this.res, (src) => {
      const v = this.videos.get(cle(src));
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      return { largeur: v.videoWidth, hauteur: v.videoHeight };
    });
    for (const r of rects) {
      const v = this.videos.get(cle(r.source));
      if (!v) continue;
      if (v.paused) v.play().catch(() => { /* ignore */ });
      try { ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh); } catch { /* frame indisponible */ }
    }
  }
}
