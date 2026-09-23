import React from 'react';
import { Sparkles, X, RotateCw, Copy, CornerDownLeft, Check, MessageSquare, PenLine, Wand2, Eraser, Undo2, Minus, Plus } from 'lucide-react';
import type { ModeSouffleur } from '@/lib/assistantHote';
import {
  ACTIONS_TEXTE, type ActionTexte, type EtatPrompteur, type QuestionEnAttente,
  libelleAttente, peutReprendre,
} from '@/lib/prompteurSources';

/**
 * 📝 LE PROMPTEUR DE L'HÔTE — privé, et gouverné par une seule règle : l'IA propose,
 * l'hôte décide.
 *
 * Trois sources alimentent le MÊME écran de lecture : le texte que l'hôte écrit
 * lui-même (qui marche sans IA, toujours), un thème que l'assistant l'aide à formuler,
 * et les réponses aux questions du chat. Les états restent séparés — brouillon, texte
 * affiché, suggestion en attente — parce que les mélanger coûterait cher en direct :
 * on ne fait pas disparaître le texte qu'un coach est en train de lire face caméra
 * parce qu'un participant vient d'écrire.
 *
 * Aucun bouton d'ici n'envoie quoi que ce soit dans le chat. « Afficher » met le texte
 * sous les yeux de l'hôte, rien de plus. Le participant ne voit ni ce panneau, ni le
 * brouillon, ni les suggestions, ni la file d'attente.
 *
 * Réserve honnête, écrite plutôt que tue : si l'hôte partage son ÉCRAN ENTIER au
 * niveau système, son écran contient ce panneau. Aucune application ne peut promettre
 * le contraire.
 */

export type OngletPrompteur = 'texte' | 'theme' | 'questions';

interface Props {
  open: boolean;
  onClose: () => void;
  mobile?: boolean;
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
  // Actions
  onEcrire: (t: string) => void;
  onAfficher: (source: 'manuel' | 'theme' | 'question') => void;
  onEffacer: () => void;
  onUtiliserSuggestion: () => void;
  onIgnorerSuggestion: () => void;
  onDemanderTexte: (action: ActionTexte) => void;
  onOuvrirQuestion: (id: string) => void;
  onAutreReponse: () => void;
  onReprendre: () => void;
  /** Taille du texte du prompteur (A- / A+) — les réglages du prompteur existant. */
  taille: number;
  onPlusPetit: () => void;
  onPlusGrand: () => void;
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

const BTN = 'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors';
const BTN_PRIM = `${BTN} text-white`;
const BTN_SEC = `${BTN} text-white/70 border border-white/15 hover:text-white`;
/** Cible tactile des réglages de taille : 36 px au doigt, 28 px à la souris. */
const BTN_TAILLE = 'w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center shrink-0';

export const AssistantHotePanel: React.FC<Props> = ({
  open, onClose, mobile = false, actif, onBasculer, onglet, onOnglet, etat, theme, onTheme,
  enCours, indisponible, invite, modeQuestion, onEcrire, onAfficher, onEffacer,
  onUtiliserSuggestion, onIgnorerSuggestion, onDemanderTexte, onOuvrirQuestion,
  onAutreReponse, onReprendre, taille, onPlusPetit, onPlusGrand, onInsererChat,
}) => {
  const [copie, setCopie] = React.useState(false);
  React.useEffect(() => { if (!copie) return; const t = setTimeout(() => setCopie(false), 1400); return () => clearTimeout(t); }, [copie]);
  if (!open) return null;

  const attente = libelleAttente(etat);
  const ONGLET = (cle: OngletPrompteur, libelle: string, icone: React.ReactNode, badge?: number) => (
    <button type="button" onClick={() => onOnglet(cle)} aria-pressed={onglet === cle}
      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
        onglet === cle ? 'bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)]' : 'text-white/55 hover:text-white'}`}
      data-testid={`prompteur-onglet-${cle}`}>
      {icone}{libelle}
      {!!badge && <span className="ml-0.5 px-1 rounded-full bg-[var(--bt-accent)] text-white text-[9px] leading-4">{badge}</span>}
    </button>
  );

  const zoneSuggestion = etat.suggestion ? (
    <div className="rounded-xl border border-[rgb(var(--bt-accent-rgb)/0.4)] bg-[rgb(var(--bt-accent-rgb)/0.08)] p-3 space-y-2" data-testid="prompteur-suggestion">
      <p className="text-[10px] font-bold tracking-wide text-[var(--bt-accent)]">NOUVELLE SUGGESTION IA</p>
      {etat.questionActive && (
        <p className="text-[11px] text-white/45 leading-snug" data-testid="prompteur-question-active">
          {etat.questionActive.auteur} demande : « {etat.questionActive.texte} »
        </p>
      )}
      <p className="text-white text-sm leading-snug whitespace-pre-wrap">{etat.suggestion}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onUtiliserSuggestion} className={BTN_PRIM}
          style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
          title="La suggestion devient ton brouillon — tu pourras la modifier avant de l'afficher"
          data-testid="prompteur-utiliser">
          <Check className="w-3.5 h-3.5 inline mr-1" />Utiliser dans le prompteur
        </button>
        <button type="button" onClick={onAutreReponse} className={BTN_SEC} disabled={!actif || enCours} data-testid="prompteur-autre">
          <RotateCw className={`w-3.5 h-3.5 inline mr-1${enCours ? ' animate-spin' : ''}`} />Autre proposition
        </button>
        <button type="button" onClick={onIgnorerSuggestion} className={BTN_SEC} data-testid="prompteur-ignorer">Ignorer</button>
      </div>
    </div>
  ) : null;

  // La source d'affichage n'est pas celle de l'ONGLET mais celle du BROUILLON : une
  // réponse prise dans « Questions » s'édite dans « Mon texte », et doit rester une
  // réponse — sinon elle écrase le thème sans retour possible.
  const editeur = (placeholder: string, _source: 'manuel' | 'theme') => {
  const source = etat.origineBrouillon;
  return (
    <>
      <textarea
        value={etat.brouillon}
        onChange={(e) => onEcrire(e.target.value)}
        rows={mobile ? 4 : 6}
        placeholder={placeholder}
        className="w-full resize-none px-3 py-2 rounded-xl bg-white/8 border border-white/10 text-white text-sm leading-relaxed placeholder-white/25 focus:outline-none focus:border-[rgb(var(--bt-accent-rgb)/0.6)]"
        data-testid="prompteur-editeur"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onAfficher(source)} disabled={!etat.brouillon.trim()}
          className={`${BTN_PRIM} disabled:opacity-40`}
          style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
          data-testid="prompteur-afficher">
          Afficher sur le prompteur
        </button>
        <button type="button" onClick={onEffacer} className={BTN_SEC} data-testid="prompteur-effacer">
          <Eraser className="w-3.5 h-3.5 inline mr-1" />Effacer
        </button>
        {onInsererChat && (
          <button type="button" onClick={() => { onInsererChat(etat.brouillon); }}
            disabled={!etat.brouillon.trim()} className={`${BTN_SEC} disabled:opacity-40`}
            title="Dépose le texte dans le champ du chat — sans l'envoyer"
            data-testid="prompteur-inserer-chat">
            <CornerDownLeft className="w-3.5 h-3.5 inline mr-1" />Insérer au chat
          </button>
        )}
      </div>
    </>
  );
  };

  return (
    <div
      // z-[135] et non z-[130] : la bulle flottante du chat de session vit à z-[130]
      // et retombait PILE sur la rangée « Continuer / Raccourcir / Développer / Plus
      // naturel ». Vu sur une capture 390×844, pas déduit. Les modales (z-[140])
      // restent au-dessus, comme il faut.
      className={mobile
        ? 'fixed inset-x-0 bottom-0 z-[135] max-h-[82vh] overflow-y-auto rounded-t-2xl border-t border-[rgb(var(--bt-accent-rgb)/0.35)] bg-[#15151b] shadow-2xl'
        : 'fixed right-4 bottom-24 z-[135] w-[380px] max-h-[74vh] overflow-y-auto rounded-2xl border border-[rgb(var(--bt-accent-rgb)/0.35)] bg-[#15151b] shadow-2xl'}
      role="dialog" aria-label="Prompteur privé de l'hôte" data-testid="assistant-hote-panneau"
    >
      <div className="sticky top-0 flex items-center gap-2 px-4 py-3 bg-[#15151b] border-b border-white/10">
        <Sparkles className="w-4 h-4" style={{ color: 'var(--bt-accent)' }} aria-hidden="true" />
        <span className="text-white text-sm font-semibold flex-1">Prompteur</span>
        <button type="button" onClick={() => onBasculer(!actif)} aria-pressed={actif}
          aria-label={actif ? "Éteindre l'assistant IA" : "Allumer l'assistant IA"}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
            actif ? 'border-[var(--bt-accent)] text-[var(--bt-accent)] bg-[rgb(var(--bt-accent-rgb)/0.12)]' : 'border-white/20 text-white/50'}`}
          data-testid="assistant-bascule">
          IA {actif ? 'activée' : 'éteinte'}
        </button>
        <button type="button" onClick={onClose} aria-label="Fermer le prompteur"
          className={`${BTN_TAILLE} rounded-lg text-white/50 hover:text-white`} data-testid="assistant-fermer"><X className="w-4 h-4" /></button>
      </div>

      <p className="px-4 pt-3 text-[11px] leading-snug text-white/40">
        Visible par toi seul. L'IA propose — c'est toujours toi qui écris, qui affiches et qui parles.
      </p>

      {/* Texte actuellement à l'antenne + réglages de lecture */}
      {etat.affiche ? (
        <div className="mx-4 mt-3 rounded-xl border border-white/10 bg-white/5 p-3" data-testid="prompteur-affiche">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-wide text-white/40 flex-1">AU PROMPTEUR</span>
            <span className="text-[10px] text-white/35 tabular-nums">{taille} px</span>
            {/* A- / A+ : 36 px au doigt, 28 px à la souris. La première version tenait
                dans 20 px — invisible à l'usage, et intouchable sur un téléphone posé
                au sol pendant un cours. Mesuré au banc, pas estimé. */}
            <button type="button" onClick={onPlusPetit} aria-label="Réduire le texte du prompteur"
              className={`${BTN_TAILLE} rounded-lg border border-white/15 text-white/70 hover:text-white`} data-testid="prompteur-a-moins"><Minus className="w-4 h-4" /></button>
            <button type="button" onClick={onPlusGrand} aria-label="Agrandir le texte du prompteur"
              className={`${BTN_TAILLE} rounded-lg border border-white/15 text-white/70 hover:text-white`} data-testid="prompteur-a-plus"><Plus className="w-4 h-4" /></button>
          </div>
          <p className="text-white/75 text-xs leading-snug line-clamp-3 whitespace-pre-wrap">{etat.affiche}</p>
          {peutReprendre(etat) && (
            <button type="button" onClick={onReprendre} className={`${BTN_SEC} mt-2`} data-testid="prompteur-reprendre">
              <Undo2 className="w-3.5 h-3.5 inline mr-1" />Reprendre mon thème
            </button>
          )}
        </div>
      ) : null}

      <div className="flex gap-1 mx-4 mt-3 p-1 rounded-xl bg-white/5">
        {ONGLET('texte', 'Mon texte', <PenLine className="w-3.5 h-3.5" />)}
        {ONGLET('theme', 'Thème IA', <Wand2 className="w-3.5 h-3.5" />)}
        {ONGLET('questions', 'Questions', <MessageSquare className="w-3.5 h-3.5" />, etat.file.length)}
      </div>

      {attente && onglet !== 'questions' && (
        <p className="px-4 pt-2 text-[11px] text-[var(--bt-accent)]" role="status" data-testid="prompteur-attente">💬 {attente}</p>
      )}
      {indisponible && (
        <p className="px-4 pt-2 text-[11px] text-amber-300/80" role="status" data-testid="assistant-indisponible">
          {MOTIFS[indisponible] || MOTIFS.fournisseur_indisponible}
        </p>
      )}

      <div className="px-4 py-3 space-y-3">
        {onglet === 'texte' && (
          <>
            {editeur('Écris ici ce que tu veux dire pendant ton Live…', 'manuel')}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ACTIONS_TEXTE.filter((a) => a.cle !== 'theme').map((a) => (
                <button key={a.cle} type="button" onClick={() => onDemanderTexte(a.cle)}
                  disabled={!actif || enCours || !etat.brouillon.trim()}
                  className={`${BTN_SEC} disabled:opacity-35`} data-testid={`prompteur-action-${a.cle}`}>{a.libelle}</button>
              ))}
            </div>
            {zoneSuggestion}
          </>
        )}

        {onglet === 'theme' && (
          <>
            <label className="block text-[11px] text-white/50" htmlFor="prompteur-theme">Mon thème</label>
            <input id="prompteur-theme" value={theme} onChange={(e) => onTheme(e.target.value)}
              placeholder="Les bienfaits de la danse afro sur le mental"
              className="w-full px-3 py-2 rounded-xl bg-white/8 border border-white/10 text-white text-sm placeholder-white/25 focus:outline-none focus:border-[rgb(var(--bt-accent-rgb)/0.6)]"
              data-testid="prompteur-theme-champ" />
            <button type="button" onClick={() => onDemanderTexte('theme')} disabled={!actif || enCours || !theme.trim()}
              className={`${BTN_PRIM} disabled:opacity-40`}
              style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
              data-testid="prompteur-rediger">
              <Wand2 className={`w-3.5 h-3.5 inline mr-1${enCours ? ' animate-spin' : ''}`} />Aide-moi à rédiger
            </button>
            {zoneSuggestion}
            <p className="text-[11px] text-white/35 pt-1">La proposition arrive dans « Mon texte » : tu la modifies avant de l'afficher.</p>
          </>
        )}

        {onglet === 'questions' && (
          <>
            {etat.questionActive && (
              <p className="text-[11px] text-white/45 leading-snug">
                {etat.questionActive.auteur} demande : « {etat.questionActive.texte} »
              </p>
            )}
            {zoneSuggestion}
            {!etat.file.length && !etat.suggestion && (
              <p className="text-white/45 text-sm" data-testid="prompteur-aucune-question">
                {actif ? 'Aucune question en attente.' : "Assistant éteint : allume-le pour préparer des réponses."}
              </p>
            )}
            {etat.file.map((q: QuestionEnAttente) => (
              <button key={q.id} type="button" onClick={() => onOuvrirQuestion(q.id)}
                className="w-full text-left rounded-xl border border-white/10 bg-white/5 p-2.5 hover:bg-white/10"
                data-testid="prompteur-question-file">
                <span className="block text-[11px] text-[var(--bt-accent)] font-semibold">{q.auteur}</span>
                <span className="block text-white/75 text-xs leading-snug">{q.texte}</span>
              </button>
            ))}
            {invite && <p className="text-[11px] text-white/35 pt-1">À l'écran avec toi : {invite} — mode {modeQuestion === 'visio' ? '« en visio »' : '« chat »'}.</p>}
          </>
        )}
      </div>

      <div className="px-4 pb-4 flex gap-2" style={{ paddingBottom: mobile ? 'max(1rem, env(safe-area-inset-bottom))' : undefined }}>
        <button type="button" onClick={() => { try { navigator.clipboard.writeText(etat.brouillon); setCopie(true); } catch { /* refusé */ } }}
          disabled={!etat.brouillon.trim()} className={`${BTN_SEC} flex-1 disabled:opacity-40`} data-testid="prompteur-copier">
          {copie ? <Check className="w-3.5 h-3.5 inline mr-1" /> : <Copy className="w-3.5 h-3.5 inline mr-1" />}{copie ? 'Copié' : 'Copier'}
        </button>
      </div>
    </div>
  );
};

export default AssistantHotePanel;
