/**
 * 🎬 studioLogic — la logique PURE du Studio (caméra + prompteur), isolée de React.
 *
 * Pourquoi séparer : le défilement, le repli de caméra et les bornes de réglage sont
 * exactement ce qui casse en silence. Sortis des composants, ils deviennent
 * vérifiables sans navigateur, sans DOM et sans framework de test — le dépôt n'en a
 * aucun et on ne va pas en imposer un pour trois fonctions.
 */

export const VITESSE_MIN = 0.5;
export const VITESSE_MAX = 2;
export const VITESSE_PAS = 0.25;
export const TAILLE_MIN = 24;
export const TAILLE_MAX = 72;
export const TAILLE_PAS = 4;

/**
 * Vitesse de base, en fraction de la HAUTEUR DE POLICE par seconde. L'indexer sur la
 * taille du texte (et non sur un nombre fixe de pixels) garde une cadence de LECTURE
 * constante : agrandir le texte ne le fait pas paraître plus lent.
 */
export const FACTEUR_VITESSE = 0.6;

/** Au-delà, on considère que l'onglet était en arrière-plan : sinon le texte saute d'un bloc. */
export const DT_MAX_MS = 100;

export const bornerVitesse = (v: number): number =>
  Math.min(VITESSE_MAX, Math.max(VITESSE_MIN, Math.round(v / VITESSE_PAS) * VITESSE_PAS));

export const bornerTaille = (t: number): number =>
  Math.min(TAILLE_MAX, Math.max(TAILLE_MIN, Math.round(t)));

/**
 * Un pas de défilement. Renvoie un nombre ENTIER de pixels (`scrollTop` est entier) et
 * le reliquat sous-pixel à reporter — sans ce report, une vitesse lente serait arrondie
 * à 0 à chaque image et le texte ne bougerait jamais.
 */
export function pasDefilement(
  dtMs: number, taillePx: number, vitesse: number, reste: number,
): { pixels: number; reste: number } {
  const dt = Math.max(0, Math.min(DT_MAX_MS, dtMs)) / 1000;
  const cumul = reste + FACTEUR_VITESSE * taillePx * vitesse * dt;
  const pixels = Math.floor(cumul);
  return { pixels, reste: cumul - pixels };
}

/** Le bas du texte est-il atteint ? (tolérance 1 px : les hauteurs sont fractionnaires) */
export const finAtteinte = (scrollTop: number, clientHeight: number, scrollHeight: number): boolean =>
  scrollTop + clientHeight >= scrollHeight - 1;

/**
 * Contrainte vidéo. Une caméra choisie est demandée en `exact` (sinon le navigateur
 * peut en servir une autre sans le dire) ; sans choix, on s'en remet à `facingMode`,
 * seul critère fiable sur iOS Safari où les libellés sont pauvres.
 */
export function contrainteVideo(deviceId: string | null, facing: 'user' | 'environment'): MediaTrackConstraints {
  return deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } };
}

/** Message affichable — jamais de jargon technique devant l'utilisateur. */
export function messageErreurCamera(nom: string): string {
  if (nom === 'NotAllowedError' || nom === 'SecurityError')
    return "Accès à la caméra refusé. Autorise la caméra dans ton navigateur, puis réessaie.";
  if (nom === 'NotFoundError' || nom === 'OverconstrainedError')
    return "Aucune caméra disponible. Branche une caméra puis clique « Rafraîchir ».";
  if (nom === 'NotReadableError')
    return "La caméra est déjà utilisée par une autre application (OBS, Zoom…). Ferme-la puis réessaie.";
  return "Impossible de démarrer la caméra. Vérifie qu'elle est bien branchée.";
}

/**
 * Message affiché quand la caméra EN COURS D'USAGE disparaît (câble débranché,
 * téléphone déconnecté, logiciel de caméra virtuelle fermé).
 *
 * Sans lui, l'aperçu se figeait sur la dernière image et rien ne le disait : on
 * croyait à un plantage. Il dit ce qui s'est passé ET quoi faire.
 */
export const MESSAGE_CAMERA_DEBRANCHEE =
  "La caméra s'est déconnectée. Rebranche-la, puis choisis-la à nouveau ci-dessous.";

/**
 * La caméra utilisée est-elle TOUJOURS dans la liste des périphériques ?
 *
 * Sert à réagir à un débranchement pendant l'usage. Sans identifiant courant, on ne
 * conclut rien : « aucune caméra choisie » n'est pas « caméra débranchée ».
 */
export function cameraToujoursPresente(devices: { deviceId: string }[], actif: string | null): boolean {
  if (!actif) return true;
  return devices.some((d) => d.deviceId === actif);
}

/**
 * Quelle caméra retenir ? La mémorisée si elle est encore là, sinon la première
 * disponible, sinon rien. C'est ce qui évite l'écran bloqué quand on débranche la
 * webcam entre deux visites.
 */
export function cameraRetenue(devices: { deviceId: string }[], memorise: string | null): string | null {
  if (memorise && devices.some((d) => d.deviceId === memorise)) return memorise;
  return devices.length > 0 ? devices[0].deviceId : null;
}

/** Libellé lisible : on retire l'identifiant USB que Chrome accole au nom. */
export function nomCamera(label: string, index: number): string {
  const s = (label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  return s || `Caméra ${index + 1}`;
}

/**
 * L'utilisateur est-il en train de SAISIR ? Sans cette garde, la barre d'espace
 * mettrait le prompteur en pause au lieu d'insérer une espace dans le script.
 */
export function estChampDeSaisie(tag: string | undefined, contentEditable: boolean): boolean {
  if (contentEditable) return true;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
