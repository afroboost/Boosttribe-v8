/**
 * ⏺ Helpers PURS de l'UI d'enregistrement (testables sans DOM, comme broadcastUi.ts).
 * Aucune logique de capture ici : seulement des libellés et des choix d'affichage.
 */
import type { RecCapacite, RecEtat, RecQualite } from '@/components/session/RecordTypes';

/** HH:MM:SS — même rendu que la durée du direct. */
export function formatDureeRec(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h, m, r].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Taille lisible : Ko / Mo / Go, une décimale au-delà du Mo. */
export function formatTaille(octets: number): string {
  const o = Math.max(0, octets || 0);
  if (o < 1024) return `${o} o`;
  if (o < 1024 * 1024) return `${Math.round(o / 1024)} Ko`;
  if (o < 1024 * 1024 * 1024) return `${(o / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(o / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

/** « MP4 (H.264/AAC) », « WebM (VP9/Opus) »… déduit de la capacité réelle, jamais promis. */
export function libelleFormat(c: Pick<RecCapacite, 'extension' | 'codec' | 'mime'>): string {
  const ext = c.extension === 'mp4' ? 'MP4' : 'WebM';
  const codec = (c.codec || '').trim();
  return codec ? `${ext} (${codec})` : ext;
}

/** Qualité par défaut : 1080p si proposée, sauf sur mobile (720p d'abord) ; sinon la première. */
export function qualiteParDefaut(c: Pick<RecCapacite, 'qualites' | 'mobile'>): RecQualite | null {
  if (!c.qualites || c.qualites.length === 0) return null;
  if (!c.mobile && c.qualites.includes('1080p')) return '1080p';
  if (c.qualites.includes('720p')) return '720p';
  return c.qualites[0];
}

/** Libellé de l'item ⋮ selon l'état — « Enregistrer » / « Arrêter l'enregistrement ». */
export function libelleItemRecord(etat: RecEtat, dureeSec: number): string {
  if (etat === 'enregistrement') return `Enregistrement ${formatDureeRec(dureeSec)}`;
  if (etat === 'preparation') return 'Préparation…';
  if (etat === 'finalisation') return 'Finalisation…';
  return 'Enregistrer';
}

/** Motif affiché quand la fonction n'est pas disponible sur l'appareil. */
export function motifIndisponible(c: Pick<RecCapacite, 'supporte' | 'mobile' | 'motif'>): string | null {
  if (c.supporte) return null;
  if (c.motif) return c.motif;
  return c.mobile ? 'Enregistrement haute qualité disponible sur ordinateur' : 'Enregistrement indisponible sur ce navigateur';
}

/** Le badge « ● REC » n'existe qu'en enregistrement effectif. */
export const badgeVisible = (etat: RecEtat): boolean => etat === 'enregistrement';
