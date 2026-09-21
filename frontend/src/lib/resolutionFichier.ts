/**
 * RÉSOLUTION ÉCRITE DANS L'EN-TÊTE DU FICHIER — logique PURE.
 *
 * Terrain 20/09 : le panneau « Enregistrement prêt » disait « 1920×1080 » pour un fichier
 * que ffprobe lisait en 1280×720. Ce que ffprobe lit, c'est l'EN-TÊTE du fichier :
 *  - MP4 : `moov → trak → mdia → minf → stbl → stsd → avc1` (width/height du VisualSampleEntry) ;
 *  - WebM : `Segment → Tracks → TrackEntry → Video → PixelWidth / PixelHeight`.
 * Chez Chrome, la PREMIÈRE tranche du MediaRecorder est exactement cet en-tête (`ftyp + moov`
 * en MP4, 1 243 octets mesurés ; EBML + Segment + Info + Tracks + premier Cluster en WebM).
 * On la lit une fois, sans rien écrire ni modifier : c'est la source qui coïncide avec ffprobe
 * PAR CONSTRUCTION — y compris quand un redimensionnement à chaud a laissé une image d'une autre
 * taille en tête (mesuré : `getSettings()` disait 720 quand le conteneur disait 1080).
 *
 * Structure inattendue → `null` (le hook se rabat sur `getSettings()` de la piste).
 */

export interface ResolutionLue { width: number; height: number }

const TYPES_VIDEO_MP4 = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01', 'mp4v']);

function type4(u8: Uint8Array, pos: number): string {
  return String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
}

/** Parcourt les boîtes ISO-BMFF de [debut, fin[ et rend la première du type voulu : [début du contenu, fin[. */
function boiteMp4(u8: Uint8Array, debut: number, fin: number, type: string): { contenu: number; fin: number } | null {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pos = debut;
  while (pos + 8 <= fin) {
    let taille = dv.getUint32(pos);
    const t = type4(u8, pos + 4);
    let entete = 8;
    if (taille === 1) { // largesize sur 64 bits (jamais chez MediaRecorder, mais lisible)
      if (pos + 16 > fin) return null;
      taille = dv.getUint32(pos + 8) * 4_294_967_296 + dv.getUint32(pos + 12); entete = 16;
    } else if (taille === 0) taille = fin - pos; // jusqu'à la fin
    if (taille < entete) return null;
    const finBoite = Math.min(fin, pos + taille);
    if (t === type) return { contenu: pos + entete, fin: finBoite };
    pos += taille;
  }
  return null;
}

/** MP4 : width/height du premier VisualSampleEntry de `stsd` (ce que ffprobe affiche). */
export function resolutionMp4(u8: Uint8Array): ResolutionLue | null {
  if (u8.length < 16) return null;
  const moov = boiteMp4(u8, 0, u8.length, 'moov'); if (!moov) return null;
  // Plusieurs pistes (vidéo + audio) : on cherche celle dont le stsd porte une entrée vidéo.
  let pos = moov.contenu;
  while (pos < moov.fin) {
    const trak = boiteMp4(u8, pos, moov.fin, 'trak'); if (!trak) return null;
    const mdia = boiteMp4(u8, trak.contenu, trak.fin, 'mdia');
    const minf = mdia && boiteMp4(u8, mdia.contenu, mdia.fin, 'minf');
    const stbl = minf && boiteMp4(u8, minf.contenu, minf.fin, 'stbl');
    const stsd = stbl && boiteMp4(u8, stbl.contenu, stbl.fin, 'stsd');
    if (stsd) {
      // stsd = FullBox : version(1) + flags(3) + entry_count(4), puis les SampleEntry.
      const entree = stsd.contenu + 8;
      if (entree + 8 <= stsd.fin && TYPES_VIDEO_MP4.has(type4(u8, entree + 4))) {
        // VisualSampleEntry : 6 réservés + data_reference_index(2) + pre_defined(2) + reserved(2) + pre_defined(12) = 24, puis width(2) height(2).
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const w = entree + 8 + 24;
        if (w + 4 > stsd.fin) return null;
        const width = dv.getUint16(w); const height = dv.getUint16(w + 2);
        return width > 0 && height > 0 ? { width, height } : null;
      }
    }
    pos = trak.fin;
  }
  return null;
}

// ── WebM (EBML) — même lecture minimale que webmDuree.ts, sans dépendance (module autonome) ──
const ID_SEGMENT = 0x18538067;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_VIDEO = 0xe0;
const ID_PIXEL_WIDTH = 0xb0;
const ID_PIXEL_HEIGHT = 0xba;

function lireId(u8: Uint8Array, pos: number): { id: number; longueur: number } | null {
  if (pos >= u8.length) return null;
  const b = u8[pos]; let longueur = 1; let masque = 0x80;
  while (longueur <= 4 && !(b & masque)) { masque >>= 1; longueur++; }
  if (longueur > 4 || pos + longueur > u8.length) return null;
  let id = 0; for (let i = 0; i < longueur; i++) id = id * 256 + u8[pos + i];
  return { id, longueur };
}

function lireTaille(u8: Uint8Array, pos: number): { valeur: number; longueur: number; inconnu: boolean } | null {
  if (pos >= u8.length) return null;
  const b = u8[pos]; let longueur = 1; let masque = 0x80;
  while (longueur <= 8 && !(b & masque)) { masque >>= 1; longueur++; }
  if (longueur > 8 || pos + longueur > u8.length) return null;
  let valeur = b & (masque - 1); let tousUn = valeur === masque - 1;
  for (let i = 1; i < longueur; i++) { valeur = valeur * 256 + u8[pos + i]; if (u8[pos + i] !== 0xff) tousUn = false; }
  return { valeur, longueur, inconnu: tousUn };
}

function entierNonSigne(u8: Uint8Array, pos: number, n: number): number {
  let v = 0; for (let i = 0; i < n; i++) v = v * 256 + u8[pos + i]; return v;
}

/** Cherche l'élément `id` parmi les enfants de [debut, fin[ ; rend [début du contenu, fin[. */
function elementEbml(u8: Uint8Array, debut: number, fin: number, id: number): { contenu: number; fin: number } | null {
  let pos = debut;
  while (pos < fin) {
    const el = lireId(u8, pos); if (!el) return null;
    const t = lireTaille(u8, pos + el.longueur); if (!t) return null;
    const contenu = pos + el.longueur + t.longueur;
    const finEl = t.inconnu ? fin : Math.min(fin, contenu + t.valeur);
    if (el.id === id) return { contenu, fin: finEl };
    if (t.inconnu) return null; // taille inconnue ailleurs que sur Segment : on ne sait pas sauter
    pos = finEl;
  }
  return null;
}

/** WebM : PixelWidth / PixelHeight du premier TrackEntry vidéo (ce que ffprobe affiche). */
export function resolutionWebm(u8: Uint8Array): ResolutionLue | null {
  const ebml = lireId(u8, 0); if (!ebml || ebml.id !== 0x1a45dfa3) return null;
  const ebmlTaille = lireTaille(u8, ebml.longueur); if (!ebmlTaille || ebmlTaille.inconnu) return null;
  const debutSegment = ebml.longueur + ebmlTaille.longueur + ebmlTaille.valeur;
  const seg = elementEbml(u8, debutSegment, u8.length, ID_SEGMENT); if (!seg) return null;
  const tracks = elementEbml(u8, seg.contenu, seg.fin, ID_TRACKS); if (!tracks) return null;
  let pos = tracks.contenu;
  while (pos < tracks.fin) {
    const entree = elementEbml(u8, pos, tracks.fin, ID_TRACK_ENTRY); if (!entree) return null;
    const video = elementEbml(u8, entree.contenu, entree.fin, ID_VIDEO);
    if (video) {
      const w = elementEbml(u8, video.contenu, video.fin, ID_PIXEL_WIDTH);
      const h = elementEbml(u8, video.contenu, video.fin, ID_PIXEL_HEIGHT);
      if (!w || !h) return null;
      const width = entierNonSigne(u8, w.contenu, w.fin - w.contenu);
      const height = entierNonSigne(u8, h.contenu, h.fin - h.contenu);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    pos = entree.fin;
  }
  return null;
}

/** Première tranche du MediaRecorder → résolution de l'en-tête, selon le conteneur ; `null` si illisible. */
export function resolutionFichier(u8: Uint8Array, extension: 'mp4' | 'webm'): ResolutionLue | null {
  try { return extension === 'mp4' ? resolutionMp4(u8) : resolutionWebm(u8); } catch { return null; }
}
