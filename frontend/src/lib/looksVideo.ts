/**
 * 🎨 LOOKS VIDÉO — préréglages colorimétriques appliqués au FLUX PUBLIÉ (05/10/2026).
 *
 * Ordre du traitement (UNE seule passe GPU, à la pleine résolution de la caméra, jusqu'à 4K) :
 *   CAMÉRA → embellissement éventuel → LOOK → piste publiée LiveKit.
 * Le look vient APRÈS l'embellissement : le masque de peau est calculé sur les vraies couleurs de
 * la caméra ; un « Noir & blanc » placé avant le rendrait aveugle (plus aucune teinte de peau).
 *
 * « Original » = identité EXACTE. Avec l'embellissement coupé, le hook ne pose alors AUCUN
 * traitement : la piste brute de la caméra est publiée (qualité native, aucun coût).
 *
 * ── Formule d'un look (miroir exact du shader `appliquerLook`, lib/beaute/rendu.ts) ──
 *   c  = M · c + décalage                       (matrice 3×3, lignes)
 *   l  = luminance Rec.709 de c
 *   c += teinteOmbres · (1 − l)² + teinteLumieres · l²     (« split toning »)
 *   l  = luminance Rec.709 de c
 *   c  = l + (c − l) · saturation
 *   c  = (c − 0,5) · contraste + 0,5 ;  bornée à [0, 1]
 *
 * ── Future LUT personnalisée (.cube) — interface préparée, import NON construit ──
 * Un fichier `.cube` (Resolve, Premiere, LumaFusion…) décrit une LUT 3D : N³ couleurs de sortie
 * (N = 17, 33 ou 65), R variant le plus vite. Elle se branchera SANS toucher au reste du pipeline :
 *   1. parseur pur `lireCube(texte) → Lut3D` (ici, testable par `yarn test`) ;
 *   2. `ParametresLook.lut` renseigné → rendu.ts téléverse `donnees` dans une texture 2D « atlas »
 *      (N tranches de N×N côte à côte : WebGL 1 n'a pas de texture 3D), puis `appliquerLook`
 *      échantillonne l'atlas (interpolation entre les deux tranches B voisines) À LA PLACE de
 *      matrice/teintes/saturation/contraste — même passe, même canvas, même piste publiée ;
 *   3. un préréglage intégré peut lui-même être « cuit » en LUT (`echantillonnerLut`) : c'est la
 *      référence pour vérifier qu'un .cube importé et un look intégré donnent le même rendu.
 */

export type LookId = 'original' | 'noir_blanc' | 'cinema_chaud' | 'cinema_froid' | 'teal_orange' | 'contraste_doux';

export const LOOKS: readonly LookId[] = ['original', 'noir_blanc', 'cinema_chaud', 'cinema_froid', 'teal_orange', 'contraste_doux'] as const;

export const LIBELLES_LOOK: Record<LookId, string> = {
  original: 'Original',
  noir_blanc: 'Noir & blanc',
  cinema_chaud: 'Cinéma chaud',
  cinema_froid: 'Cinéma froid',
  teal_orange: 'Teal & Orange',
  contraste_doux: 'Contraste doux',
};

/** Réglage mémorisé sur l'appareil de l'hôte (comme `bt_beaute`). */
export const CLE_STOCKAGE_LOOK = 'bt_look';

type Vec3 = [number, number, number];

/** LUT 3D (.cube) : `taille`³ couleurs RGB 0..1, R varie le plus vite, puis G, puis B. */
export interface Lut3D {
  taille: number;
  donnees: Float32Array;   // longueur = taille³ × 3
}

export interface ParametresLook {
  /** Matrice couleur 3×3, LIGNE par ligne (R' = m0·R + m1·G + m2·B …). */
  matrice: [number, number, number, number, number, number, number, number, number];
  /** Décalage ajouté après la matrice (0..1). */
  decalage: Vec3;
  /** Teinte ajoutée aux ombres (pondérée par (1 − luminance)²). */
  teinteOmbres: Vec3;
  /** Teinte ajoutée aux hautes lumières (pondérée par luminance²). */
  teinteLumieres: Vec3;
  /** 1 = inchangée, 0 = monochrome. */
  saturation: number;
  /** 1 = inchangé ; < 1 adoucit ; > 1 accentue (autour de 0,5). */
  contraste: number;
  /** Réservé à la future LUT importée (.cube) — non lue par le rendu actuel. */
  lut?: Lut3D;
}

const IDENTITE: ParametresLook['matrice'] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO: Vec3 = [0, 0, 0];
const LUMA: Vec3 = [0.2126, 0.7152, 0.0722];

const PARAMETRES: Record<LookId, ParametresLook> = {
  original: { matrice: IDENTITE, decalage: ZERO, teinteOmbres: ZERO, teinteLumieres: ZERO, saturation: 1, contraste: 1 },
  // Luminance Rec.709 sur les trois canaux : un VRAI monochrome (R = G = B), pas une désaturation partielle.
  noir_blanc: { matrice: [...LUMA, ...LUMA, ...LUMA] as ParametresLook['matrice'], decalage: ZERO, teinteOmbres: ZERO, teinteLumieres: ZERO, saturation: 1, contraste: 1.08 },
  // Chaud : hautes lumières dorées, ombres légèrement ambrées, contraste un peu plus cinéma.
  cinema_chaud: { matrice: [1.04, 0.02, 0, 0, 1.0, 0, 0, -0.02, 0.92], decalage: [0.01, 0.004, -0.008], teinteOmbres: [0.015, 0.004, -0.012], teinteLumieres: [0.04, 0.015, -0.03], saturation: 0.95, contraste: 1.06 },
  // Froid : ombres bleutées, lumières neutres-froides, saturation un peu retenue.
  cinema_froid: { matrice: [0.94, 0, 0, 0, 1.0, 0.02, 0, 0.03, 1.06], decalage: [-0.008, 0.004, 0.02], teinteOmbres: [-0.012, 0.006, 0.035], teinteLumieres: [-0.015, 0.0, 0.02], saturation: 0.9, contraste: 1.05 },
  // Le classique du cinéma : ombres bleu-vert (teal), tons chair et lumières vers l'orange.
  teal_orange: { matrice: IDENTITE, decalage: ZERO, teinteOmbres: [-0.045, 0.02, 0.055], teinteLumieres: [0.06, 0.018, -0.05], saturation: 1.1, contraste: 1.08 },
  // Contraste doux : noirs relevés, transitions adoucies, couleurs à peine retenues.
  contraste_doux: { matrice: IDENTITE, decalage: [0.015, 0.015, 0.015], teinteOmbres: ZERO, teinteLumieres: ZERO, saturation: 0.96, contraste: 0.88 },
};

export function estLook(v: unknown): v is LookId {
  return typeof v === 'string' && (LOOKS as readonly string[]).includes(v);
}

export function parametresLook(id: LookId): ParametresLook {
  return PARAMETRES[id] ?? PARAMETRES.original;
}

export const estOriginal = (id: LookId): boolean => id === 'original';

const luma = (c: Vec3) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];

/** Applique un look à UNE couleur (0..1) — même formule que le shader ; sert aux tests et au contrat. */
export function appliquerLook(rgb: Vec3, p: ParametresLook): Vec3 {
  const [r, g, b] = rgb;
  const m = p.matrice;
  let c: Vec3 = [
    m[0] * r + m[1] * g + m[2] * b + p.decalage[0],
    m[3] * r + m[4] * g + m[5] * b + p.decalage[1],
    m[6] * r + m[7] * g + m[8] * b + p.decalage[2],
  ];
  let l = luma(c);
  const o = (1 - l) * (1 - l), h = l * l;
  c = c.map((x, i) => x + p.teinteOmbres[i] * o + p.teinteLumieres[i] * h) as Vec3;
  l = luma(c);
  c = c.map((x) => l + (x - l) * p.saturation) as Vec3;
  c = c.map((x) => (x - 0.5) * p.contraste + 0.5) as Vec3;
  return c.map((x) => Math.min(1, Math.max(0, x))) as Vec3;
}

/** « Cuit » un look en LUT 3D (format .cube) — référence pour la future LUT importée. */
export function echantillonnerLut(p: ParametresLook, taille = 17): Lut3D {
  const donnees = new Float32Array(taille * taille * taille * 3);
  let k = 0;
  for (let bi = 0; bi < taille; bi++) for (let gi = 0; gi < taille; gi++) for (let ri = 0; ri < taille; ri++) {
    const s = appliquerLook([ri / (taille - 1), gi / (taille - 1), bi / (taille - 1)], p);
    donnees[k++] = s[0]; donnees[k++] = s[1]; donnees[k++] = s[2];
  }
  return { taille, donnees };
}

export function lireLook(stockage: Pick<Storage, 'getItem'> | null): LookId {
  try { const v = stockage?.getItem(CLE_STOCKAGE_LOOK); return estLook(v) ? v : 'original'; } catch { return 'original'; }
}

export function ecrireLook(stockage: Pick<Storage, 'setItem' | 'removeItem'> | null, id: LookId): void {
  try {
    if (id === 'original') stockage?.removeItem(CLE_STOCKAGE_LOOK);
    else stockage?.setItem(CLE_STOCKAGE_LOOK, id);
  } catch { /* stockage indisponible : le réglage vaut pour la session */ }
}

/** Le processeur vidéo doit-il tourner ? Seulement si l'embellissement OU un look est actif. */
export function traitementNecessaire(niveauBeaute: string, look: LookId): boolean {
  return niveauBeaute !== 'off' || !estOriginal(look);
}
