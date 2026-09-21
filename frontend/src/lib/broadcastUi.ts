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
  | 'connected' | 'not_connected' | 'reauth' | 'unavailable' | 'restricted'
  | 'config_required' | 'not_configured' | 'configured'
  | 'starting' | 'live' | 'error' | 'off';

export type BroadcastKind = 'oauth' | 'manual';

export interface StatutSource {
  status: BroadcastStatus; selected: boolean; error?: string; kind?: BroadcastKind; missing?: string[]; keyHint?: string | null;
  platform?: string;
  /** Voies possibles côté serveur (21/09) : saisie RTMPS + clé (`manualOk`) et/ou parcours OAuth (`oauthOk`). */
  manualOk?: boolean; oauthOk?: boolean;
}

/** Libellé lisible d'un statut — jamais de jargon, jamais de secret. */
export function libelleStatut(d: StatutSource, live: boolean): string {
  switch (d.status) {
    case 'live': return 'En direct';
    case 'starting': return 'Démarrage…';
    case 'error': return d.error ? `Échec — ${d.error}` : 'Échec';
    case 'reauth': return 'Reconnexion nécessaire';
    case 'unavailable': return 'Indisponible';
    case 'restricted': return 'Accès réservé';
    case 'not_connected': return 'Non connecté';
    case 'config_required': return d.platform === 'facebook' && d.manualOk ? 'Configuration Meta requise' : 'Configuration requise';
    case 'not_configured': return d.platform === 'tiktok' ? 'Accès RTMP TikTok non activé sur ce compte' : 'Non configuré';
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
  | { kind: 'oauth'; libelle: 'Connecter' | 'Reconnecter' | 'Connecter avec Meta' }
  | { kind: 'configure'; libelle: 'Configurer' | 'Configurer manuellement' | 'J’ai une clé' }
  | { kind: 'configured'; libelle: 'Modifier' }
  | { kind: 'diagnostic'; libelle: 'Configuration requise' | 'Configuration Meta requise'; missing: string[] }
  | { kind: 'aide_encodeur'; libelle: 'Comment l’activer' }
  | { kind: 'reserve'; libelle: 'Accès réservé' }
  | { kind: 'none' };

export function actionPour(d: StatutSource): ActionLigne {
  const kind: BroadcastKind = d.kind ?? 'oauth';
  const facebook = d.platform === 'facebook';
  switch (d.status) {
    case 'config_required': return facebook && d.manualOk
      ? { kind: 'diagnostic', libelle: 'Configuration Meta requise', missing: d.missing ?? [] }
      : { kind: 'diagnostic', libelle: 'Configuration requise', missing: d.missing ?? [] };
    case 'restricted': return { kind: 'reserve', libelle: 'Accès réservé' };
    case 'not_connected': return kind === 'oauth' ? { kind: 'oauth', libelle: facebook ? 'Connecter avec Meta' : 'Connecter' } : { kind: 'configure', libelle: 'Configurer' };
    case 'reauth': return kind === 'oauth' ? { kind: 'oauth', libelle: 'Reconnecter' } : { kind: 'configure', libelle: 'Configurer' };
    // TikTok : la clé RTMP externe n'est pas prouvée disponible sur ce compte (LIVE Studio n'en fournit pas) →
    // la première action est l'EXPLICATION, jamais un « Configurer » qui mène à une impasse.
    case 'not_configured': return d.platform === 'tiktok' ? { kind: 'aide_encodeur', libelle: 'Comment l’activer' } : { kind: 'configure', libelle: 'Configurer' };
    case 'configured': return { kind: 'configured', libelle: 'Modifier' };
    default: return { kind: 'none' };
  }
}

/** Seconde voie, quand elle existe (21/09) :
 *  - Facebook : « Configurer manuellement » (URL RTMPS + clé de Live Producer) à côté de l'OAuth Meta — ou à sa
 *    place quand les variables Meta manquent — dès que le serveur sait chiffrer (`manualOk`) ;
 *  - TikTok : « J’ai une clé » derrière l'explication, pour celui qui a obtenu une vraie clé externe.
 *  YouTube : rien (mission : inchangé). */
export function actionSecondaire(d: StatutSource): ActionLigne | null {
  if (d.platform === 'facebook' && d.manualOk && (d.status === 'config_required' || d.status === 'not_connected' || d.status === 'reauth')) {
    return { kind: 'configure', libelle: 'Configurer manuellement' };
  }
  if (d.platform === 'tiktok' && d.status === 'not_configured') return { kind: 'configure', libelle: 'J’ai une clé' };
  return null;
}

/** TikTok : la cause exacte, prouvée le 21/09 sur le compte Afroboost (LIVE Center accessible, LIVE Studio
 *  téléchargeable, AUCUNE entrée « logiciel de streaming » sur le web). Ni promesse, ni bouton mort. */
export const AIDE_TIKTOK_ENCODEUR = 'TikTok doit d’abord autoriser la diffusion par logiciel externe pour ce compte. LIVE Studio (l’application TikTok) diffuse lui-même et ne fournit pas de clé. Quand TikTok l’active, l’URL du serveur et la clé apparaissent dans l’application TikTok : LIVE → PC/Mac → Logiciel de streaming. Vous les avez ? Utilisez « J’ai une clé ».';

/** Texte du diagnostic : les NOMS des variables serveur à poser (jamais leurs valeurs). */
export function diagnosticConfig(missing: string[]): string {
  if (!missing.length) return 'Configuration serveur incomplète.';
  return `Variables serveur à poser (Coolify) : ${missing.join(', ')}`;
}

/** Explication de l'accès réservé : la vraie raison (liste blanche serveur), jamais un « Indisponible » muet. */
export const EXPLICATION_ACCES_RESERVE = 'Ce compte n’est pas dans la liste blanche Afroboost du serveur (SOCIAL_ALLOWED_EMAILS). Aucun réseau ne peut être connecté avec cette identité.';

/** Explication courte, par plateforme, de la méthode de connexion — pas de promesse impossible. */
export function aideConnexion(platform: string, kind: BroadcastKind): string {
  if (kind === 'oauth') return platform === 'youtube'
    ? 'Connexion Google vers la chaîne YouTube Afroboost.'
    : 'Connexion Facebook vers la Page Afroboost.';
  if (platform === 'facebook') return 'Copiez l’URL du serveur et la clé de diffusion depuis Facebook Live Producer (Page Afroboost → Lancer un direct → Logiciel de streaming) ; nouvelle clé à chaque direct, sauf clé persistante.';
  return platform === 'tiktok'
    ? 'Copiez l’URL du serveur et la clé de diffusion fournies par TikTok (application TikTok → LIVE → PC/Mac → Logiciel de streaming) ; nouvelle clé à chaque direct.'
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
