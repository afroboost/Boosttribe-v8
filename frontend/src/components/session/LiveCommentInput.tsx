/**
 * 💬 CHAMP DE COMMENTAIRE DU LIVE — une pilule translucide posée en bas de la vidéo.
 *
 * Jamais `position: fixed` : le parent le place en absolu dans la zone vidéo, et le
 * clavier mobile pousse la page normalement. Police 16 px (sinon iOS zoome au focus).
 * Entrée envoie, Échap rend la main à la vidéo.
 *
 * Anti-flood CÔTÉ CLIENT (`limiteurChat`) : il n'existe pas de serveur de chat, le
 * message part en broadcast Supabase Realtime. `onEnvoyer` peut aussi refuser (false).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Send, HelpCircle } from 'lucide-react';
import { LONGUEUR_MAX, limiteurChat, normaliserTexte } from '@/lib/liveChat';

export interface LiveCommentInputProps {
  /** false = refusé (rate limit côté appelant). */
  onEnvoyer: (texte: string, opts: { question: boolean }) => boolean;
  desactive?: boolean;
  /** ex. 'Le chat nécessite des crédits'. */
  motifDesactive?: string;
  peutPoserQuestion?: boolean;
  onFocusChange?: (f: boolean) => void;
  placeholder?: string;
  /** Emplacement à droite de la pilule (bouton ❤ fourni par le parent). */
  slotDroite?: React.ReactNode;
}

export function LiveCommentInput({
  onEnvoyer,
  desactive = false,
  motifDesactive,
  peutPoserQuestion = false,
  onFocusChange,
  placeholder = 'Écrire un commentaire…',
  slotDroite,
}: LiveCommentInputProps) {
  const [texte, setTexte] = useState('');
  const [focus, setFocus] = useState(false);
  const [question, setQuestion] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const limiteur = useRef(limiteurChat());
  const champ = useRef<HTMLInputElement>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (minuterie.current) clearTimeout(minuterie.current); }, []);

  const afficherRefus = (ms: number) => {
    const s = Math.max(1, Math.ceil(ms / 1000));
    setRefus(`Doucement… réessaie dans ${s}s`);
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = setTimeout(() => setRefus(null), Math.min(ms, 4000) + 400);
  };

  const envoyer = () => {
    if (desactive) return;
    const propre = normaliserTexte(texte);
    if (!propre) return;
    const essai = limiteur.current.essayer(Date.now());
    if (!essai.ok) { afficherRefus(essai.attendreMs); return; }
    const accepte = onEnvoyer(propre, { question });
    if (accepte === false) { afficherRefus(1200); return; }
    setTexte('');
    setQuestion(false);
    setRefus(null);
  };

  const changerFocus = (f: boolean) => {
    setFocus(f);
    onFocusChange?.(f);
  };

  const libelle = desactive && motifDesactive ? motifDesactive : placeholder;

  return (
    <div className="relative w-full flex items-end gap-2 pointer-events-auto">
      {refus && (
        <p
          role="status"
          className="absolute -top-8 left-3 text-xs font-medium text-white bg-black/30 rounded-full px-2.5 py-1"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,.9)' }}
        >
          {refus}
        </p>
      )}
      <form
        onSubmit={(e) => { e.preventDefault(); envoyer(); }}
        className={`flex items-center gap-1 h-11 min-w-0 rounded-full border bg-black/35 backdrop-blur-sm pl-4 pr-1 focus-within:ring-2 focus-within:ring-[rgb(var(--bt-accent-rgb)/0.6)] transition-[flex-grow,border-color] duration-200 motion-reduce:transition-none ${
          focus ? 'flex-[1_1_100%] border-white/35' : 'flex-1 border-white/15'
        } ${desactive ? 'opacity-60' : ''}`}
      >
        <input
          ref={champ}
          type="text"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onFocus={() => changerFocus(true)}
          onBlur={() => changerFocus(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); champ.current?.blur(); }
          }}
          disabled={desactive}
          maxLength={LONGUEUR_MAX}
          enterKeyHint="send"
          autoComplete="off"
          placeholder={libelle}
          aria-label={desactive && motifDesactive ? motifDesactive : 'Écrire un commentaire'}
          className="flex-1 min-w-0 bg-transparent text-base sm:text-sm text-white placeholder:text-white/65 outline-none focus-visible:outline-none disabled:cursor-not-allowed"
        />
        {peutPoserQuestion && (
          <button
            type="button"
            onClick={() => setQuestion((q) => !q)}
            disabled={desactive}
            aria-pressed={question}
            aria-label="Marquer comme question"
            title="Marquer comme question"
            className={`shrink-0 w-9 h-9 grid place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
              question ? 'bg-[rgb(var(--bt-accent-rgb)/0.85)] text-white' : 'text-white/75 hover:text-white'
            }`}
          >
            <HelpCircle className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
        <button
          type="submit"
          disabled={desactive || !normaliserTexte(texte)}
          aria-label="Envoyer le commentaire"
          className="shrink-0 w-9 h-9 grid place-items-center rounded-full text-white bg-[var(--bt-accent)] disabled:bg-white/10 disabled:text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </form>
      {slotDroite && <div className="shrink-0">{slotDroite}</div>}
    </div>
  );
}

export default LiveCommentInput;
