import React from 'react';
import { Sparkles, X, RotateCw, Copy, CornerDownLeft, Check, MessageSquare, PenLine, Wand2, Eraser, Undo2,
  Minus, Plus, Mic, MicOff, Video, VideoOff, SwitchCamera, Disc, Square, PhoneOff, Bot, Play, Pause,
  FlipHorizontal2, Eye, EyeOff, Gauge, Type, ScrollText } from 'lucide-react';
import type { ModeSouffleur } from '@/lib/assistantHote';
import type { Prompteur as InstancePrompteur } from '@/hooks/usePrompteur';
import {
  ACTIONS_TEXTE, type ActionTexte, type EtatPrompteur, type QuestionEnAttente, type OngletPrompteur,
  libelleAttente, peutReprendre, heureQuestion,
} from '@/lib/prompteurSources';

/**
 * 📝 LE PROMPTEUR DE L'HÔTE — UN SEUL PANNEAU, privé, et gouverné par une seule règle :
 * l'IA propose, l'hôte décide.
 *
 * UN SEUL PANNEAU (refonte UX Live Visio). Il y avait trois surfaces pour un même
 * texte : l'accordéon de la colonne droite (`PanneauPrompteur`), le tiroir d'écriture
 * de la zone caméra (`TiroirPrompteur`) et ce panneau. Deux d'entre elles écrivaient
 * directement le script du hook, celle-ci le brouillon : deux vérités, et « Afficher »
 * écrasait ce qui avait été tapé ailleurs. Désormais tout vit ICI, en quatre onglets —
 * « Mon texte », « Thème IA », « Questions », « Assistant IA » — et les réglages de
 * lecture (lecture/pause, vitesse, taille, miroir, afficher sur la vidéo) passent par
 * l'instance PARTAGÉE `p` d'`usePrompteur`. Un seul éditeur, branché sur le brouillon.
 * `PanneauPrompteur` et `TiroirPrompteur` ne doivent plus être rendus.
 *
 * Trois sources alimentent le MÊME écran de lecture : le texte que l'hôte écrit
 * lui-même (qui marche sans IA, toujours), un thème que l'assistant l'aide à formuler,
 * et les questions du chat — seulement celles que le spectateur a marquées « Poser une
 * question ». Les états restent séparés — brouillon, texte affiché, suggestion en
 * attente — parce que les mélanger coûterait cher en direct : on ne fait pas
 * disparaître le texte qu'un coach est en train de lire face caméra parce qu'un
 * participant vient d'écrire.
 *
 * Aucun bouton d'ici n'envoie quoi que ce soit dans le chat. « Afficher » met le texte
 * sous les yeux de l'hôte, rien de plus. Aucune réponse automatique, aucune voix : une
 * suggestion n'entre dans « Mon texte » qu'après un clic sur « Utiliser ». Le
 * participant ne voit ni ce panneau, ni le brouillon, ni les suggestions, ni la file.
 *
 * PLEIN ÉCRAN. Avec `disposition="zone-camera"`, le panneau est une feuille compacte,
 * translucide, en `absolute` : à monter DANS la zone caméra (la cible du plein écran),
 * où il reste visible. Il ne masque pas tout l'hôte (55 % de hauteur au plus sur
 * mobile, 24rem de large sur grand écran) et défile en interne. C'est une surface DOM :
 * elle n'entre dans aucun MediaStream, aucun enregistrement, aucune diffusion.
 *
 * GARDER MONTÉ. La position de défilement de chaque onglet est mémorisée dans le
 * composant : le rendre toujours et piloter `open`, plutôt que `{open && <… />}`.
 *
 * Réserve honnête, écrite plutôt que tue : si l'hôte partage son ÉCRAN ENTIER au
 * niveau système, son écran contient ce panneau. Aucune application ne peut promettre
 * le contraire.
 */

export type { OngletPrompteur } from '@/lib/prompteurSources';

export interface PanneauPrompteurUniqueProps {
  open: boolean;
  /** Ferme le panneau (bouton ✕ et touche Échap). */
  onClose: () => void;
  mobile?: boolean;
  /**
   * `flottant` (défaut, historique) : `fixed`, au niveau de la page.
   * `zone-camera` : `absolute`, à rendre DANS le conteneur plein écran de la caméra.
   */
  disposition?: 'flottant' | 'zone-camera';
  /** Classes ajoutées à la racine (ex. décaler au-dessus d'une barre). */
  className?: string;
  /** L'assistant est-il allumé ? Éteint, aucune requête ne part — le texte manuel, lui, marche toujours. */
  actif: boolean;
  onBasculer: (a: boolean) => void;
  onglet: OngletPrompteur;
  onOnglet: (o: OngletPrompteur) => void;
  etat: EtatPrompteur;
  /** Thème saisi par l'hôte (onglet « Thème IA »). */
  theme: string;
  onTheme: (t: string) => void;
  enCours: boolean;
  indisponible: string | null;
  /** Personne actuellement à l'écran avec l'hôte (mode « en visio »). */
  invite: string | null;
  modeQuestion: ModeSouffleur;
  /** Optionnel : laisser l'hôte choisir le mode (sinon il reste automatique). */
  onModeQuestion?: (m: ModeSouffleur) => void;
  /**
   * L'instance PARTAGÉE d'`usePrompteur` — jamais une seconde. Donne les réglages de
   * lecture : lecture/pause, vitesse, taille, miroir.
   */
  p?: InstancePrompteur;
  /** Le texte est-il affiché SUR la vidéo (overlay) ? */
  surVideo?: boolean;
  onSurVideo?: (v: boolean) => void;
  // Actions
  /**
   * 🎛️ LES COMMANDES QU'ON NE DOIT JAMAIS PERDRE DE VUE.
   *
   * Sur mobile, le prompteur flottant est une feuille qui monte du bas : elle recouvre
   * la barre du Live. Ce ne sont PAS de nouveaux boutons : ce sont les mêmes rappels
   * que ceux de la barre, remontés à portée de pouce. Aucun second état, aucune
   * seconde logique. Optionnel : inutile quand la feuille laisse la barre visible.
   */
  controles?: {
    micActif: boolean;
    onMic?: () => void;
    cameraActive: boolean;
    onCamera?: () => void;
    onFlip?: () => void;
    enregistre: boolean;
    onRecord?: () => void;
    recordDisponible?: boolean;
    onTerminer?: () => void;
  };
  onEcrire: (t: string) => void;
  onAfficher: (source: 'manuel' | 'theme' | 'question') => void;
  onEffacer: () => void;
  onUtiliserSuggestion: () => void;
  onIgnorerSuggestion: () => void;
  onDemanderTexte: (action: ActionTexte) => void;
  /** Historique : sélection + préparation IA en un geste. Repli des deux suivants. */
  onOuvrirQuestion: (id: string) => void;
  /** Sélectionner une question de la file, SANS appeler l'IA. */
  onSelectionnerQuestion?: (id: string) => void;
  /** Afficher la question sélectionnée sur le prompteur (« Mon texte » intact). */
  onAfficherQuestion?: () => void;
  /** Demander à l'IA de PROPOSER une réponse à la question sélectionnée. */
  onPreparerReponse?: (id: string) => void;
  onAutreReponse: () => void;
  onReprendre: () => void;
  /** Taille du texte (A- / A+) — ignorés si `p` est fourni (il porte la taille). */
  taille?: number;
  onPlusPetit?: () => void;
  onPlusGrand?: () => void;
  /** Dépose dans le champ du chat — SANS envoyer. */
  onInsererChat?: (t: string) => void;
}

const MOTIFS: Record<string, string> = {
  ia_non_configuree: "Assistant indisponible : aucune clé IA configurée sur le serveur.",
  fournisseur_indisponible: "Assistant indisponible pour le moment. Ton texte manuel, lui, fonctionne toujours.",
  reponse_illisible: "Réponse inutilisable. Réessaie dans un instant.",
  texte_absent: "Écris d'abord ton thème ou ton texte.",
  hors_ligne: "Assistant indisponible : connexion interrompue.",
  reserve_hote: "Réservé à l'hôte de cette session.",
};

const BTN = 'min-h-[44px] px-3 py-2 rounded-lg text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1';
const BTN_PRIM = `${BTN} text-white`;
const BTN_SEC = `${BTN} text-white/75 border border-white/15 hover:text-white hover:bg-white/5`;
/** Cible tactile des réglages et de la fermeture : 44 px, au doigt comme à la souris. */
const BTN_TAILLE = 'w-11 h-11 flex items-center justify-center shrink-0';
const REGLAGE = `${BTN_TAILLE} rounded-lg border border-white/15 text-white/75 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed`;
const ONGLET_CLS = 'min-h-[44px] flex-1 min-w-0 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors';
/** Commandes du direct : mêmes rondes que la barre du Live, à portée de pouce. */
const ROND = 'w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-colors';
const SOMBRE = 'bg-white/10 text-white/80 hover:bg-white/15';
const VERT = 'bg-emerald-500/25 text-emerald-300 hover:bg-emerald-500/35';
const ACCENT_ROND = 'bg-[rgb(var(--bt-accent-rgb)/0.3)] text-[var(--bt-accent)]';
const DEGRADE = { background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' };
const BORD = 'border-[rgb(var(--bt-accent-rgb)/0.35)]';

const POSITIONS_VIDES: Record<OngletPrompteur, number> = { texte: 0, theme: 0, questions: 0, assistant: 0 };

export const AssistantHotePanel: React.FC<PanneauPrompteurUniqueProps> = ({
  open, onClose, mobile = false, disposition = 'flottant', className = '', actif, onBasculer, onglet, onOnglet,
  etat, theme, onTheme, enCours, indisponible, invite, modeQuestion, onModeQuestion, p, surVideo = false,
  onSurVideo, controles, onEcrire, onAfficher, onEffacer, onUtiliserSuggestion, onIgnorerSuggestion,
  onDemanderTexte, onOuvrirQuestion, onSelectionnerQuestion, onAfficherQuestion, onPreparerReponse,
  onAutreReponse, onReprendre, taille, onPlusPetit, onPlusGrand, onInsererChat,
}) => {
  const [copie, setCopie] = React.useState(false);
  React.useEffect(() => { if (!copie) return; const t = setTimeout(() => setCopie(false), 1400); return () => clearTimeout(t); }, [copie]);

  // 📜 UNE POSITION DE DÉFILEMENT PAR ONGLET. Le coach lit son thème, passe aux
  //    questions, revient : il retrouve sa ligne, pas le haut du panneau.
  const racineRef = React.useRef<HTMLDivElement | null>(null);
  const positions = React.useRef<Record<OngletPrompteur, number>>({ ...POSITIONS_VIDES });
  const ongletCourant = React.useRef<OngletPrompteur>(onglet);
  React.useLayoutEffect(() => {
    ongletCourant.current = onglet;
    const el = racineRef.current;
    if (el) el.scrollTop = positions.current[onglet] || 0;
  }, [onglet, open]);
  const surDefilement = () => {
    const el = racineRef.current;
    if (el) positions.current[ongletCourant.current] = el.scrollTop;
  };

  // À l'ouverture, le focus entre dans le panneau : Échap y est alors entendu.
  React.useEffect(() => {
    if (!open) return;
    try { racineRef.current?.focus({ preventScroll: true }); } catch { /* ancien navigateur */ }
  }, [open]);

  if (!open) return null;

  // Échap referme — sans jamais remonter à la page (qui quitterait le plein écran).
  const surTouche = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  };

  const tailleTexte = p ? p.taille : taille;
  const plusPetit = p ? p.plusPetit : onPlusPetit;
  const plusGrand = p ? p.plusGrand : onPlusGrand;
  const selectionner = onSelectionnerQuestion || onOuvrirQuestion;
  const preparer = onPreparerReponse || onOuvrirQuestion;

  const attente = libelleAttente(etat);
  const ONGLET = (cle: OngletPrompteur, libelle: string, icone: React.ReactNode, badge?: number) => (
    <button type="button" onClick={() => onOnglet(cle)} role="tab" aria-selected={onglet === cle}
      aria-controls="prompteur-panneau-onglet" id={`prompteur-tab-${cle}`}
      className={`${ONGLET_CLS} ${
        onglet === cle ? 'bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)]' : 'text-white/60 hover:text-white'}`}
      data-testid={`prompteur-onglet-${cle}`}>
      {icone}<span className="truncate">{libelle}</span>
      {!!badge && <span className="ml-0.5 px-1 rounded-full bg-[var(--bt-accent)] text-white text-[9px] leading-4">{badge}</span>}
    </button>
  );

  const zoneSuggestion = etat.suggestion ? (
    <div className="rounded-xl border border-[rgb(var(--bt-accent-rgb)/0.4)] bg-[rgb(var(--bt-accent-rgb)/0.08)] p-3 space-y-2" data-testid="prompteur-suggestion">
      <p className="text-[10px] font-bold tracking-wide text-[var(--bt-accent)]">SUGGESTION IA — PAS ENCORE UTILISÉE</p>
      {etat.questionActive && etat.origineSuggestion === 'question' && (
        <p className="text-[11px] text-white/50 leading-snug" data-testid="prompteur-question-active">
          {etat.questionActive.auteur} demande : « {etat.questionActive.texte} »
        </p>
      )}
      <p className="text-white text-sm leading-snug whitespace-pre-wrap">{etat.suggestion}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onUtiliserSuggestion} className={BTN_PRIM} style={DEGRADE}
          title="La suggestion devient ton brouillon — tu pourras la modifier avant de l'afficher"
          data-testid="prompteur-utiliser">
          <Check className="w-3.5 h-3.5" />Utiliser
        </button>
        <button type="button" onClick={onAutreReponse} className={`${BTN_SEC} disabled:opacity-40`} disabled={!actif || enCours} data-testid="prompteur-autre">
          <RotateCw className={`w-3.5 h-3.5${enCours ? ' animate-spin' : ''}`} />Autre proposition
        </button>
        <button type="button" onClick={onIgnorerSuggestion} className={BTN_SEC} data-testid="prompteur-ignorer">Ignorer</button>
      </div>
    </div>
  ) : null;

  // La source d'affichage n'est pas celle de l'ONGLET mais celle du BROUILLON : une
  // réponse prise dans « Questions » s'édite dans « Mon texte », et doit rester une
  // réponse — sinon elle écrase le thème sans retour possible.
  const editeur = (placeholder: string) => {
  const source = etat.origineBrouillon;
  return (
    <>
      <textarea
        value={etat.brouillon}
        onChange={(e) => onEcrire(e.target.value)}
        rows={mobile ? 4 : 6}
        placeholder={placeholder}
        aria-label="Mon texte"
        className="w-full resize-none px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-white text-base sm:text-sm leading-relaxed placeholder-white/30 focus:outline-none focus:border-[rgb(var(--bt-accent-rgb)/0.6)]"
        data-testid="prompteur-editeur"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onAfficher(source)} disabled={!etat.brouillon.trim()}
          className={`${BTN_PRIM} disabled:opacity-40`} style={DEGRADE}
          data-testid="prompteur-afficher">
          Afficher sur le prompteur
        </button>
        <button type="button" onClick={onEffacer} className={BTN_SEC} data-testid="prompteur-effacer">
          <Eraser className="w-3.5 h-3.5" />Effacer l'écran
        </button>
        {onInsererChat && (
          <button type="button" onClick={() => { onInsererChat(etat.brouillon); }}
            disabled={!etat.brouillon.trim()} className={`${BTN_SEC} disabled:opacity-40`}
            title="Dépose le texte dans le champ du chat — sans l'envoyer"
            data-testid="prompteur-inserer-chat">
            <CornerDownLeft className="w-3.5 h-3.5" />Insérer au chat
          </button>
        )}
      </div>
    </>
  );
  };

  const statutAssistant = !actif
    ? 'Éteint — aucune requête ne part. Ton texte manuel fonctionne toujours.'
    : enCours
      ? 'Préparation d’une proposition…'
      : indisponible
        ? (MOTIFS[indisponible] || MOTIFS.fournisseur_indisponible)
        : 'Prêt. Il propose ; c’est toi qui choisis, modifies et affiches.';

  const q = etat.questionActive;

  // zone-camera : posé AU-DESSUS de la barre Live unique (bas de la zone caméra) — jamais dessus.
  const classeRacine = disposition === 'zone-camera'
    ? (mobile
      ? `absolute inset-x-2 bottom-[4.75rem] z-[135] max-h-[min(55%,calc(100%-6rem))] overflow-y-auto overscroll-contain rounded-2xl border ${BORD} bg-black/65 backdrop-blur-md shadow-2xl`
      : `absolute right-3 bottom-[4.75rem] z-[135] w-[24rem] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-6rem)] overflow-y-auto overscroll-contain rounded-2xl border ${BORD} bg-black/65 backdrop-blur-md shadow-2xl`)
    // OÙ SE POSE LE PANNEAU FLOTTANT, ET POURQUOI PAS AILLEURS : à GAUCHE sur grand
    // écran (la colonne du Live reste visible et cliquable), et à z-[135] : la bulle
    // du chat vit à z-[130] et retombait pile sur les actions IA (vu à 390×844) ;
    // les modales (z-[140]) restent au-dessus.
    : (mobile
      ? `fixed inset-x-0 bottom-0 z-[135] max-h-[70vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t ${BORD} bg-black/90 backdrop-blur-md shadow-2xl`
      : `fixed left-4 bottom-24 z-[135] w-[380px] max-h-[74vh] overflow-y-auto overscroll-contain rounded-2xl border ${BORD} bg-black/90 backdrop-blur-md shadow-2xl`);

  return (
    <div
      ref={racineRef}
      tabIndex={-1}
      onKeyDown={surTouche}
      onScroll={surDefilement}
      className={`${classeRacine} outline-none ${className}`}
      role="dialog" aria-modal="false" aria-label="Prompteur privé de l'hôte" data-testid="assistant-hote-panneau"
      data-disposition={disposition}
    >
      {/* 🎛️ UN seul bloc collant : commandes du direct (si fournies) + en-tête.
          Deux en-têtes `sticky top-0` se superposaient : en défilant, « Fermer »
          passait sous l'autre et devenait intouchable. */}
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md" data-testid="prompteur-entete">
      {controles && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 border-b border-white/10"
          role="group" aria-label="Commandes du direct" data-testid="prompteur-barre-live">
          {controles.onMic && (
            <button type="button" onClick={controles.onMic} aria-pressed={controles.micActif}
              aria-label={controles.micActif ? 'Couper le micro' : 'Activer le micro'}
              className={`${ROND} ${controles.micActif ? VERT : SOMBRE}`} data-testid="prompteur-live-mic">
              {controles.micActif ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>
          )}
          {controles.onCamera && (
            <button type="button" onClick={controles.onCamera} aria-pressed={controles.cameraActive}
              aria-label={controles.cameraActive ? 'Éteindre la caméra' : 'Allumer la caméra'}
              className={`${ROND} ${controles.cameraActive ? VERT : SOMBRE}`} data-testid="prompteur-live-camera">
              {controles.cameraActive ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>
          )}
          {controles.onFlip && (
            <button type="button" onClick={controles.onFlip} aria-label="Changer de caméra (avant/arrière)"
              className={`${ROND} ${SOMBRE}`} data-testid="prompteur-live-flip">
              <SwitchCamera className="w-5 h-5" />
            </button>
          )}
          {controles.onRecord && (
            <button type="button" onClick={controles.recordDisponible === false ? undefined : controles.onRecord}
              disabled={controles.recordDisponible === false} aria-pressed={controles.enregistre}
              aria-label={controles.enregistre ? 'Arrêter l’enregistrement' : 'Démarrer l’enregistrement'}
              className={`${ROND} ${controles.enregistre ? ACCENT_ROND : SOMBRE}${controles.recordDisponible === false ? ' opacity-40 cursor-not-allowed' : ''}`}
              data-testid="prompteur-live-record">
              {controles.enregistre ? <Square className="w-5 h-5" /> : <Disc className="w-5 h-5" />}
            </button>
          )}
          {controles.onTerminer && (
            <button type="button" onClick={controles.onTerminer} aria-label="Terminer le Live"
              className={`${ROND} bg-red-500/20 text-red-300 hover:bg-red-500/30`} data-testid="prompteur-live-terminer">
              <PhoneOff className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pl-4 pr-2 py-1.5 border-b border-white/10">
        <ScrollText className="w-4 h-4 shrink-0" style={{ color: 'var(--bt-accent)' }} aria-hidden="true" />
        <span className="text-white text-sm font-semibold flex-1">Prompteur</span>
        {/* L'état de l'IA se lit d'un coup d'œil ; le toucher mène à l'onglet où
            l'on l'allume ou l'éteint. */}
        <button type="button" onClick={() => onOnglet('assistant')}
          aria-label={`Assistant IA ${actif ? 'activé' : 'éteint'} — ouvrir ses réglages`}
          className={`min-h-[44px] px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 ${
            actif ? 'text-[var(--bt-accent)]' : 'text-white/50'}`}
          data-testid="prompteur-ia-etat">
          <Sparkles className="w-3.5 h-3.5" />IA {actif ? 'activée' : 'éteinte'}
        </button>
        <button type="button" onClick={onClose} aria-label="Fermer le prompteur"
          className={`${BTN_TAILLE} rounded-lg text-white/60 hover:text-white`} data-testid="assistant-fermer"><X className="w-5 h-5" /></button>
      </div>
      </div>

      {/* 🎚️ LECTURE — ce qui est à l'écran, et comment ça défile. Toujours visible,
          quel que soit l'onglet : on règle sa lecture sans perdre ce qu'on écrit. */}
      <section className="mx-3 mt-3 rounded-xl border border-white/10 bg-white/5 p-3" aria-label="Lecture du prompteur"
        data-testid={etat.affiche ? 'prompteur-affiche' : 'prompteur-vide'}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold tracking-wide text-white/45 flex-1">AU PROMPTEUR</span>
          {typeof tailleTexte === 'number' && <span className="text-[10px] text-white/40 tabular-nums">{tailleTexte} px</span>}
        </div>
        {etat.affiche ? (
          <p className="text-white/85 text-sm leading-relaxed line-clamp-3 whitespace-pre-wrap">{etat.affiche}</p>
        ) : (
          <p className="text-white/45 text-sm">Rien à l'écran. Écris dans « Mon texte », puis « Afficher ».</p>
        )}
        {peutReprendre(etat) && (
          <button type="button" onClick={onReprendre} className={`${BTN_SEC} mt-2`} data-testid="prompteur-reprendre">
            <Undo2 className="w-3.5 h-3.5" />Reprendre mon thème
          </button>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Réglages de lecture">
          {p && (
            <button type="button" onClick={p.basculerLecture} disabled={!p.script.trim()}
              aria-label={p.enLecture ? 'Mettre le prompteur en pause' : 'Faire défiler le prompteur'}
              className={`${BTN_TAILLE} rounded-full text-white disabled:opacity-40 disabled:cursor-not-allowed`}
              style={p.script.trim() ? DEGRADE : { background: 'rgba(255,255,255,0.12)' }}
              data-testid="prompteur-lecture-play">
              {p.enLecture ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
          )}
          {p && (
            <span className="inline-flex items-center gap-0.5" role="group" aria-label="Vitesse de défilement">
              <button type="button" onClick={p.moinsVite} disabled={p.vitesse <= p.bornes.vitesseMin}
                aria-label="Réduire la vitesse" className={REGLAGE} data-testid="prompteur-vitesse-moins"><Minus className="w-4 h-4" /></button>
              <span className="min-w-[2.6rem] text-center text-[11px] tabular-nums text-white/75 inline-flex items-center justify-center gap-0.5">
                <Gauge className="w-3 h-3" aria-hidden="true" />{p.vitesse.toFixed(2).replace(/0$/, '')}×
              </span>
              <button type="button" onClick={p.plusVite} disabled={p.vitesse >= p.bornes.vitesseMax}
                aria-label="Augmenter la vitesse" className={REGLAGE} data-testid="prompteur-vitesse-plus"><Plus className="w-4 h-4" /></button>
            </span>
          )}
          {plusPetit && plusGrand && (
            <span className="inline-flex items-center gap-0.5" role="group" aria-label="Taille du texte">
              {/* A- / A+ : 44 px. La première version tenait dans 20 px — intouchable
                  sur un téléphone posé au sol pendant un cours. */}
              <button type="button" onClick={plusPetit} aria-label="Réduire le texte du prompteur"
                disabled={!!p && p.taille <= p.bornes.tailleMin}
                className={REGLAGE} data-testid="prompteur-a-moins"><Minus className="w-4 h-4" /></button>
              <Type className="w-3.5 h-3.5 text-white/50" aria-hidden="true" />
              <button type="button" onClick={plusGrand} aria-label="Agrandir le texte du prompteur"
                disabled={!!p && p.taille >= p.bornes.tailleMax}
                className={REGLAGE} data-testid="prompteur-a-plus"><Plus className="w-4 h-4" /></button>
            </span>
          )}
          {p && (
            <button type="button" onClick={() => p.setMiroir((m) => !m)} aria-pressed={p.miroir}
              aria-label="Miroir du texte" title="Miroir — n'inverse que l'affichage du texte"
              className={`${REGLAGE} ${p.miroir ? 'text-[var(--bt-accent)] border-[rgb(var(--bt-accent-rgb)/0.5)]' : ''}`}
              data-testid="prompteur-miroir"><FlipHorizontal2 className="w-4 h-4" /></button>
          )}
          {onSurVideo && (
            <button type="button" onClick={() => onSurVideo(!surVideo)} aria-pressed={surVideo}
              aria-label={surVideo ? 'Masquer le texte sur ma vidéo' : 'Afficher le texte sur ma vidéo'}
              title="Le texte sur ta vidéo n'est visible que par toi"
              className={`${REGLAGE} ${surVideo ? 'text-[var(--bt-accent)] border-[rgb(var(--bt-accent-rgb)/0.5)]' : ''}`}
              data-testid="prompteur-sur-video">
              {surVideo ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          )}
        </div>
      </section>

      <div className="flex gap-1 mx-3 mt-3 p-1 rounded-xl bg-white/5" role="tablist" aria-label="Sources du prompteur">
        {ONGLET('texte', 'Mon texte', <PenLine className="w-3.5 h-3.5 shrink-0" />)}
        {ONGLET('theme', 'Thème IA', <Wand2 className="w-3.5 h-3.5 shrink-0" />)}
        {ONGLET('questions', 'Questions', <MessageSquare className="w-3.5 h-3.5 shrink-0" />, etat.file.length)}
        {ONGLET('assistant', 'Assistant IA', <Bot className="w-3.5 h-3.5 shrink-0" />)}
      </div>

      {attente && onglet !== 'questions' && (
        <p className="px-4 pt-2 text-[11px] text-[var(--bt-accent)] flex items-center gap-1" role="status" data-testid="prompteur-attente">
          <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />{attente}
        </p>
      )}
      {indisponible && onglet !== 'assistant' && (
        <p className="px-4 pt-2 text-[11px] text-amber-300/80" role="status" data-testid="assistant-indisponible">
          {MOTIFS[indisponible] || MOTIFS.fournisseur_indisponible}
        </p>
      )}

      <div className="px-3 py-3 space-y-3" role="tabpanel" id="prompteur-panneau-onglet" aria-labelledby={`prompteur-tab-${onglet}`}>
        {onglet === 'texte' && (
          <>
            {editeur('Écris ici ce que tu veux dire pendant ton Live…')}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ACTIONS_TEXTE.filter((a) => a.cle !== 'theme').map((a) => (
                <button key={a.cle} type="button" onClick={() => onDemanderTexte(a.cle)}
                  disabled={!actif || enCours || !etat.brouillon.trim()}
                  className={`${BTN_SEC} disabled:opacity-35`} data-testid={`prompteur-action-${a.cle}`}>{a.libelle}</button>
              ))}
            </div>
            {zoneSuggestion}
            <button type="button" onClick={() => { try { navigator.clipboard.writeText(etat.brouillon); setCopie(true); } catch { /* refusé */ } }}
              disabled={!etat.brouillon.trim()} className={`${BTN_SEC} w-full disabled:opacity-40`} data-testid="prompteur-copier">
              {copie ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{copie ? 'Copié' : 'Copier'}
            </button>
          </>
        )}

        {onglet === 'theme' && (
          <>
            <label className="block text-[11px] text-white/55" htmlFor="prompteur-theme">Mon thème</label>
            <input id="prompteur-theme" value={theme} onChange={(e) => onTheme(e.target.value)}
              placeholder="Les bienfaits de la danse afro sur le mental"
              className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-white text-base sm:text-sm placeholder-white/30 focus:outline-none focus:border-[rgb(var(--bt-accent-rgb)/0.6)]"
              data-testid="prompteur-theme-champ" />
            <button type="button" onClick={() => onDemanderTexte('theme')} disabled={!actif || enCours || !theme.trim()}
              className={`${BTN_PRIM} disabled:opacity-40`} style={DEGRADE}
              data-testid="prompteur-rediger">
              <Wand2 className={`w-3.5 h-3.5${enCours ? ' animate-spin' : ''}`} />Aide-moi à rédiger
            </button>
            {!actif && <p className="text-[11px] text-white/45">Allume l'assistant dans l'onglet « Assistant IA » pour qu'il propose une formulation.</p>}
            {zoneSuggestion}
            <p className="text-[11px] text-white/40 pt-1">La proposition n'arrive dans « Mon texte » qu'après « Utiliser » : tu la modifies avant de l'afficher.</p>
          </>
        )}

        {onglet === 'questions' && (
          <>
            {q && (
              <div className="rounded-xl border border-[rgb(var(--bt-accent-rgb)/0.45)] bg-white/5 p-3 space-y-2" data-testid="prompteur-question-selectionnee">
                <p className="text-[11px] text-white/55">
                  <span className="text-[var(--bt-accent)] font-semibold">{q.auteur}</span>
                  {heureQuestion(q.ts) && <span className="tabular-nums"> · {heureQuestion(q.ts)}</span>}
                </p>
                <p className="text-white text-sm leading-snug whitespace-pre-wrap">{q.texte}</p>
                <div className="flex flex-wrap gap-2">
                  {onAfficherQuestion && (
                    <button type="button" onClick={onAfficherQuestion} className={BTN_SEC}
                      title="Pose la question à l'écran pour la lire — « Mon texte » n'est pas touché"
                      data-testid="prompteur-question-afficher">
                      <ScrollText className="w-3.5 h-3.5" />Afficher sur le prompteur
                    </button>
                  )}
                  <button type="button" onClick={() => preparer(q.id)} disabled={!actif || enCours}
                    className={`${BTN_PRIM} disabled:opacity-40`} style={DEGRADE}
                    title="L'IA propose une réponse — rien n'est envoyé ni affiché sans ton clic"
                    data-testid="prompteur-question-preparer">
                    <Wand2 className={`w-3.5 h-3.5${enCours ? ' animate-spin' : ''}`} />Préparer une réponse
                  </button>
                </div>
                {!actif && <p className="text-[11px] text-white/45">Allume l'assistant (onglet « Assistant IA ») pour préparer une réponse.</p>}
              </div>
            )}
            {zoneSuggestion}
            {!etat.file.length && !q && (
              <p className="text-white/50 text-sm" data-testid="prompteur-aucune-question">
                Aucune question en attente. Seuls les messages envoyés avec « Poser une question » arrivent ici.
              </p>
            )}
            {!!etat.file.length && (
              <ul className="space-y-2" aria-label="Questions en attente">
                {etat.file.map((x: QuestionEnAttente) => (
                  <li key={x.id} data-testid="prompteur-question-file">
                    <button type="button" onClick={() => selectionner(x.id)}
                      aria-label={`Sélectionner la question de ${x.auteur}`}
                      className="w-full min-h-[44px] text-left rounded-xl border border-white/10 bg-white/5 p-2.5 hover:bg-white/10"
                      data-testid="prompteur-question-selectionner">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[11px] text-[var(--bt-accent)] font-semibold flex-1 truncate">{x.auteur}</span>
                        {heureQuestion(x.ts) && <span className="text-[10px] text-white/45 tabular-nums">{heureQuestion(x.ts)}</span>}
                      </span>
                      <span className="block text-white/80 text-sm leading-snug">{x.texte}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {onglet === 'assistant' && (
          <>
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-white/80 leading-snug" role="status" data-testid="assistant-etat">{statutAssistant}</p>
              <button type="button" onClick={() => onBasculer(!actif)} role="switch" aria-checked={actif}
                aria-label={actif ? "Éteindre l'assistant IA" : "Allumer l'assistant IA"}
                className={`min-h-[44px] px-3 rounded-full text-xs font-semibold border transition-colors ${
                  actif ? 'border-[var(--bt-accent)] text-[var(--bt-accent)] bg-[rgb(var(--bt-accent-rgb)/0.12)]' : 'border-white/20 text-white/60'}`}
                data-testid="assistant-bascule">
                IA {actif ? 'activée' : 'éteinte'}
              </button>
            </div>
            <div>
              <p className="text-[11px] text-white/55 mb-1">Mode des propositions</p>
              {onModeQuestion ? (
                <div className="flex gap-1 p-1 rounded-xl bg-white/5" role="radiogroup" aria-label="Mode des propositions">
                  {(['chat', 'visio'] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={modeQuestion === m}
                      onClick={() => onModeQuestion(m)} disabled={m === 'visio' && !invite}
                      className={`${ONGLET_CLS} disabled:opacity-35 ${modeQuestion === m ? 'bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)]' : 'text-white/60'}`}
                      data-testid={`assistant-mode-${m}`}>
                      {m === 'chat' ? 'Répondre au chat' : 'Échanger en visio'}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-white/75" data-testid="assistant-mode">
                  {modeQuestion === 'visio' ? '« En visio » — questions pour la personne à l’écran' : '« Chat » — réponses aux questions du chat'}
                </p>
              )}
              {invite && <p className="text-[11px] text-white/45 pt-1">À l'écran avec toi : {invite}.</p>}
            </div>
            <ul className="text-[11px] leading-snug text-white/45 list-disc pl-4 space-y-0.5">
              <li>L'IA propose seulement : aucun envoi, aucune réponse automatique, aucune voix.</li>
              <li>Une proposition n'entre dans « Mon texte » qu'après « Utiliser », et n'est à l'écran qu'après « Afficher ».</li>
              <li>Visible par toi seul. Seuls les prénoms et les phrases du chat sont envoyés à l'IA.</li>
            </ul>
          </>
        )}
      </div>
      <div style={{ height: mobile ? 'max(0.5rem, env(safe-area-inset-bottom))' : '0.25rem' }} aria-hidden="true" />
    </div>
  );
};

/** Nom explicite du panneau unique — même composant. */
export const PanneauPrompteurUnique = AssistantHotePanel;

export default AssistantHotePanel;
