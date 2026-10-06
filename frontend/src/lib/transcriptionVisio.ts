/**
 * 🎙️ 06/10 — « ÉCHANGER EN VISIO » : la voix du participant à l'écran → texte → UNE suggestion chez l'hôte.
 *
 * Chemin (rien d'autre) :
 *   voix du participant DÉJÀ reçue par l'hôte (PeerJS, « prendre la parole »)
 *   → COPIE de la piste (`clone()`) : la piste jouée n'est jamais touchée, le son jamais coupé
 *   → transcription en direct chez OpenAI (WebRTC, secret éphémère fabriqué par NOTRE serveur)
 *   → segment texte → `recevoirTranscription` (même file que les questions du chat)
 *   → mode « voix » du souffleur → UNE réplique orale, chez l'hôte seul, jamais envoyée.
 *
 * Seule la voix du PARTICIPANT est transcrite : la voix de l'hôte ne passe jamais par ici (ce n'est
 * pas une voix « tribu »). Aucun micro supplémentaire n'est demandé au participant : on écoute ce que
 * l'hôte entend déjà. Rien n'est enregistré : l'audio file chez le fournisseur, seul le texte revient.
 *
 * Avant toute écoute, le participant VOIT un avis (« ta voix est transcrite pour aider le coach ») ;
 * la transcription ne démarre qu'après l'accusé « avis affiché » de SON appareil.
 */

/** Une voix participant reçue par l'hôte (forme de `usePeerAudio().getTribeAudioStreams()`). */
export interface VoixRecue {
  peerId: string;
  userId: string | null;
  stream: { getAudioTracks: () => { readyState: string }[] };
}

/** Événements du canal du Live (broadcast) : avis au participant et accusé de lecture. */
export const EVT_AVIS_VOIX = 'ASSISTANT_VOIX';
export const EVT_AVIS_VOIX_VU = 'ASSISTANT_VOIX_VU';

/** Le mode « Échanger en visio » demande-t-il d'écouter quelqu'un, et qui ? */
export function cibleVoix(p: {
  estHote: boolean; assistantActif: boolean; mode: string; inviteId: string | null | undefined; moi: string | null | undefined;
}): string | null {
  if (!p.estHote || !p.assistantActif || p.mode !== 'visio') return null;
  const id = String(p.inviteId || '');
  return id && id !== p.moi ? id : null;
}

/** La voix à transcrire : celle de la cible, vivante. Jamais celle de l'hôte (absente de cette liste). */
export function voixATranscrire<V extends VoixRecue>(voix: V[] | null | undefined, cible: string | null, moi?: string | null): V | null {
  if (!cible || cible === moi) return null;
  return (voix || []).find((v) => v.userId === cible
    && v.stream.getAudioTracks().some((t) => t.readyState === 'live')) || null;
}

/** On n'écoute qu'une fois l'avis AFFICHÉ chez la personne écoutée. */
export function transcriptionAutorisee(p: { cible: string | null; avisVuPar: string | null; voixPresente: boolean }): boolean {
  return !!p.cible && p.avisVuPar === p.cible && p.voixPresente;
}

/** Texte de l'avis montré au participant (jamais de jargon). */
export const TEXTE_AVIS_VOIX =
  'Pendant cet échange, une transcription de ta voix aide le coach à te répondre. Rien n’est enregistré.';

/* ─────────────── Événements du fournisseur (Realtime, session « transcription ») ─────────────── */

export interface EvenementTranscription {
  type?: string;
  item_id?: string;
  transcript?: string;
}
export interface SegmentVoix { id: string; texte: string }

/** Seul le texte FINAL d'une phrase devient un segment (les « delta » ne déclenchent rien). */
export function segmentDepuisEvenement(ev: EvenementTranscription | null | undefined): SegmentVoix | null {
  if (!ev || ev.type !== 'conversation.item.input_audio_transcription.completed') return null;
  const texte = String(ev.transcript || '').replace(/\s+/g, ' ').trim();
  const id = String(ev.item_id || '');
  return id && texte ? { id, texte } : null;
}

/** Latence = fin de parole détectée → texte final reçu, par phrase. */
export function creerChrono() {
  const fins = new Map<string, number>();
  return {
    evenement(ev: EvenementTranscription | null | undefined, maintenant: number): number | null {
      if (!ev || !ev.item_id) return null;
      if (ev.type === 'input_audio_buffer.speech_stopped') { fins.set(ev.item_id, maintenant); return null; }
      if (ev.type === 'conversation.item.input_audio_transcription.completed') {
        const debut = fins.get(ev.item_id);
        fins.delete(ev.item_id);
        return typeof debut === 'number' ? Math.max(0, maintenant - debut) : null;
      }
      return null;
    },
  };
}

export function latenceMoyenne(latences: number[]): number | null {
  const l = (latences || []).filter((x) => Number.isFinite(x));
  return l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null;
}

/* ─────────────── Connexion WebRTC au fournisseur ─────────────── */

export const URL_REALTIME_APPELS = 'https://api.openai.com/v1/realtime/calls';

export interface ConnexionTranscription { fermer: () => void }
export type ConnecteurTranscription = (
  piste: MediaStreamTrack,
  secret: string,
  onEvenement: (ev: EvenementTranscription) => void,
  onFin: (raison: string) => void,
) => Promise<ConnexionTranscription>;

/**
 * Envoie la COPIE de la piste au fournisseur. La piste passée ici est un `clone()` : la fermer
 * n'arrête jamais la piste jouée chez l'hôte (ni le relais vers les autres participants).
 */
export const connecterOpenAI: ConnecteurTranscription = async (piste, secret, onEvenement, onFin) => {
  const pc = new RTCPeerConnection();
  let ferme = false;
  pc.addTrack(piste, new MediaStream([piste]));
  const dc = pc.createDataChannel('oai-events');
  dc.onmessage = (e) => { try { onEvenement(JSON.parse(String(e.data))); } catch { /* événement illisible : ignoré */ } };
  pc.onconnectionstatechange = () => {
    if (!ferme && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) onFin(pc.connectionState);
  };
  const fermer = () => { ferme = true; try { dc.close(); } catch { /* déjà fermé */ } try { pc.close(); } catch { /* déjà fermé */ } };
  try {
    const offre = await pc.createOffer();
    await pc.setLocalDescription(offre);
    const r = await fetch(URL_REALTIME_APPELS, {
      method: 'POST', body: offre.sdp,
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' },
    });
    if (!r.ok) throw new Error(`sdp_${r.status}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
  } catch (e) {
    fermer();
    throw e;
  }
  return { fermer };
};
