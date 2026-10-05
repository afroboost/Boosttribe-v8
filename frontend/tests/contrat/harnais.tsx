/**
 * 🛡️ CONTRAT LIVE — harnais NAVIGATEUR (vrais composants, vrai GPU, caméras factices jusqu'à 4K,
 * vrai serveur LiveKit LOCAL). Monté par `contrat.mjs` dans Chromium : les menus sont CLIQUÉS, le
 * pipeline vidéo est MESURÉ (résolution, couleur, image non noire), la piste est PUBLIÉE puis REÇUE.
 * Rien ici ne parle à la production : le seul serveur joint est le LiveKit local du contrat.
 */
import React, { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { Room, RoomEvent, Track, createLocalVideoTrack, type LocalVideoTrack, type RemoteTrack } from 'livekit-client';
import { LiveControls } from '@/components/session/LiveControls';
import { LivePromoParticipantModal } from '@/components/session/LivePromoParticipantModal';
import { PromoConnexionInvite } from '@/components/session/PromoConnexionInvite';
import { LiveCommentInput } from '@/components/session/LiveCommentInput';
import { LiveChatOverlay } from '@/components/session/LiveChatOverlay';
import { AccessModeSelector } from '@/components/session/AccessModeSelector';
import { PrompteurOverlay } from '@/components/session/PrompteurOverlay';
import BeauteToggle from '@/components/session/BeauteToggle';
import LookVideoSelector from '@/components/session/LookVideoSelector';
import { BeauteProcessor } from '@/lib/beaute/BeauteProcessor';
import { creerRenduBeaute } from '@/lib/beaute/rendu';
import { LOOKS, appliquerLook, parametresLook, type LookId } from '@/lib/looksVideo';
import { parametresBeaute, type NiveauBeaute } from '@/lib/beauteLogic';
import { MicrophoneControl } from '@/components/audio/MicrophoneControl';
import { usePrompteur } from '@/hooks/usePrompteur';
import { useBeauteVisage, type UseBeauteVisageReturn } from '@/hooks/useBeauteVisage';
import { actionPromoParticipant } from '@/lib/livePromo';
import { ETAT_INITIAL, recevoirMessages } from '@/lib/prompteurSources';
import { optionsCameraLive, associerPisteVideo, brancherVideo, ajusterDebitsCouches, OPTIONS_ROOM_LIVE } from '@/lib/qualiteVideo';
import { cibleBascule } from '@/lib/sourcesLogic';
import { dispositionBarre } from '@/lib/liveControls';
import { sessionShareUrl } from '@/lib/publicUrl';

type Role = 'hote' | 'participant' | 'invite' | 'participant_promo_fermee';
const appels: string[] = [];
let racine: Root | null = null;
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const note = (n: string) => () => { appels.push(n); };

function monter(el: React.ReactElement): void {
  appels.length = 0;
  racine?.unmount();
  racine = createRoot(document.getElementById('root')!);
  flushSync(() => racine!.render(el));
}

/* ═══ Menu ⋮ (vrai LiveControls) ═══ */
function menu(role: Role): void {
  const hote = role === 'hote';
  const promoOuverte = role !== 'participant_promo_fermee';
  // MÊME règle que SessionPage (actionPromoParticipant) : on ne teste pas une copie.
  const action = actionPromoParticipant({ estProprietaire: hote, connecte: role !== 'invite',
    config: { enabled: promoOuverte, offres: promoOuverte ? [{ id: 'a' }] : [] } });
  // Placée comme dans LiveVisioPanel : scène 1280×720, barre verticale à droite (dispositionBarre réelle).
  const barre = dispositionBarre({ largeur: 1280, hauteur: 720, pleinEcran: false });
  monter(
    <div style={{ position: 'relative', width: 1280, height: 720, background: '#000' }}>
    <LiveControls
      orientation={barre.orientation} largeur={1280} hauteur={720 - 24}
      className="absolute top-1/2 -translate-y-1/2" style={{ right: '0.75rem' }}
      pleinEcran={false} enCours={false} onPlayPause={note('play')}
      micActive onToggleMic={note('micro')}
      cameraOn={hote} canManageStage={hote} estHote={hote} onToggleCamera={note('camera')}
      onSources={hote ? note('sources') : undefined} sourcesAvancees={false}
      onFlipCamera={hote ? note('changer-camera') : undefined} peutBasculerCamera={hote}
      onTogglePrompteur={hote ? note('prompteur') : undefined}
      onTerminerLive={hote ? note('terminer') : undefined}
      onLeaveLive={note('quitter')}
      commentairesMasques={false} onToggleCommentaires={note('commentaires')}
      embellirNode={hote ? <span data-testid="beaute-toggle">Embellir</span> : undefined}
      lookNode={hote ? <LookVideoSelector look="original" onChoisir={(l) => appels.push(`look:${l}`)} /> : undefined}
      onFaireMaPromo={action === 'ouvrir' ? note('promo:ouvrir') : action === 'connexion' ? note('promo:connexion') : undefined}
      promoHote={hote ? { enAttente: 0, onOuvrir: note('promo:hote') } : undefined}
    />
    </div>,
  );
}

/* ═══ Faire ma promo : la fenêtre du participant ENVOIE vraiment la demande ═══ */
const requetes: { url: string; corps: unknown }[] = [];
function intercepterReseau(): void {
  requetes.length = 0;
  window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    let corps: unknown = null;
    try { corps = init?.body ? JSON.parse(String(init.body)) : null; } catch { corps = init?.body ?? null; }
    requetes.push({ url: String(url), corps });
    return new Response(JSON.stringify({ promo: { id: 'p1', status: 'requested', title: 'x' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}
function promoParticipant(): void {
  intercepterReseau();
  monter(<LivePromoParticipantModal sessionId="CONTRAT1-ABCDEF" devise="CHF" mesDemandes={[]}
    offres={[{ id: 'offre-30', duree_s: 30, prix: 0, type: 'free', actif: true } as never]}
    onFermer={note('promo:fermer')} onEnvoye={note('promo:envoyee')} />);
}
function promoConnexion(): void {
  monter(<PromoConnexionInvite onFermer={note('connexion:plus-tard')} onConnexion={note('connexion:go')} />);
}

/* ═══ Chat, commentaires, questions, prompteur, droits des invités ═══ */
const envoyes: { texte: string; question: boolean }[] = [];
function chat(): void {
  envoyes.length = 0;
  function Banc() {
    const [msgs, setMsgs] = React.useState<{ id: string; userId: string; name: string; text: string; ts: number; question?: boolean }[]>([]);
    return (
      <div style={{ position: 'relative', width: 800, height: 600 }}>
        <LiveChatOverlay messages={msgs as never} meUserId="moi" hostUserIds={['hote']} />
        <LiveCommentInput peutPoserQuestion onEnvoyer={(texte, o) => {
          envoyes.push({ texte, question: o.question });
          setMsgs((l) => [...l, { id: `m${l.length}`, userId: 'moi', name: 'Moi', text: texte, ts: Date.now(), question: o.question }]);
          return true;
        }} />
      </div>
    );
  }
  monter(<Banc />);
}
/** Le chemin « question du chat → file du prompteur de l'hôte » (règle réelle de la page). */
function questionsVuesParLHote(): string[] {
  const e = recevoirMessages(ETAT_INITIAL, envoyes.map((m, i) => ({ id: `m${i}`, userId: 'participant', name: 'Awa', text: m.texte, ts: i, question: m.question })), 'hote');
  return e.file.map((q) => q.texte);
}
function acces(valeur: 'guest' | 'account'): void {
  monter(<AccessModeSelector value={valeur} onChange={(m) => appels.push(`acces:${m}`)} />);
}
function prompteur(): void {
  function Banc() {
    const p = usePrompteur();
    // Texte LONG : un texte court atteint sa fin aussitôt et la lecture s'arrête d'elle-même (surFin).
    useEffect(() => { p.setScript(['Bienvenue dans le Live ! Échauffement : trois minutes.', ...Array.from({ length: 60 }, (_, i) => `Étape ${i + 1} : on respire et on bouge.`)].join('\n')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div style={{ position: 'relative', width: 800, height: 450 }}><PrompteurOverlay p={p} hauteur="clamp(104px, 26vh, 240px)" largeurMax="34rem" prise="8%" barre compte onFermer={note('prompteur:fermer')} /><span data-testid="lecture">{String(p.enLecture)}</span></div>;
  }
  monter(<Banc />);
}

/* ═══ Invitation : QR de la session = lien de partage (décodé) ═══ */
async function qr(sid: string): Promise<{ lien: string; decode: string | null; detecteur: boolean }> {
  const lien = sessionShareUrl(sid);
  monter(<QRCodeCanvas value={lien} size={320} level="M" includeMargin data-testid="session-qr" />);
  await attendre(100);
  const BD = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  if (!BD) return { lien, decode: null, detecteur: false };
  const r = await new BD({ formats: ['qr_code'] }).detect(document.querySelector('canvas')!);
  return { lien, decode: r[0]?.rawValue ?? null, detecteur: true };
}

/* ═══ Micro : vrai composant (mute/unmute) + traitements de la voix ═══ */
let fluxMicro: MediaStream | null = null;
function micro(): void {
  fluxMicro = null;
  monter(<MicrophoneControl onMicActive={(a) => appels.push(`micro:${a ? 'on' : 'off'}`)} onStreamReady={(s) => { fluxMicro = s; }} mode="manual" />);
}
function etatMicro() {
  const t = fluxMicro?.getAudioTracks()[0];
  const s = t?.getSettings?.() ?? {};
  return { piste: !!t, vivante: t?.readyState === 'live', echoCancellation: s.echoCancellation, noiseSuppression: s.noiseSuppression, autoGainControl: s.autoGainControl };
}

/* ═══ Mesure d'image ═══ */
type Mesure = { w: number; h: number; ecartCouleur: number; luma: number; variation: number };
async function mesurerElement(v: HTMLVideoElement): Promise<Mesure> {
  for (let i = 0; i < 100 && !v.videoWidth; i++) await attendre(50);
  await new Promise<void>((r) => (v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => void }).requestVideoFrameCallback(() => r()));
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(v, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let e = 0, l = 0, l2 = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] + d[i + 1] + d[i + 2]) / 3;
    e += Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]); l += y; l2 += y * y;
  }
  const n = d.length / 4;
  return { w: v.videoWidth, h: v.videoHeight, ecartCouleur: +(e / n).toFixed(2), luma: +(l / n).toFixed(1), variation: +Math.sqrt(Math.max(0, l2 / n - (l / n) ** 2)).toFixed(1) };
}
async function mesurerPiste(piste: MediaStreamTrack): Promise<Mesure> {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([piste]);
  await v.play();
  const m = await mesurerElement(v);
  v.srcObject = null;
  return m;
}

/* ═══ Embellissement : le VRAI hook + le VRAI bouton, sur une vraie piste LiveKit ═══ */
let beaute: UseBeauteVisageReturn | null = null;
function BancBeaute({ piste }: { piste: LocalVideoTrack }) {
  const b = useBeauteVisage({ getCameraTrack: () => piste, cameraOn: true });
  beaute = b;
  return (<div>
    <BeauteToggle beaute={b} compact />
    <LookVideoSelector look={b.look} onChoisir={b.setLook} avis={b.avisLook} palier={b.palier} />
  </div>);
}
async function cameraLocale(hauteur: number) {
  const { capture } = optionsCameraLive({ mobile: false, hauteurMax: hauteur });
  return createLocalVideoTrack(capture);
}
/** OFF puis ON puis OFF, à la hauteur demandée : ce que la piste PUBLIÉE contient à chaque étape. */
async function pipelineBeaute(hauteur: number) {
  try { localStorage.setItem('bt_beaute', 'off'); localStorage.removeItem('bt_look'); } catch { /* ignore */ }
  const piste = await cameraLocale(hauteur);
  monter(<BancBeaute piste={piste} />);
  await attendre(300);
  const off1 = { ...(await mesurerPiste(piste.mediaStreamTrack)), processeur: !!piste.getProcessor() };
  (document.querySelector('[data-testid="beaute-moyen"]') as HTMLButtonElement).click();
  for (let i = 0; i < 60 && !(piste.getProcessor() && beaute?.actif); i++) await attendre(100);
  await attendre(600);
  const sortie = piste.getProcessor()?.processedTrack;
  const on = sortie ? { ...(await mesurerPiste(sortie)), processeur: true, actif: !!beaute?.actif } : null;
  (document.querySelector('[data-testid="beaute-off"]') as HTMLButtonElement).click();
  for (let i = 0; i < 40 && piste.getProcessor(); i++) await attendre(100);
  const off2 = { ...(await mesurerPiste(piste.mediaStreamTrack)), processeur: !!piste.getProcessor() };
  racine?.unmount(); racine = null;
  piste.stop();
  return { off1, on, off2 };
}

/* ═══ LiveKit LOCAL : hôte publie, spectateur reçoit (adaptiveStream, dynacast, simulcast) ═══ */
let room: Room | null = null;
let videoRecue: HTMLVideoElement | null = null;
let debrancher: (() => void) | null = null;
const evenements: string[] = [];

async function hotePublier(o: { url: string; jeton: string; hauteur: number; beaute?: 'off' | 'moyen' }) {
  room = new Room(OPTIONS_ROOM_LIVE);
  await room.connect(o.url, o.jeton);
  // Même appel que useLiveKitStage.publishCamera : capture + publication de optionsCameraLive.
  const cam = optionsCameraLive({ mobile: false, hauteurMax: o.hauteur });
  await room.localParticipant.setCameraEnabled(true, cam.capture, cam.publication);
  const piste = room.localParticipant.getTrackPublication(Track.Source.Camera)!.track as LocalVideoTrack;
  if (o.beaute === 'moyen') {
    try { localStorage.setItem('bt_beaute', 'moyen'); localStorage.removeItem('bt_look'); } catch { /* ignore */ }
    monter(<BancBeaute piste={piste} />);
    for (let i = 0; i < 60 && !(piste.getProcessor() && beaute?.actif); i++) await attendre(100);
  }
  return etatHote();
}
async function etatHote() {
  const pub = room!.localParticipant.getTrackPublication(Track.Source.Camera)!;
  const piste = pub.track as LocalVideoTrack;
  const s = piste.mediaStreamTrack.getSettings();
  const enc = piste.sender?.getParameters().encodings ?? [];
  const stats = piste.sender ? await piste.sender.getStats() : new Map();
  const couches: Record<string, { w?: number; h?: number; fps?: number; limite?: string; actif?: boolean; debitMax?: number }> = {};
  stats.forEach((r: RTCStats & Record<string, unknown>) => {
    if (r.type === 'outbound-rtp' && r.kind === 'video') couches[String(r.rid ?? '-')] = { w: r.frameWidth as number, h: r.frameHeight as number, fps: r.framesPerSecond as number, limite: r.qualityLimitationReason as string };
  });
  enc.forEach((e) => { const k = e.rid ?? '-'; couches[k] = { ...(couches[k] || {}), actif: e.active, debitMax: e.maxBitrate }; });
  return { sid: pub.trackSid, w: s.width, h: s.height, fps: s.frameRate, simulcast: enc.length, couches, processeur: !!piste.getProcessor(),
    options: { adaptiveStream: !!room!.options.adaptiveStream, dynacast: !!room!.options.dynacast } };
}
async function hoteChangerCamera(hauteur: number) {
  const piste = room!.localParticipant.getTrackPublication(Track.Source.Camera)!.track as LocalVideoTrack;
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const courant = (await piste.getDeviceId()) ?? null;   // la caméra SOURCE (la piste publiée peut être celle de l'embellissement)
  const cible = cibleBascule(cams, courant);   // même règle que le bouton « changer de caméra »
  if (!cible) return { cameras: cams.length, cible: false };
  // Même séquence que useLiveKitStage.setCameraDevice : restartTrack sur la MÊME piste, puis débits.
  const { capture } = optionsCameraLive({ mobile: false, hauteurMax: hauteur });
  await piste.restartTrack({ deviceId: { exact: cible }, ...capture });
  const ajuste = await ajusterDebitsCouches(piste);
  await attendre(1500);
  const apres = await piste.getDeviceId();
  return { cameras: cams.length, cible: apres === cible && cible !== courant, ajuste, debug: { courant, cible, apres, ids: cams.map((c) => c.deviceId.slice(0, 8)) }, ...(await etatHote()) };
}
async function hoteCamera(allumee: boolean) {
  await room!.localParticipant.setCameraEnabled(allumee);
}
async function quitter() {
  debrancher?.(); debrancher = null;
  videoRecue?.remove(); videoRecue = null;
  racine?.unmount(); racine = null;
  await room?.disconnect(); room = null;
}

async function spectateurRejoindre(o: { url: string; jeton: string; largeur: number; hauteur: number }) {
  evenements.length = 0;
  room = new Room(OPTIONS_ROOM_LIVE);
  const recue = new Promise<RemoteTrack>((ok) => {
    room!.on(RoomEvent.TrackSubscribed, (t) => { if (t.kind === Track.Kind.Video) ok(t); });
  });
  room.on(RoomEvent.TrackMuted, () => evenements.push('muted')).on(RoomEvent.TrackUnmuted, () => evenements.push('unmuted'))
    .on(RoomEvent.Reconnecting, () => evenements.push('reconnecting')).on(RoomEvent.Reconnected, () => evenements.push('reconnected'))
    .on(RoomEvent.Disconnected, () => evenements.push('disconnected'));
  await room.connect(o.url, o.jeton);
  const piste = await recue;
  videoRecue = document.createElement('video');
  videoRecue.muted = true; videoRecue.autoplay = true; videoRecue.playsInline = true;
  Object.assign(videoRecue.style, { position: 'fixed', left: '0', top: '0', width: `${o.largeur}px`, height: `${o.hauteur}px`, background: '#000' });
  document.body.appendChild(videoRecue);
  // Même branchement que CameraTile : associerPisteVideo puis brancherVideo (attach → adaptiveStream).
  const flux = new MediaStream([piste.mediaStreamTrack]);
  associerPisteVideo(flux, piste);
  debrancher = brancherVideo(videoRecue, flux);
  return spectateurMesurer(4000);
}
async function spectateurTaille(largeur: number, hauteur: number, attenteMs = 4000) {
  Object.assign(videoRecue!.style, { width: `${largeur}px`, height: `${hauteur}px` });
  return spectateurMesurer(attenteMs);
}
/** Attend que la résolution reçue se stabilise, puis mesure l'image (jamais noire ?) et la cadence. */
async function spectateurMesurer(attenteMs: number) {
  const v = videoRecue!;
  const t0 = Date.now(); let dernier = ''; let stable = 0;
  while (Date.now() - t0 < attenteMs + 8000) {
    await attendre(400);
    const cle = `${v.videoWidth}x${v.videoHeight}`;
    stable = cle === dernier && v.videoWidth > 0 ? stable + 1 : 0; dernier = cle;
    if (Date.now() - t0 > attenteMs && stable >= 3) break;
  }
  const i0 = v.getVideoPlaybackQuality().totalVideoFrames; await attendre(1000);
  const i1 = v.getVideoPlaybackQuality().totalVideoFrames;
  return { ...(await mesurerElement(v)), imagesParSeconde: i1 - i0, evenements: [...evenements] };
}
async function spectateurReconnexion() {
  evenements.length = 0;
  await room!.simulateScenario('full-reconnect' as never);
  for (let i = 0; i < 150 && !evenements.includes('reconnected'); i++) await attendre(100);
  // Après une reconnexion complète, la piste est ré-abonnée : on rebranche comme la page.
  const nouvelle = await new Promise<RemoteTrack | null>((ok) => {
    const t = [...room!.remoteParticipants.values()].flatMap((p) => [...p.videoTrackPublications.values()]).find((x) => x.track)?.track;
    if (t) { ok(t as RemoteTrack); return; }
    room!.once(RoomEvent.TrackSubscribed, (tr) => ok(tr));
    setTimeout(() => ok(null), 10000);
  });
  if (nouvelle && videoRecue) {
    debrancher?.();
    const flux = new MediaStream([nouvelle.mediaStreamTrack]);
    associerPisteVideo(flux, nouvelle);
    debrancher = brancherVideo(videoRecue, flux);
  }
  return { ...(await spectateurMesurer(3000)), etat: room!.state };
}

/* ═══ 🎨 LOOKS VIDÉO ═══ */

/** Le VRAI shader, pixel par pixel : une mire de couleurs passe par rendu.ts, sortie comparée à la
 *  formule de référence (looksVideo.appliquerLook). Original = identité ; Noir & blanc = R=G=B. */
function looksGpu() {
  const W = 192, H = 108;
  const mire = document.createElement('canvas'); mire.width = W; mire.height = H;
  const m = mire.getContext('2d', { willReadFrequently: true })!;
  let graine = 7; const alea = () => { graine = (graine * 16807) % 2147483647; return graine / 2147483647; };
  for (let y = 0; y < H; y += 12) for (let x = 0; x < W; x += 12) {
    m.fillStyle = `rgb(${Math.floor(alea() * 256)},${Math.floor(alea() * 256)},${Math.floor(alea() * 256)})`; m.fillRect(x, y, 12, 12);
  }
  const src = m.getImageData(0, 0, W, H).data;
  const lecture = document.createElement('canvas'); lecture.width = W; lecture.height = H;
  const lx = lecture.getContext('2d', { willReadFrequently: true })!;
  return LOOKS.map((id) => {
    const r = creerRenduBeaute(W, H, parametresBeaute('off'), 0.3, parametresLook(id));
    r.dessiner(mire);
    lx.clearRect(0, 0, W, H); lx.drawImage(r.canvas, 0, 0);
    const out = lx.getImageData(0, 0, W, H).data;
    r.detruire();
    let errMax = 0, errSomme = 0, rgbMax = 0, diffSource = 0; let n = 0;
    // centre des carreaux (évite les bords interpolés)
    for (let y = 6; y < H; y += 12) for (let x = 6; x < W; x += 12) {
      const k = (y * W + x) * 4;
      const ref = appliquerLook([src[k] / 255, src[k + 1] / 255, src[k + 2] / 255], parametresLook(id)).map((v) => v * 255);
      for (let c = 0; c < 3; c++) { const e = Math.abs(out[k + c] - ref[c]); errMax = Math.max(errMax, e); errSomme += e; diffSource += Math.abs(out[k + c] - src[k + c]); }
      rgbMax = Math.max(rgbMax, Math.abs(out[k] - out[k + 1]), Math.abs(out[k + 1] - out[k + 2]));
      n += 3;
    }
    return { id, errMax: +errMax.toFixed(2), errMoy: +(errSomme / n).toFixed(2), rgbMax, diffSource: +(diffSource / n).toFixed(2) };
  });
}

type Rafale = { images: number; ips: number; lumaMin: number; noires: number; ecartCouleur: number; luma: number; w: number; h: number };
/** Regarde une piste comme un consommateur (aperçu / encodeur) : chaque image reçue est comptée et sa
 *  luminance mesurée (64×36) — une seule image noire se voit. */
async function rafale(v: HTMLVideoElement, ms: number): Promise<Rafale> {
  const c = document.createElement('canvas'); c.width = 64; c.height = 36;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  let images = 0, lumaMin = 255, noires = 0, fini = false;
  const vv = v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number };
  const t0 = performance.now();
  await new Promise<void>((ok) => {
    const cb = () => {
      if (fini) return;
      images++;
      x.drawImage(v, 0, 0, 64, 36);
      const d = x.getImageData(0, 0, 64, 36).data; let l = 0;
      for (let i = 0; i < d.length; i += 4) l += (d[i] + d[i + 1] + d[i + 2]) / 3;
      l /= d.length / 4; lumaMin = Math.min(lumaMin, l); if (l < 8) noires++;
      if (performance.now() - t0 >= ms) { fini = true; ok(); return; }
      vv.requestVideoFrameCallback(cb);
    };
    vv.requestVideoFrameCallback(cb);
    setTimeout(() => { fini = true; ok(); }, ms + 2000);
  });
  const duree = performance.now() - t0;
  const m = await mesurerElement(v);
  return { images, ips: +((images * 1000) / duree).toFixed(1), lumaMin: +lumaMin.toFixed(1), noires, ecartCouleur: m.ecartCouleur, luma: m.luma, w: m.w, h: m.h };
}
function lecteur(piste: MediaStreamTrack): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([piste]);
  v.play().catch(() => {});
  return v;
}

/** Caméra (1080p / 1440p / 4K) → processeur (beauté off|moyen) → chaque look à tour de rôle (setLook,
 *  à chaud). Pour chacun : résolution sortie, images/s reçues par un consommateur, ms/image (mesure
 *  du processeur), paliers / coupures, aucune image noire, même piste de sortie. */
async function mesurerLooks(o: { hauteur: number; beaute: NiveauBeaute; fenetreMs?: number }) {
  const fenetre = o.fenetreMs ?? 1200;
  const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: Math.round(o.hauteur * 16 / 9) }, height: { exact: o.hauteur }, frameRate: { ideal: 30 } } });
  const source = s.getVideoTracks()[0];
  const vs = lecteur(source);
  const brut = await rafale(vs, fenetre);
  const mesures: { fps: number; ms: number }[] = [];
  const paliers: number[] = []; let coupure = false;
  const p = new BeauteProcessor(o.beaute, { onMesure: (fps, ms) => mesures.push({ fps, ms }), onPalier: (c) => paliers.push(c), onCoupure: () => { coupure = true; } }, 'original');
  await p.init({ kind: 'video', track: source } as unknown as Parameters<BeauteProcessor['init']>[0]);
  const sortie = p.processedTrack!;
  const idSortie = sortie.id;
  const vo = lecteur(sortie);
  await rafale(vo, 600);   // échauffement
  const lignes = [];
  for (const id of LOOKS) {
    const debutMesures = mesures.length;
    p.setLook(id);
    // la bascule elle-même est regardée : aucune image noire, aucune coupure de flux
    const r = await rafale(vo, fenetre);
    const ms = mesures.slice(debutMesures);
    const moy = (f: (x: { fps: number; ms: number }) => number) => (ms.length ? +(ms.reduce((a, x) => a + f(x), 0) / ms.length).toFixed(2) : null);
    const ref = await mesurerElement(vs);
    lignes.push({ look: id, entree: `${brut.w}×${brut.h}`, sortie: `${r.w}×${r.h}`, w: r.w, h: r.h, ipsSortie: r.ips, ipsTraitement: moy((x) => x.fps), msImage: moy((x) => x.ms),
      noires: r.noires, lumaMin: r.lumaMin, ecartCouleur: r.ecartCouleur, luma: r.luma, ecartSource: ref.ecartCouleur, lumaSource: ref.luma,
      memePiste: p.processedTrack?.id === idSortie && p.processedTrack?.readyState === 'live',
      taille: p.tailleSortie });
  }
  vo.srcObject = null; vs.srcObject = null;
  await p.destroy(); source.stop();
  return { hauteur: o.hauteur, beaute: o.beaute, brut: { w: brut.w, h: brut.h, ips: brut.ips }, lignes, paliers, coupure };
}

/** Coût GPU RÉEL d'une image (téléversement + rendu + synchronisation readPixels), par résolution,
 *  embellissement et look. Source = canvas 2D (téléversement CPU→GPU : PESSIMISTE par rapport à une
 *  vidéo, souvent copiée GPU→GPU). */
function chronoGpu(o: { largeur: number; hauteur: number; images?: number }) {
  const n = o.images ?? 20;
  const src = document.createElement('canvas'); src.width = o.largeur; src.height = o.hauteur;
  const x = src.getContext('2d')!;
  const grad = x.createLinearGradient(0, 0, o.largeur, o.hauteur);
  grad.addColorStop(0, '#c84'); grad.addColorStop(0.5, '#3a7'); grad.addColorStop(1, '#259');
  x.fillStyle = grad; x.fillRect(0, 0, o.largeur, o.hauteur);
  const res: { beaute: NiveauBeaute; look: LookId; ms: number }[] = [];
  for (const b of ['off', 'moyen'] as NiveauBeaute[]) for (const id of LOOKS) {
    const r = creerRenduBeaute(o.largeur, o.hauteur, parametresBeaute(b), 0.3, parametresLook(id));
    const gl = r.canvas.getContext('webgl') as WebGLRenderingContext;
    const px = new Uint8Array(4);
    let total = 0;
    for (let i = 0; i < n + 3; i++) {
      x.fillStyle = `rgb(${i * 7 % 255},0,0)`; x.fillRect(0, 0, 4, 4);   // source « nouvelle » à chaque image
      const t0 = performance.now();
      r.dessiner(src);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (i >= 3) total += performance.now() - t0;
    }
    r.detruire();
    res.push({ beaute: b, look: id, ms: +(total / n).toFixed(2) });
  }
  return res;
}

/* Banc LiveKit : l'hôte clique le VRAI sélecteur (vrai hook) ; le spectateur regarde. */
async function hoteLook(id: LookId) {
  (document.querySelector(`[data-testid="look-${id}"]`) as HTMLButtonElement).click();
  const piste = room!.localParticipant.getTrackPublication(Track.Source.Camera)!.track as LocalVideoTrack;
  const voulu = id !== 'original' || (beaute?.niveau ?? 'off') !== 'off';
  for (let i = 0; i < 60 && (!!piste.getProcessor() !== voulu || beaute?.look !== id); i++) await attendre(100);
  await attendre(300);
  return { look: beaute?.look, niveau: beaute?.niveau, stockage: localStorage.getItem('bt_look'), ...(await etatHote()) };
}
async function hoteBeaute(n: NiveauBeaute) {
  (document.querySelector(`[data-testid="beaute-${n}"]`) as HTMLButtonElement).click();
  for (let i = 0; i < 30 && beaute?.niveau !== n; i++) await attendre(100);
  await attendre(800);
  return { look: beaute?.look, niveau: beaute?.niveau, ...(await etatHote()) };
}
/** Le spectateur regarde pendant `ms` (images comptées, la plus sombre retenue). */
async function spectateurRafale(ms: number) { return rafale(videoRecue!, ms); }

(window as unknown as Record<string, unknown>).contrat = {
  menu, appels, promoParticipant, promoConnexion, requetes, chat, envoyes, questionsVuesParLHote, acces, prompteur, qr,
  micro, etatMicro, pipelineBeaute, looksGpu, mesurerLooks, chronoGpu,
  lk: { hotePublier, etatHote, hoteChangerCamera, hoteCamera, quitter, spectateurRejoindre, spectateurTaille, spectateurReconnexion,
    hoteLook, hoteBeaute, spectateurRafale },
};
