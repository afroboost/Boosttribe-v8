/**
 * 🎛️ SOURCES (Phase 1 du mini studio) — logique PURE, sans DOM ni navigateur.
 *
 * Une seule règle, lisible : l'hôte n'a JAMAIS besoin d'une caméra externe.
 *   1. caméra externe explicitement choisie (et encore branchée)  → elle
 *   2. sinon caméra interne de l'appareil (téléphone ou webcam intégrée) → elle
 *   3. sinon                                                       → live audio, message discret
 *
 * Tout ce qui touche à `navigator`/LiveKit reste dans les hooks ; ici on ne manipule
 * que des listes de périphériques et des libellés. C'est ce qui rend le module testable
 * avec `node --test` (voir tests/sourcesLogic.test.mjs).
 */

export type FamilleCamera = 'avant' | 'arriere' | 'interne' | 'externe';

export interface CameraInfo {
  deviceId: string;
  label: string;
}

/** Caméra intégrée d'un téléphone ? (libellés Android/iOS/Chrome : « facing front/back »…) */
export function estCameraFacing(label: string): 'avant' | 'arriere' | null {
  const l = (label || '').toLowerCase();
  if (/facing\s*front|front camera|cam[ée]ra\s*avant|\buser\b/.test(l)) return 'avant';
  if (/facing\s*back|back camera|rear camera|cam[ée]ra\s*arri[èe]re|\benvironment\b/.test(l)) return 'arriere';
  return null;
}

/** Webcam intégrée d'un ordinateur ? (FaceTime HD, Integrated, Built-in, Internal…) */
export function estCameraIntegree(label: string): boolean {
  return /facetime|integrated|built-?in|internal|int[ée]gr[ée]e|interne/i.test(label || '');
}

/** Famille d'une caméra à partir de son libellé (les navigateurs ne donnent rien de mieux). */
export function familleCamera(label: string): FamilleCamera {
  const facing = estCameraFacing(label);
  if (facing) return facing;
  if (estCameraIntegree(label)) return 'interne';
  return 'externe';
}

/** Libellé UTILISATEUR — jamais de « user » / « environment » / « facing back » à l'écran. */
export function libelleCamera(cam: CameraInfo, index: number): string {
  const fam = familleCamera(cam.label);
  if (fam === 'avant') return 'Caméra avant';
  if (fam === 'arriere') return 'Caméra arrière';
  const propre = (cam.label || '').replace(/,?\s*facing\s*(front|back)\b/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  if (fam === 'interne') return propre || 'Caméra intégrée';
  return propre || `Caméra externe ${index + 1}`;
}

/** Une caméra « de l'appareil » (téléphone avant/arrière ou webcam intégrée) — le repli naturel. */
export function estCameraDeLAppareil(label: string): boolean {
  const fam = familleCamera(label);
  return fam === 'avant' || fam === 'arriere' || fam === 'interne';
}

/**
 * Quelle caméra publier ? (règle 1-2-3 ci-dessus)
 * - `choix` = deviceId explicitement choisi (externe ou non) ; ignoré s'il n'est plus dans la liste.
 * - Renvoie `null` quand AUCUNE caméra n'existe → l'appelant reste en live audio et l'affiche.
 * Quand plusieurs caméras de l'appareil existent (téléphone), on ne force PAS l'avant ou
 * l'arrière : la première que le navigateur propose est prise (comportement d'avant), le
 * coach bascule ensuite Avant ↔ Arrière depuis le panneau Sources.
 */
export function choisirCameraPrincipale(cams: CameraInfo[], choix: string | null | undefined): string | null {
  if (!cams.length) return null;
  if (choix && cams.some((c) => c.deviceId === choix)) return choix;
  const interne = cams.find((c) => estCameraDeLAppareil(c.label));
  if (interne) return interne.deviceId;
  return cams[0].deviceId;
}

/**
 * La caméra courante vient de disparaître (débranchée) ? → vers quoi revenir.
 * `null` en `retour` = plus aucune caméra ; `debranchee=false` = rien à faire.
 */
export function decisionDebranchement(cams: CameraInfo[], courant: string | null): { debranchee: boolean; retour: string | null } {
  if (!courant) return { debranchee: false, retour: null };
  if (cams.some((c) => c.deviceId === courant)) return { debranchee: false, retour: null };
  return { debranchee: true, retour: choisirCameraPrincipale(cams, null) };
}

/** Bascule Avant ↔ Arrière (téléphone) : préfère l'autre orientation ; sinon la caméra suivante. */
export function cibleBascule(cams: CameraInfo[], courant: string | null): string | null {
  if (cams.length < 2) return null;
  const idx = Math.max(0, cams.findIndex((c) => c.deviceId === courant));
  const famCourante = familleCamera(cams[idx]?.label || '');
  const opposee = famCourante === 'avant' ? 'arriere' : famCourante === 'arriere' ? 'avant' : null;
  if (opposee) {
    const cible = cams.find((c) => familleCamera(c.label) === opposee);
    if (cible) return cible.deviceId;
  }
  return cams[(idx + 1) % cams.length].deviceId;
}

/**
 * Multi-caméra (aperçus locaux) : uniquement sur un ordinateur sous Chromium.
 * Safari/iOS n'ouvre qu'une caméra à la fois ; Firefox mobile idem. Aucun hack ailleurs.
 */
export function multiCamPossible(userAgent: string, maxTouchPoints = 0): boolean {
  const ua = userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1); // iPadOS se dit Mac
  if (mobile) return false;
  const chromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/OPR\/Mini/.test(ua);
  return chromium;
}

/** Appareil « téléphone » (pour libeller Avant/Arrière et masquer « Ajouter une caméra »). */
export function estMobile(userAgent: string, maxTouchPoints = 0): boolean {
  const ua = userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

/** Libellé utilisateur d'un micro (jamais un deviceId brut à l'écran). */
export function libelleMicro(label: string, index: number): string {
  const propre = (label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  if (propre) return propre;
  return index === 0 ? 'Micro de l’appareil' : `Micro ${index + 1}`;
}
