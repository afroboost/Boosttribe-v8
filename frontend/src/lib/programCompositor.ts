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

export function choisirResolution(demandee: '720p' | '1080p' | '540p'): ResolutionProgramme {
  return demandee === '1080p' ? RESOLUTION_1080P : demandee === '540p' ? RESOLUTION_540P : RESOLUTION_720P;
}

export interface StatsCompositeur { fps: number; msParFrame: number; resolution: ResolutionProgramme; frames: number }

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

  constructor(opts: OptionsCompositeur = {}) {
    this.opts = opts;
    this.res = opts.resolution ?? RESOLUTION_720P;
    this.fps = opts.fps ?? FPS_PROGRAMME;
  }

  get estActif(): boolean { return this.actif; }
  get pisteVideo(): MediaStreamTrack | null { return this.stream?.getVideoTracks()[0] ?? null; }
  get statistiques(): StatsCompositeur {
    return { fps: this.fpsCourant(), msParFrame: this.msParFrame, resolution: this.res, frames: this.frames };
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
    this.synchroniserVideos();
    this.boucle();
    return this.stream;
  }

  arreter(): void {
    this.actif = false;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (this.minuteur) { clearTimeout(this.minuteur); this.minuteur = null; }
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

  private boucle = (): void => {
    if (!this.actif) return;
    const pas = 1000 / this.fps;
    const maintenant = performance.now();
    if (maintenant - this.dernierDessin >= pas - 1) {
      const t0 = maintenant;
      this.dessiner();
      this.dernierDessin = maintenant;
      this.msParFrame = performance.now() - t0;
      this.frames += 1; this.fenetreFrames += 1;
      this.garde(maintenant);
    }
    // rAF quand l'onglet est visible ; minuteur sinon (rAF gèle en arrière-plan).
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.minuteur = setTimeout(this.boucle, pas);
    } else {
      this.raf = requestAnimationFrame(this.boucle);
    }
  };

  private garde(maintenant: number): void {
    const dt = maintenant - this.fenetreDebut;
    if (dt < 1000) return;
    const fps = this.fpsCourant();
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
