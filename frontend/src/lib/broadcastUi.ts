/**
 * 📡 Helpers PURS du tiroir « Diffuser en direct » — testables sans React ni DOM.
 * Ils ne manipulent que des statuts : jamais une clé, une URL ou un jeton.
 */
export type BroadcastStatus = 'connected' | 'not_connected' | 'reauth' | 'unavailable' | 'starting' | 'live' | 'error' | 'off';

export interface StatutSource { status: BroadcastStatus; selected: boolean; error?: string }

/** Libellé lisible d'un statut — jamais de jargon, jamais de secret. */
export function libelleStatut(d: StatutSource, live: boolean): string {
  switch (d.status) {
    case 'live': return 'En direct';
    case 'starting': return 'Démarrage…';
    case 'error': return d.error ? `Échec — ${d.error}` : 'Échec';
    case 'reauth': return 'Reconnexion nécessaire';
    case 'unavailable': return 'Indisponible';
    case 'not_connected': return 'Non connecté';
    case 'off': return 'Non diffusé';
    case 'connected': return live && !d.selected ? 'Non diffusé' : 'Connecté';
    default: return '';
  }
}

/** L'interrupteur n'a de sens que pour un compte relié, hors direct. */
export const selectionnable = (s: BroadcastStatus): boolean => s === 'connected';

/** Nombre de réseaux réellement démarrables (reliés ET cochés). */
export const nbSelectionnes = (ds: StatutSource[]): number => ds.filter((d) => d.selected && selectionnable(d.status)).length;

/** `HH:MM:SS` depuis des secondes. */
export function formatDuree(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h, m, r].map((n) => String(n).padStart(2, '0')).join(':');
}
