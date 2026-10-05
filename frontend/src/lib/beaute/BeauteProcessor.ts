/**
 * ✨ EMBELLIR LE VISAGE — le processeur de piste LiveKit.
 *
 * Pourquoi un `TrackProcessor` et pas un remplacement de piste « à la main » : LiveKit sait déjà
 * le faire. `LocalVideoTrack.setProcessor(p)` publie `p.processedTrack` aux participants,
 * `mediaStreamTrack` renvoie la piste traitée (l'aperçu local suit), et `restartTrack` — appelé
 * par `switchActiveDevice` (bascule avant/arrière, caméra externe) — rappelle `p.restart(...)`
 * avec la nouvelle source : la beauté SURVIT au changement de caméra sans code supplémentaire.
 * `stopProcessor()` republie la piste brute sans coupure. Rien d'autre du live n'est touché
 * (audio PeerJS, partage d'écran, prompteur).
 *
 * Chaîne : piste caméra → <video> hors écran → rendu WebGL (rendu.ts) → canvas.captureStream()
 * → processedTrack. Cadence : `requestVideoFrameCallback` quand il existe (une image traitée
 * par image décodée, Chrome/Safari 15.4+), sinon requestAnimationFrame ; onglet caché → minuteur
 * à 15 images/s pour que les participants ne voient pas une image figée.
 *
 * Garde de performance (beauteLogic) : < 20 fps pendant 3 s → `onCoupure()` — le hook coupe
 * alors la beauté et prévient discrètement. Résolution de traitement plafonnée à 720 px.
 */
import type { Track } from 'livekit-client';
import type { TrackProcessor, VideoProcessorOptions } from 'livekit-client';
import {
  GardePerformance, parametresBeaute, resolutionTraitement, coteMaxTraitement, palierSuivant,
  MASQUE_ALPHA_TEMPOREL, type NiveauBeaute,
} from '@/lib/beauteLogic';
import { estMobile } from '@/lib/sourcesLogic';
import { creerRenduBeaute, type RenduBeaute } from './rendu';

export interface BeauteProcessorCallbacks {
  /** Le débit est resté trop bas : l'appelant doit désactiver la beauté. */
  onCoupure?: () => void;
  /** Mesure périodique (≈ 1/s) : fps traité et temps moyen par image (ms). */
  onMesure?: (fps: number, msParImage: number) => void;
}

type MetaImage = { presentedFrames?: number; mediaTime?: number };
type VideoAvecRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (maintenant: number, meta?: MetaImage) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export class BeauteProcessor implements TrackProcessor<Track.Kind.Video, VideoProcessorOptions> {
  readonly name = 'beaute-visage';
  processedTrack?: MediaStreamTrack;

  private video: VideoAvecRVFC | null = null;
  private rendu: RenduBeaute | null = null;
  private flux: MediaStream | null = null;
  private garde = new GardePerformance();
  private actif = false;
  private rvfcId = 0;
  private rafId = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private niveau: NiveauBeaute;
  private cumulMs = 0;
  private nbImages = 0;
  private derniereMesure = 0;
  // 🎥 Phase caméra 2 : pleine résolution sur ordinateur (jusqu'à 4K), 720 sur téléphone ;
  //    paliers 3840 → 1920 → 1280 si le traitement prend du retard, AVANT toute coupure.
  private coteMax = coteMaxTraitement({ mobile: typeof navigator !== 'undefined' && estMobile(navigator.userAgent, navigator.maxTouchPoints) });
  private derniereImage = -1;            // presentedFrames déjà traité (jamais deux fois la même image)
  private sourceMs: number[] = [];       // horodatages média des images de la caméra → cadence réelle

  constructor(niveau: NiveauBeaute, private readonly cb: BeauteProcessorCallbacks = {}) {
    this.niveau = niveau;
  }

  /** Cadence RÉELLE de la caméra sur la dernière seconde (0 si inconnue). */
  private fpsSource(): number {
    const n = this.sourceMs.length;
    if (n < 2) return 0;
    const duree = this.sourceMs[n - 1] - this.sourceMs[0];
    return duree > 0 ? ((n - 1) * 1000) / duree : 0;
  }

  /** Change l'intensité à chaud (sans republier). */
  setNiveau(niveau: NiveauBeaute): void {
    this.niveau = niveau;
    this.rendu?.setParametres(parametresBeaute(niveau));
  }

  async init(opts: VideoProcessorOptions): Promise<void> {
    await this.brancherSource(opts.track);
    const { largeur, hauteur } = this.tailleSource();
    this.rendu = creerRenduBeaute(largeur, hauteur, parametresBeaute(this.niveau), MASQUE_ALPHA_TEMPOREL);
    // Sans argument : une image capturée à chaque dessin (cadence = celle de la source).
    const captureStream = (this.rendu.canvas as HTMLCanvasElement & { captureStream: () => MediaStream }).captureStream;
    const sortie = captureStream.call(this.rendu.canvas) as MediaStream;
    this.processedTrack = sortie.getVideoTracks()[0];
    this.garde.reinitialiser();
    this.actif = true;
    this.demarrerBoucle();
  }

  /** Nouvelle source (bascule de caméra) : même canvas, même piste publiée. */
  async restart(opts: VideoProcessorOptions): Promise<void> {
    await this.brancherSource(opts.track);
    const { largeur, hauteur } = this.tailleSource();
    this.rendu?.redimensionner(largeur, hauteur);
    this.garde.reinitialiser();
    if (!this.actif) { this.actif = true; this.demarrerBoucle(); }
  }

  async destroy(): Promise<void> {
    this.actif = false;
    this.arreterBoucle();
    try { this.processedTrack?.stop(); } catch { /* ignore */ }
    this.processedTrack = undefined;
    this.rendu?.detruire();
    this.rendu = null;
    if (this.video) {
      try { this.video.pause(); } catch { /* ignore */ }
      this.video.srcObject = null;
      this.video = null;
    }
    this.flux = null;
  }

  // ── interne ─────────────────────────────────────────────────────────────

  private async brancherSource(track: MediaStreamTrack): Promise<void> {
    if (!this.video) {
      const v = document.createElement('video') as VideoAvecRVFC;
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      // Jamais dans le DOM : ni visible, ni audible ; seul le canvas est publié.
      this.video = v;
    }
    this.flux = new MediaStream([track]);
    this.video.srcObject = this.flux;
    await new Promise<void>((resolve) => {
      const v = this.video!;
      if (v.readyState >= 1 && v.videoWidth) { resolve(); return; }
      const fini = () => { v.removeEventListener('loadedmetadata', fini); resolve(); };
      v.addEventListener('loadedmetadata', fini);
      setTimeout(fini, 1500); // garde-fou : on ne bloque jamais la publication
    });
    try { await this.video.play(); } catch { /* autoplay bloqué : le décodage suit quand même sur muted */ }
  }

  private tailleSource(): { largeur: number; hauteur: number } {
    const v = this.video;
    const reglages = (this.flux?.getVideoTracks()[0]?.getSettings?.() ?? {}) as MediaTrackSettings;
    const w = v?.videoWidth || reglages.width || 640;
    const h = v?.videoHeight || reglages.height || 480;
    return resolutionTraitement(w, h, this.coteMax);
  }

  private demarrerBoucle(): void {
    this.arreterBoucle();
    const tick = (_maintenant?: number, meta?: MetaImage) => {
      if (!this.actif || !this.video || !this.rendu) return;
      const t0 = performance.now();
      // Une image déjà traitée n'est jamais retraitée (rVFC peut rappeler pour la même image).
      if (meta && typeof meta.presentedFrames === 'number') {
        if (meta.presentedFrames === this.derniereImage) { this.planifier(tick); return; }
        this.derniereImage = meta.presentedFrames;
        if (typeof meta.mediaTime === 'number') {
          this.sourceMs.push(meta.mediaTime * 1000);
          this.sourceMs = this.sourceMs.filter((x) => x >= meta.mediaTime! * 1000 - 1000);
        }
      }
      if (this.video.readyState >= 2) {
        // La source a changé de taille (bascule avant/arrière) : suivre.
        const { largeur, hauteur } = this.tailleSource();
        this.rendu.redimensionner(largeur, hauteur);
        this.rendu.dessiner(this.video);
      }
      const t1 = performance.now();
      this.cumulMs += t1 - t0; this.nbImages += 1;
      if (this.garde.enregistrer(t1, this.fpsSource())) {
        // Traitement en retard : palier inférieur (3840 → 1920 → 1280) avant de couper.
        const palier = palierSuivant(this.coteMax);
        if (palier) {
          this.coteMax = palier;
          this.garde.reinitialiser();
          console.info('[BEAUTÉ] traitement en retard : résolution de traitement abaissée à', palier, 'px');
        } else {
          this.cb.onCoupure?.();
          return; // l'appelant appelle destroy() via stopProcessor()
        }
      }
      if (t1 - this.derniereMesure >= 1000) {
        this.derniereMesure = t1;
        this.cb.onMesure?.(this.garde.fps(t1), this.nbImages ? this.cumulMs / this.nbImages : 0);
        this.cumulMs = 0; this.nbImages = 0;
      }
      this.planifier(tick);
    };
    this.planifier(tick);
  }

  private planifier(tick: (maintenant?: number, meta?: MetaImage) => void): void {
    const v = this.video;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // rAF/rVFC sont gelés en arrière-plan : minuteur à 15 i/s pour ne pas figer les participants.
      this.timerId = setTimeout(tick, 1000 / 15);
      return;
    }
    if (v && typeof v.requestVideoFrameCallback === 'function') {
      this.rvfcId = v.requestVideoFrameCallback(tick);
    } else {
      this.rafId = requestAnimationFrame(tick);
    }
  }

  private arreterBoucle(): void {
    if (this.timerId) { clearTimeout(this.timerId); this.timerId = null; }
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    if (this.rvfcId && this.video?.cancelVideoFrameCallback) { this.video.cancelVideoFrameCallback(this.rvfcId); this.rvfcId = 0; }
  }
}
