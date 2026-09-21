/**
 * 📡 Helpers PURS du tiroir « Diffuser en direct » — testables sans React ni DOM.
 * Ils ne manipulent que des statuts : jamais une clé, une URL ou un jeton.
 *
 * Règle Bassi (21/09) : plus jamais un « Non connecté » générique derrière un bouton mort.
 * Chaque plateforme a SON état et SA seule action possible :
 *  - Facebook / YouTube (OAuth réel)      : Connecter · Reconnecter · Configuration requise (+ diagnostic) ;
 *  - Instagram / TikTok (RTMPS + clé)     : Configurer · Configuré (Modifier / Supprimer) · Configuration requise.
 */
export type BroadcastStatus =
  | 'connected' | 'not_connected' | 'reauth' | 'unavailable'
  | 'config_required' | 'not_configured' | 'configured'
  | 'starting' | 'live' | 'error' | 'off';

export type BroadcastKind = 'oauth' | 'manual';

export interface StatutSource { status: BroadcastStatus; selected: boolean; error?: string; kind?: BroadcastKind; missing?: string[]; keyHint?: string | null }

/** Libellé lisible d'un statut — jamais de jargon, jamais de secret. */
export function libelleStatut(d: StatutSource, live: boolean): string {
  switch (d.status) {
    case 'live': return 'En direct';
    case 'starting': return 'Démarrage…';
    case 'error': return d.error ? `Échec — ${d.error}` : 'Échec';
    case 'reauth': return 'Reconnexion nécessaire';
    case 'unavailable': return 'Indisponible';
    case 'not_connected': return 'Non connecté';
    case 'config_required': return 'Configuration requise';
    case 'not_configured': return 'Non configuré';
    case 'configured': return live && !d.selected ? 'Non diffusé' : (d.keyHint ? `Configuré — clé enregistrée (…${d.keyHint})` : 'Configuré');
    case 'off': return 'Non diffusé';
    case 'connected': return live && !d.selected ? 'Non diffusé' : 'Connecté';
    default: return '';
  }
}

/** L'interrupteur n'a de sens que pour un compte relié (OAuth) ou configuré (RTMPS + clé), hors direct. */
export const selectionnable = (s: BroadcastStatus): boolean => s === 'connected' || s === 'configured';

/** Nombre de réseaux réellement démarrables (reliés ET cochés). */
export const nbSelectionnes = (ds: StatutSource[]): number => ds.filter((d) => d.selected && selectionnable(d.status)).length;

/** `HH:MM:SS` depuis des secondes. */
export function formatDuree(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h, m, r].map((n) => String(n).padStart(2, '0')).join(':');
}

/** La seule action pertinente d'une ligne, hors direct. `none` = rien à cliquer (jamais un bouton mort). */
export type ActionLigne =
  | { kind: 'oauth'; libelle: 'Connecter' | 'Reconnecter' }
  | { kind: 'configure'; libelle: 'Configurer' }
  | { kind: 'configured'; libelle: 'Modifier' }
  | { kind: 'diagnostic'; libelle: 'Configuration requise'; missing: string[] }
  | { kind: 'none' };

export function actionPour(d: StatutSource): ActionLigne {
  const kind: BroadcastKind = d.kind ?? 'oauth';
  switch (d.status) {
    case 'config_required': return { kind: 'diagnostic', libelle: 'Configuration requise', missing: d.missing ?? [] };
    case 'not_connected': return kind === 'oauth' ? { kind: 'oauth', libelle: 'Connecter' } : { kind: 'configure', libelle: 'Configurer' };
    case 'reauth': return kind === 'oauth' ? { kind: 'oauth', libelle: 'Reconnecter' } : { kind: 'configure', libelle: 'Configurer' };
    case 'not_configured': return { kind: 'configure', libelle: 'Configurer' };
    case 'configured': return { kind: 'configured', libelle: 'Modifier' };
    default: return { kind: 'none' };
  }
}

/** Texte du diagnostic : les NOMS des variables serveur à poser (jamais leurs valeurs). */
export function diagnosticConfig(missing: string[]): string {
  if (!missing.length) return 'Configuration serveur incomplète.';
  return `Variables serveur à poser (Coolify) : ${missing.join(', ')}`;
}

/** Explication courte, par plateforme, de la méthode de connexion — pas de promesse impossible. */
export function aideConnexion(platform: string, kind: BroadcastKind): string {
  if (kind === 'oauth') return platform === 'youtube'
    ? 'Connexion Google vers la chaîne YouTube Afroboost.'
    : 'Connexion Facebook vers la Page Afroboost.';
  return platform === 'tiktok'
    ? 'Copiez l’URL du serveur et la clé de diffusion depuis TikTok LIVE Studio (nouvelle clé à chaque direct).'
    : 'Copiez l’URL du serveur et la clé de diffusion depuis Instagram Live Producer (nouvelle clé à chaque direct).';
}

/** Validation de l'URL du serveur : RTMPS uniquement (le rtmp:// en clair est refusé), sans espace. */
export function validerUrlServeur(url: string): string | null {
  const u = (url || '').trim();
  if (!u) return 'Indiquez l’URL du serveur.';
  if (/^rtmp:\/\//i.test(u)) return 'Adresse en clair refusée : elle doit commencer par rtmps://';
  if (!/^rtmps:\/\/[^\s/:]+(:\d{1,5})?\/\S*$/i.test(u)) return 'URL invalide : attendu rtmps://serveur/application/';
  return null;
}

/** Validation de la clé : non vide, bornée, sans retour à la ligne. */
export function validerCle(cle: string): string | null {
  const c = (cle || '').trim();
  if (!c) return 'Collez la clé de diffusion.';
  if (c.length > 512) return 'Clé trop longue.';
  if (/[\r\n]/.test(c)) return 'La clé ne doit pas contenir de retour à la ligne.';
  return null;
}

/** Message affiché au retour d'un parcours OAuth (`#social=<plateforme>:<résultat>`), ou null. */
export function messageRetourOAuth(hash: string, libelles: Record<string, string>): { platform: string; texte: string; ok: boolean } | null {
  const m = /(?:^|[#&])social=([a-z]+):([a-z_]+)/i.exec(hash || '');
  if (!m) return null;
  const platform = m[1].toLowerCase(); const resultat = m[2].toLowerCase();
  const nom = libelles[platform] || platform;
  switch (resultat) {
    case 'connected': return { platform, ok: true, texte: `${nom} connecté au compte Afroboost.` };
    case 'refused': return { platform, ok: false, texte: `${nom} : ce compte n’est pas celui d’Afroboost — connexion refusée.` };
    case 'cancelled': return { platform, ok: false, texte: `${nom} : connexion annulée.` };
    case 'config_required': return { platform, ok: false, texte: `${nom} : configuration serveur requise.` };
    default: return { platform, ok: false, texte: `${nom} : la connexion n’a pas abouti.` };
  }
}
