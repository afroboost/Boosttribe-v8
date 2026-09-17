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
  // iOS (FR/EN : « Caméra avant », « Front Camera », « FaceTime » sur iPhone = TrueDepth avant), Android/Chrome
  // (« camera2 1, facing front », « user »), Samsung/Pixel (« Front Camera », « Selfie »).
  if (/facing\s*front|\bfront\b|selfie|truedepth|cam[ée]ra\s*avant|\bavant\b|\buser\b/.test(l)) return 'avant';
  // « Back Camera », « Back Dual Wide Camera », « Back Ultra Wide Camera », « Back Triple Camera »,
  // « Rear », « Caméra arrière (double grand angle) », « environment », « camera2 0, facing back ».
  if (/facing\s*back|\bback\b|\brear\b|cam[ée]ra\s*arri[èe]re|arri[èe]re|\benvironment\b/.test(l)) return 'arriere';
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

/** Nettoie un libellé constructeur : identifiant USB, « facing … », espaces. */
function libelleBrutPropre(label: string): string {
  return (label || '')
    .replace(/,?\s*facing\s*(front|back)\b/i, '')
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SourceAffichable {
  /** deviceId STABLE à sélectionner (premier appareil de la famille dans l'ordre d'énumération). */
  deviceId: string;
  /** Libellé utilisateur (jamais de jargon). */
  libelle: string;
  famille: FamilleCamera;
  /** Tous les deviceId regroupés sous cette entrée (objectifs multiples d'une même face, doublons). */
  membres: string[];
}

/** Clé de regroupement d'un appareil externe : groupId (même boîtier) sinon libellé nettoyé. */
function cleAppareil(d: { deviceId: string; label: string; groupId?: string }): string {
  const propre = libelleBrutPropre(d.label).toLowerCase();
  return d.groupId ? `g:${d.groupId}` : `l:${propre || d.deviceId}`;
}

/**
 * Liste des caméras À AFFICHER dans le tiroir Sources — SANS doublon.
 * - téléphone (`mobile`) : UNE entrée « Caméra avant » et UNE « Caméra arrière » (un iPhone expose grand angle,
 *   ultra grand angle, double, TrueDepth… tous de la même face : ils sont regroupés, le deviceId retenu est le
 *   premier énuméré — celui que le navigateur propose par défaut) ; puis les externes, une par appareil ;
 * - ordinateur : « Caméra intégrée » (FaceTime / Integrated / Built-in) puis chaque externe (USB, capture HDMI,
 *   virtuelle) une seule fois même si elle expose plusieurs profils (dédup par groupId, sinon libellé).
 * L'ordre d'énumération est conservé à l'intérieur de chaque famille ; les faces passent avant les externes.
 */
export function camerasAffichables(
  devices: Array<{ deviceId: string; label: string; groupId?: string }>,
  opts: { mobile: boolean },
): SourceAffichable[] {
  const entrees: SourceAffichable[] = [];
  const parCle = new Map<string, SourceAffichable>();
  let iExterne = 0;
  for (const d of devices) {
    if (!d || !d.deviceId) continue;
    const fam = familleCamera(d.label);
    let cle: string;
    let libelle: string;
    if (fam === 'avant' || fam === 'arriere') {
      // Une seule entrée par face — sur téléphone comme sur un ordinateur qui aurait une caméra « front/back ».
      cle = `face:${fam}`;
      libelle = fam === 'avant' ? 'Caméra avant' : 'Caméra arrière';
    } else if (fam === 'interne') {
      cle = 'interne';
      libelle = 'Caméra intégrée';
    } else {
      cle = cleAppareil(d);
      const propre = libelleBrutPropre(d.label);
      libelle = propre || `Caméra externe ${++iExterne}`;
    }
    const existante = parCle.get(cle);
    if (existante) { existante.membres.push(d.deviceId); continue; }
    const e: SourceAffichable = { deviceId: d.deviceId, libelle, famille: fam, membres: [d.deviceId] };
    parCle.set(cle, e);
    entrees.push(e);
  }
  // Faces / intégrée d'abord (repli naturel), externes ensuite ; ordre d'énumération conservé sinon.
  const rang = (f: FamilleCamera): number => (f === 'avant' ? 0 : f === 'arriere' ? 1 : f === 'interne' ? 2 : 3);
  const triees = entrees.map((e, i) => ({ e, i })).sort((a, b) => rang(a.e.famille) - rang(b.e.famille) || a.i - b.i).map((x) => x.e);
  // Sur téléphone, les entrées de face suffisent ; une « intégrée » n'a pas de sens (iPad se dit Mac : on la garde).
  return opts.mobile ? triees.filter((e) => e.famille !== 'interne' || triees.every((x) => x.famille === 'interne' || x.famille === 'externe')) : triees;
}

/** Un micro est « de l'appareil » (intégré) ? */
export function estMicroDeLAppareil(label: string): boolean {
  return /built-?in|internal|int[ée]gr[ée]|interne|iphone|ipad|android|micro(phone)?\s*de\s*l|facing|\bdefault\b|par d[ée]faut/i.test(label || '');
}

/**
 * Liste des micros À AFFICHER — SANS doublon : Windows/Chrome exposent « Default - X » et « Communications - X »
 * en plus de « X » ; certains navigateurs listent deux fois le même appareil ; regroupement par groupId, sinon
 * par libellé nettoyé (préfixes Default/Communications retirés). Le deviceId retenu = premier énuméré.
 */
export function microsAffichables(
  devices: Array<{ deviceId: string; label: string; groupId?: string }>,
): SourceAffichable[] {
  const entrees: SourceAffichable[] = [];
  const parCle = new Map<string, SourceAffichable>();
  let n = 0;
  for (const d of devices) {
    if (!d || !d.deviceId) continue;
    const sansPrefixe = libelleBrutPropre(d.label).replace(/^(default|communications|par d[ée]faut)\s*[-–:]\s*/i, '').trim();
    const cle = d.groupId ? `g:${d.groupId}` : `l:${sansPrefixe.toLowerCase() || d.deviceId}`;
    const existante = parCle.get(cle);
    if (existante) { existante.membres.push(d.deviceId); continue; }
    // Interne si le libellé le dit, ou si c'est le premier micro et qu'il ne ressemble pas à un appareil externe.
    const externeEvident = /usb|rode|shure|yeti|blue|zoom|scarlett|focusrite|airpods|bluetooth|\bbt\b|headset|casque|wireless|lavalier|hdmi|capture|obs|virtual/i.test(sansPrefixe);
    const interne = estMicroDeLAppareil(sansPrefixe) || (n === 0 && !externeEvident);
    const libelle = sansPrefixe ? (interne ? 'Micro de l’appareil' : sansPrefixe) : (n === 0 ? 'Micro de l’appareil' : `Micro ${n + 1}`);
    const e: SourceAffichable = { deviceId: d.deviceId, libelle, famille: interne ? 'interne' : 'externe', membres: [d.deviceId] };
    parCle.set(cle, e); entrees.push(e); n++;
  }
  // Une seule entrée « Micro de l’appareil » : si plusieurs internes, la première garde le nom, les autres leur libellé.
  let vu = false;
  for (const e of entrees) {
    if (e.libelle === 'Micro de l’appareil') { if (vu) e.libelle = libelleBrutPropre(devices.find((d) => d.deviceId === e.deviceId)?.label || '') || 'Micro'; vu = true; }
  }
  return entrees;
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
