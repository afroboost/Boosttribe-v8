/**
 * DURÉE D'UN WEBM ÉCRIT AU FIL DE L'EAU — logique PURE.
 *
 * `MediaRecorder` produit un WebM sans élément `Duration` (il ne connaît pas la
 * fin à l'avance) : le fichier se lit, mais la barre de lecture ne sait pas
 * combien il dure et le « seek » est hésitant. Les correctifs habituels
 * (fix-webm-duration) RÉÉCRIVENT tout le fichier — impossible quand on écrit
 * progressivement sur disque.
 *
 * L'astuce ici : on ne touche QUE le premier morceau, AVANT de l'écrire. On y
 * insère un `Duration` de 8 octets initialisé à 0 dans l'élément `Info`, et on
 * mémorise la position de ces 8 octets. À l'arrêt, on réécrit uniquement ces
 * 8 octets (même longueur) avec la vraie durée. Fonctionne avec File System
 * Access, OPFS (écriture positionnelle) et en mémoire.
 *
 * Portée volontairement minimale : seuls `Segment` → `Info` sont parcourus ; si
 * la structure attendue n'est pas trouvée, on rend les octets INCHANGÉS et
 * `offsetDuree = null` (le fichier reste lisible, juste sans durée).
 */

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_DURATION = 0x4489;
const ID_TIMECODE_SCALE = 0x2ad7b1;

interface Vint { valeur: number; longueur: number; inconnu: boolean }

function lireId(u8: Uint8Array, pos: number): { id: number; longueur: number } | null {
  if (pos >= u8.length) return null;
  const b = u8[pos];
  let longueur = 1;
  let masque = 0x80;
  while (longueur <= 4 && !(b & masque)) { masque >>= 1; longueur++; }
  if (longueur > 4 || pos + longueur > u8.length) return null;
  let id = 0;
  for (let i = 0; i < longueur; i++) id = id * 256 + u8[pos + i];
  return { id, longueur };
}

function lireTaille(u8: Uint8Array, pos: number): Vint | null {
  if (pos >= u8.length) return null;
  const b = u8[pos];
  let longueur = 1;
  let masque = 0x80;
  while (longueur <= 8 && !(b & masque)) { masque >>= 1; longueur++; }
  if (longueur > 8 || pos + longueur > u8.length) return null;
  let valeur = b & (masque - 1);
  let tousUn = valeur === masque - 1;
  for (let i = 1; i < longueur; i++) {
    valeur = valeur * 256 + u8[pos + i];
    if (u8[pos + i] !== 0xff) tousUn = false;
  }
  return { valeur, longueur, inconnu: tousUn };
}

/** Taille EBML sur 8 octets (0x01 + 7 octets) : toujours assez large, longueur fixe. */
function ecrireTaille8(valeur: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let v = valeur;
  for (let i = 7; i >= 1; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  return out;
}

export function encoderDuree(ms: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, ms, false);
  return new Uint8Array(buf);
}

export interface EnteteWebmPrepare {
  octets: Uint8Array;
  /** Position absolue (dans le fichier) des 8 octets de la durée, ou null si non insérable. */
  offsetDuree: number | null;
  /** TimecodeScale lu (ns par unité) ; MediaRecorder = 1 000 000 → durée en millisecondes. */
  timecodeScale: number;
}

/**
 * Insère `Duration` (= 0) dans `Info` du premier morceau. À appeler UNE fois,
 * sur le premier `dataavailable`, avant toute écriture.
 */
export function preparerEnteteWebm(u8: Uint8Array): EnteteWebmPrepare {
  const inchange: EnteteWebmPrepare = { octets: u8, offsetDuree: null, timecodeScale: 1_000_000 };
  let pos = 0;
  // 1. En-tête EBML (id 0x1A45DFA3) : on le saute.
  const ebml = lireId(u8, pos); if (!ebml) return inchange;
  const ebmlTaille = lireTaille(u8, pos + ebml.longueur); if (!ebmlTaille || ebmlTaille.inconnu) return inchange;
  pos += ebml.longueur + ebmlTaille.longueur + ebmlTaille.valeur;
  // 2. Segment (taille inconnue chez MediaRecorder : on ne la modifie pas).
  const seg = lireId(u8, pos); if (!seg || seg.id !== ID_SEGMENT) return inchange;
  const segTaille = lireTaille(u8, pos + seg.longueur); if (!segTaille) return inchange;
  if (!segTaille.inconnu) return inchange; // taille connue : trop risqué de la maintenir à jour ici
  pos += seg.longueur + segTaille.longueur;
  // 3. Enfants du Segment jusqu'à Info.
  while (pos < u8.length) {
    const el = lireId(u8, pos); if (!el) return inchange;
    const taille = lireTaille(u8, pos + el.longueur); if (!taille || taille.inconnu) return inchange;
    const debutContenu = pos + el.longueur + taille.longueur;
    const finContenu = debutContenu + taille.valeur;
    if (finContenu > u8.length) return inchange;
    if (el.id === ID_INFO) {
      // Déjà un Duration ? On le réutilise.
      let p = debutContenu; let timecodeScale = 1_000_000;
      while (p < finContenu) {
        const e = lireId(u8, p); if (!e) break;
        const t = lireTaille(u8, p + e.longueur); if (!t || t.inconnu) break;
        const dc = p + e.longueur + t.longueur;
        if (e.id === ID_TIMECODE_SCALE) { let v = 0; for (let i = 0; i < t.valeur; i++) v = v * 256 + u8[dc + i]; timecodeScale = v || 1_000_000; }
        if (e.id === ID_DURATION && t.valeur === 8) return { octets: u8, offsetDuree: dc, timecodeScale };
        p = dc + t.valeur;
      }
      // Insertion : [id 0x44 0x89][taille 0x88][8 octets] = 11 octets en fin d'Info ; taille d'Info réécrite sur 8 octets.
      const contenuInfo = u8.subarray(debutContenu, finContenu);
      const duration = new Uint8Array([0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0]);
      const nouvelleTaille = ecrireTaille8(taille.valeur + duration.length);
      const avant = u8.subarray(0, pos + el.longueur);
      const apres = u8.subarray(finContenu);
      const out = new Uint8Array(avant.length + nouvelleTaille.length + contenuInfo.length + duration.length + apres.length);
      let o = 0;
      out.set(avant, o); o += avant.length;
      out.set(nouvelleTaille, o); o += nouvelleTaille.length;
      out.set(contenuInfo, o); o += contenuInfo.length;
      const offsetDuree = o + 3; // après id (2) + taille (1)
      out.set(duration, o); o += duration.length;
      out.set(apres, o);
      return { octets: out, offsetDuree, timecodeScale };
    }
    pos = finContenu;
  }
  return inchange;
}

/** Valeur à écrire aux 8 octets : durée en unités de TimecodeScale (ms si 1e6 ns). */
export function dureeEnUnites(dureeMs: number, timecodeScale: number): number {
  return dureeMs * (1_000_000 / (timecodeScale || 1_000_000));
}
