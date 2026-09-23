import React from 'react';
import { Sparkles, X, RotateCw, Copy, CornerDownLeft, Check, MessageSquare, Video } from 'lucide-react';
import type { ModeSouffleur } from '@/lib/assistantHote';

/**
 * 🤖 LE SOUFFLEUR — panneau PRIVÉ de l'hôte pendant le direct.
 *
 * CE QU'IL NE FAIT PAS, et c'est le plus important : il n'envoie rien. Aucun bouton ici
 * ne publie un message. « Insérer » dépose le texte dans le champ du chat de l'hôte —
 * qui relit, corrige s'il veut, et envoie lui-même. Il n'y a volontairement aucun
 * chemin, même caché, entre une suggestion et un message publié.
 *
 * CE QUI N'EN SORT PAS : ce panneau n'est rendu que chez l'hôte, il ne diffuse aucun
 * état par Realtime, et il vit HORS de la zone caméra — le Programme enregistré (MP4)
 * et les flux sociaux composent `camAreaRef`, pas cette colonne. Réserve honnête : si
 * l'hôte partage son ÉCRAN ENTIER au niveau système, son écran contient ce panneau.
 * Aucune application ne peut promettre le contraire, et on ne le promet donc pas.
 *
 * Éteint par défaut : tant que l'hôte ne l'allume pas, aucune requête n'est émise.
 */

export interface SuggestionsEtat {
  actif: boolean;
  mode: ModeSouffleur;
  suggestions: string[];
  enCours: boolean;
  /** Motif renvoyé par le serveur quand il ne peut pas répondre (jamais un secret). */
  indisponible: string | null;
  /** Prénom de la personne actuellement à l'écran avec l'hôte, si elle existe. */
  invite: string | null;
}

interface Props extends SuggestionsEtat {
  open: boolean;
  onClose: () => void;
  onBasculer: (actif: boolean) => void;
  onMode: (m: ModeSouffleur) => void;
  onActualiser: () => void;
  /** Dépose le texte dans le champ du chat — SANS l'envoyer. Absent = seul « Copier ». */
  onInserer?: (texte: string) => void;
  mobile?: boolean;
}

const MOTIFS: Record<string, string> = {
  ia_non_configuree: "Assistant indisponible : aucune clé IA configurée sur le serveur.",
  fournisseur_indisponible: "Assistant indisponible pour le moment. Le direct continue normalement.",
  reponse_illisible: "Assistant indisponible : réponse inutilisable. Réessaie dans un instant.",
  hors_ligne: "Assistant indisponible : connexion interrompue.",
};

export const AssistantHotePanel: React.FC<Props> = ({
  open, onClose, actif, mode, suggestions, enCours, indisponible, invite,
  onBasculer, onMode, onActualiser, onInserer, mobile = false,
}) => {
  const [copie, setCopie] = React.useState<number | null>(null);
  React.useEffect(() => { if (copie === null) return; const t = setTimeout(() => setCopie(null), 1400); return () => clearTimeout(t); }, [copie]);
  if (!open) return null;

  const copier = async (texte: string, i: number) => {
    try { await navigator.clipboard.writeText(texte); setCopie(i); } catch { /* presse-papiers refusé */ }
  };

  const ONGLET = (m: ModeSouffleur, libelle: string, icone: React.ReactNode, dispo: boolean) => (
    <button
      type="button"
      onClick={() => dispo && onMode(m)}
      disabled={!dispo}
      aria-pressed={mode === m}
      title={dispo ? libelle : "Personne n'est à l'écran avec toi pour l'instant"}
      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        mode === m ? 'bg-[rgb(var(--bt-accent-rgb)/0.25)] text-[var(--bt-accent)]'
                   : dispo ? 'text-white/60 hover:text-white' : 'text-white/25 cursor-not-allowed'}`}
      data-testid={`assistant-mode-${m}`}
    >
      {icone}{libelle}
    </button>
  );

  return (
    <div
      className={mobile
        ? 'fixed inset-x-0 bottom-0 z-[130] max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-[rgb(var(--bt-accent-rgb)/0.35)] bg-[#15151b] shadow-2xl'
        : 'fixed right-4 bottom-24 z-[130] w-[340px] max-h-[70vh] overflow-y-auto rounded-2xl border border-[rgb(var(--bt-accent-rgb)/0.35)] bg-[#15151b] shadow-2xl'}
      role="dialog"
      aria-label="Assistant IA privé de l'hôte"
      data-testid="assistant-hote-panneau"
    >
      <div className="sticky top-0 flex items-center gap-2 px-4 py-3 bg-[#15151b] border-b border-white/10">
        <Sparkles className="w-4 h-4" style={{ color: 'var(--bt-accent)' }} aria-hidden="true" />
        <span className="text-white text-sm font-semibold flex-1">Assistant IA</span>
        <button
          type="button"
          onClick={() => onBasculer(!actif)}
          aria-pressed={actif}
          aria-label={actif ? "Éteindre l'assistant" : "Allumer l'assistant"}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
            actif ? 'border-[var(--bt-accent)] text-[var(--bt-accent)] bg-[rgb(var(--bt-accent-rgb)/0.12)]'
                  : 'border-white/20 text-white/50'}`}
          data-testid="assistant-bascule"
        >
          {actif ? 'Activé' : 'Désactivé'}
        </button>
        <button type="button" onClick={onClose} aria-label="Fermer l'assistant"
          className="text-white/50 hover:text-white" data-testid="assistant-fermer">
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="px-4 pt-3 text-[11px] leading-snug text-white/40">
        Visible par toi seul. L'assistant propose — c'est toujours toi qui écris et qui envoies.
      </p>

      <div className="flex gap-1 mx-4 mt-3 p-1 rounded-xl bg-white/5">
        {ONGLET('chat', 'Chat', <MessageSquare className="w-3.5 h-3.5" />, true)}
        {ONGLET('visio', 'En visio', <Video className="w-3.5 h-3.5" />, !!invite)}
      </div>
      {mode === 'visio' && invite && (
        <p className="px-4 pt-2 text-[11px] text-white/50">À l'écran avec toi : <span className="text-white/80">{invite}</span></p>
      )}

      <div className="px-4 py-3 space-y-2">
        {!actif ? (
          <p className="text-white/50 text-sm" data-testid="assistant-eteint">
            Assistant éteint. Allume-le pour recevoir des suggestions.
          </p>
        ) : indisponible ? (
          <p className="text-amber-300/80 text-sm" role="status" data-testid="assistant-indisponible">
            {MOTIFS[indisponible] || MOTIFS.fournisseur_indisponible}
          </p>
        ) : enCours && !suggestions.length ? (
          <p className="text-white/50 text-sm" role="status" data-testid="assistant-chargement">Réflexion…</p>
        ) : !suggestions.length ? (
          <p className="text-white/50 text-sm" data-testid="assistant-vide">
            Aucune suggestion pour l'instant. Actualise quand tu veux.
          </p>
        ) : (
          suggestions.map((texte, i) => (
            <div key={texte} className="rounded-xl border border-white/10 bg-white/5 p-3" data-testid="assistant-suggestion">
              <p className="text-white text-sm leading-snug">{texte}</p>
              <div className="flex gap-2 mt-2">
                {onInserer && (
                  <button
                    type="button"
                    onClick={() => onInserer(texte)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[var(--bt-accent)] bg-[rgb(var(--bt-accent-rgb)/0.15)] hover:bg-[rgb(var(--bt-accent-rgb)/0.25)]"
                    title="Déposer dans le champ du chat — sans envoyer"
                    data-testid="assistant-inserer"
                  >
                    <CornerDownLeft className="w-3.5 h-3.5" /> Insérer
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => copier(texte, i)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/70 border border-white/15 hover:text-white"
                  data-testid="assistant-copier"
                >
                  {copie === i ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copie === i ? 'Copié' : 'Copier'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="px-4 pb-4" style={{ paddingBottom: mobile ? 'max(1rem, env(safe-area-inset-bottom))' : undefined }}>
        <button
          type="button"
          onClick={onActualiser}
          disabled={!actif || enCours}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium text-white border border-white/15 hover:bg-white/5 disabled:opacity-40"
          data-testid="assistant-actualiser"
        >
          <RotateCw className={`w-4 h-4${enCours ? ' animate-spin' : ''}`} />
          Actualiser les suggestions
        </button>
      </div>
    </div>
  );
};

export default AssistantHotePanel;
