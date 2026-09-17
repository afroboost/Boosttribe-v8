/**
 * 🖥️ Partage d'écran — logique PURE (aucun DOM, aucun getDisplayMedia ici).
 *
 * Le bouton et le flux existants (`getDisplayMedia` → `publishScreen` de useLiveKitStage)
 * restent la seule mécanique. Ce module ne fait que deux choses :
 *   1. dire honnêtement si l'appareil PEUT partager (iOS Safari et la plupart des Android
 *      n'exposent pas `getDisplayMedia`) — jamais un bouton qui n'aboutit pas ;
 *   2. décider ce que fait l'arrêt (natif ou depuis Live Visio) : toutes les pistes capturées
 *      s'arrêtent, l'état repasse à « non partagé », et un nouveau partage reste possible.
 */

export interface CapacitePartageEcran {
  supporte: boolean;
  /** Texte court à afficher quand `supporte` est faux. */
  motif: string | null;
}

/** `navigator` minimal pour rester testable hors navigateur. */
export interface NavigateurMinimal {
  mediaDevices?: { getDisplayMedia?: unknown } | null;
  userAgent?: string;
}

/** Capacité réelle : la présence de `getDisplayMedia` fait foi, pas le type d'appareil. */
export function capacitePartageEcran(nav: NavigateurMinimal | null | undefined): CapacitePartageEcran {
  const md = nav?.mediaDevices;
  if (md && typeof md.getDisplayMedia === 'function') return { supporte: true, motif: null };
  return { supporte: false, motif: 'Indisponible sur cet appareil' };
}

/** Piste minimale (MediaStreamTrack) pour rester testable. */
export interface PisteMinimale { readyState?: string; stop?: () => void }

/**
 * Arrêt du partage : on stoppe TOUTES les pistes (vidéo + audio système) pour libérer la
 * capture du navigateur (sinon la barre « Arrêter le partage » reste et la source reste noire
 * chez les participants). Idempotent : une piste déjà terminée n'est pas re-stoppée.
 * Renvoie le nombre de pistes réellement stoppées.
 */
export function arreterPistesPartage(pistes: PisteMinimale[]): number {
  let n = 0;
  for (const t of pistes) {
    if (t.readyState === 'ended') continue;
    try { t.stop?.(); n += 1; } catch { /* ignore */ }
  }
  return n;
}

/** Après un arrêt (natif ou local), l'état attendu : plus de partage, repartage autorisé. */
export function etatApresArret(): { screenOn: false; repartagePossible: true } {
  return { screenOn: false, repartagePossible: true };
}
