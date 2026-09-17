/**
 * 🎚️ Phase 3 minimale — BUS AUDIO DU PROGRAMME.
 *
 * Le mixeur existant (`useAudioMixer`) vit dans DEUX AudioContext (musique + casque de l'hôte,
 * micro hôte → diffusion) : il n'expose pas « un seul flux programme ». Ce bus est le plus
 * petit raccord : un troisième contexte, dédié, qui reçoit des COPIES (clones de pistes, comme
 * le recorder — jamais la piste d'origine, donc la visio et le micro ne sont pas touchés) :
 *   - « mic »     → flux micro DIFFUSÉ du mixeur (gain + limiteur déjà appliqués) ;
 *   - « musique » → flux de la musique du mixeur (`getMusicStream`, son réel post-gain + timer) ;
 *   - « participant:<id> » → voix d'un participant reçue chez l'hôte (élément `.bt-tribe-audio`).
 * Sortie = `MediaStreamAudioDestinationNode.stream` : la PISTE AUDIO DU PROGRAMME.
 *
 * Distinct du bus casque (rien ne repart vers les haut-parleurs de l'hôte → pas d'écho).
 * Même horloge locale que la vidéo composée : synchro A/V = celle d'un seul navigateur.
 */

export interface EntreeProgramme { id: string; gain: number }

export interface NoeudsEntree { gain: GainNode; source: MediaStreamAudioSourceNode; clones: MediaStreamTrack[] }

export class ProgramAudioBus {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private entrees = new Map<string, NoeudsEntree>();
  private limiteur: DynamicsCompressorNode | null = null;

  get stream(): MediaStream | null { return this.dest?.stream ?? null; }
  get pisteAudio(): MediaStreamTrack | null { return this.dest?.stream.getAudioTracks()[0] ?? null; }
  get actif(): boolean { return !!this.ctx; }
  get ids(): string[] { return [...this.entrees.keys()]; }

  demarrer(): MediaStream | null {
    if (this.ctx) return this.stream;
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    const dest = ctx.createMediaStreamDestination();
    // Limiteur de crêtes en bout de bus (même réglage que le mixeur : brickwall, transparent à 100 %).
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
    lim.connect(dest);
    this.ctx = ctx; this.dest = dest; this.limiteur = lim;
    if (ctx.state === 'suspended') ctx.resume().catch(() => { /* geste requis */ });
    return dest.stream;
  }

  /** Ajoute (ou remplace) une entrée depuis un flux : les pistes sont CLONÉES, l'original est intact. */
  ajouter(id: string, flux: MediaStream | null | undefined, gain = 1): boolean {
    const ctx = this.ctx; const lim = this.limiteur;
    if (!ctx || !lim || !flux) return false;
    const pistes = flux.getAudioTracks().filter((t) => t.readyState !== 'ended');
    if (!pistes.length) return false;
    this.retirer(id);
    try {
      const clones = pistes.map((t) => t.clone());
      const source = ctx.createMediaStreamSource(new MediaStream(clones));
      const g = ctx.createGain(); g.gain.value = gain;
      source.connect(g); g.connect(lim);
      this.entrees.set(id, { gain: g, source, clones });
      return true;
    } catch { return false; }
  }

  reglerGain(id: string, gain: number): void {
    const e = this.entrees.get(id);
    if (e) { try { e.gain.gain.setTargetAtTime(gain, this.ctx?.currentTime ?? 0, 0.05); } catch { e.gain.gain.value = gain; } }
  }

  retirer(id: string): void {
    const e = this.entrees.get(id);
    if (!e) return;
    try { e.source.disconnect(); e.gain.disconnect(); } catch { /* ignore */ }
    e.clones.forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    this.entrees.delete(id);
  }

  /** Garde exactement les entrées voulues (ajoute les nouvelles, retire les absentes). */
  synchroniser(voulues: { id: string; flux: MediaStream | null | undefined; gain?: number }[]): void {
    const ids = new Set(voulues.map((v) => v.id));
    for (const id of [...this.entrees.keys()]) if (!ids.has(id)) this.retirer(id);
    for (const v of voulues) if (!this.entrees.has(v.id)) this.ajouter(v.id, v.flux, v.gain ?? 1);
  }

  arreter(): void {
    for (const id of [...this.entrees.keys()]) this.retirer(id);
    try { this.dest?.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null; this.dest = null; this.limiteur = null;
  }
}

/** PUR : quelles entrées audio le programme doit contenir pour une scène donnée. */
export function entreesPourScene(o: {
  mic: boolean; musique: boolean;
  participantsDansScene: string[];      // identités présentes dans les boîtes du programme
  participantsAudibles: string[];       // identités dont l'hôte reçoit la voix (parole accordée)
  inclureParticipants: 'scene' | 'tous' | 'aucun';
}): EntreeProgramme[] {
  const out: EntreeProgramme[] = [];
  if (o.mic) out.push({ id: 'mic', gain: 1 });
  if (o.musique) out.push({ id: 'musique', gain: 1 });
  if (o.inclureParticipants !== 'aucun') {
    const ids = o.inclureParticipants === 'tous' ? o.participantsAudibles : o.participantsAudibles.filter((p) => o.participantsDansScene.includes(p));
    for (const p of ids) out.push({ id: `participant:${p}`, gain: 1 });
  }
  return out;
}
