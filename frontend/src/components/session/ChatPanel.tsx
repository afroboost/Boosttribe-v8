import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Users, MessageCircle, ArrowLeft, Trash2, Lock, Bot } from 'lucide-react';
import { ProfilePhoto } from '@/components/session/ProfilePhoto';
import { AssistantChat } from '@/components/AssistantChat';

// 💬 Message de chat (groupé ou privé) — éphémère (realtime uniquement, pas de DB en v1).
export interface ChatMessage {
  id: string;
  userId: string;        // auteur
  name: string;
  photoUrl?: string | null;
  text: string;
  ts: number;
  // privé uniquement :
  fromUserId?: string;
  toUserId?: string;
}

export interface ChatParticipant {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export type ChatTab = 'assistant' | 'group' | 'private';

interface ChatPanelProps {
  open: boolean;
  onToggle: () => void;                      // bouton lanceur (ouvrir/fermer)
  onClose: () => void;
  isPro: boolean;                            // gating Groupe/Privé + Assistant
  gradient: string;                          // dégradé du thème
  unreadTotal: number;                       // badge du lanceur (groupe + privé)
  meUserId: string;
  isHost: boolean;
  participants: ChatParticipant[];           // autres participants (self exclu)
  tab: ChatTab;
  onTab: (t: ChatTab) => void;
  partner: string | null;                    // conversation privée ouverte (userId) ou null = liste
  onOpenPartner: (id: string | null) => void;
  groupMessages: ChatMessage[];
  privateThreads: Record<string, ChatMessage[]>;   // clé = userId du partenaire
  unread: Record<string, number>;            // clé = 'group' | partnerId
  onSendGroup: (text: string) => void;
  onSendPrivate: (partnerId: string, text: string) => void;
  onDeleteGroup?: (id: string) => void;      // modération hôte
}

const fmtTime = (ts: number): string => {
  try {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

// 🗨️ Une bulle de message (alignée à droite si c'est l'utilisateur courant).
const MessageBubble: React.FC<{
  m: ChatMessage;
  mine: boolean;
  canDelete: boolean;
  onDelete?: (id: string) => void;
}> = ({ m, mine, canDelete, onDelete }) => (
  <div className={`flex gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
    <div className="flex-shrink-0 pt-0.5">
      <ProfilePhoto url={m.photoUrl} name={m.name} size={28} />
    </div>
    <div className={`group max-w-[78%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-[11px] text-white/45 truncate max-w-[120px]">{mine ? 'Vous' : m.name}</span>
        <span className="text-[10px] text-white/30">{fmtTime(m.ts)}</span>
        {canDelete && onDelete && (
          <button
            onClick={() => onDelete(m.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-red-400"
            title="Supprimer ce message"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div
        className={`px-3 py-2 rounded-2xl text-sm leading-snug break-words whitespace-pre-wrap ${
          mine
            ? 'bg-gradient-to-br from-[#7A5CFF] to-[#E24A9E] text-white rounded-tr-sm'
            : 'bg-white/8 text-white/90 rounded-tl-sm'
        }`}
      >
        {m.text}
      </div>
    </div>
  </div>
);

// 📝 Zone de saisie + envoi (Entrée = envoyer, Maj+Entrée = retour à la ligne).
const Composer: React.FC<{ onSend: (text: string) => void; placeholder: string }> = ({ onSend, placeholder }) => {
  const [value, setValue] = useState('');
  const send = () => {
    const t = value.trim();
    if (!t) return;
    onSend(t);
    setValue('');
  };
  return (
    <div className="flex items-end gap-2 p-2.5 border-t border-white/10 bg-black/30">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        placeholder={placeholder}
        className="flex-1 resize-none max-h-28 px-3 py-2 rounded-xl bg-white/8 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#7A5CFF]/60 focus:ring-1 focus:ring-[#7A5CFF]/40"
      />
      <button
        onClick={send}
        disabled={!value.trim()}
        className="flex-shrink-0 p-2.5 rounded-xl bg-gradient-to-br from-[#7A5CFF] to-[#E24A9E] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        title="Envoyer"
      >
        <Send size={18} />
      </button>
    </div>
  );
};

// 🔒 Vue verrouillée (gratuit) pour Groupe / Privé.
const ProLock: React.FC<{ gradient: string }> = ({ gradient }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
    <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
      <Lock className="w-8 h-8 text-white/50" />
    </div>
    <h3 className="text-white font-semibold mb-2">Le chat (groupé et privé) nécessite des crédits</h3>
    <p className="text-white/60 text-sm mb-4">Procurez-vous des crédits pour discuter avec le groupe et en privé.</p>
    <a
      href="/pricing"
      className="px-6 py-2 rounded-full text-white text-sm font-medium transition-all hover:opacity-90"
      style={{ background: gradient }}
    >
      Acheter des crédits
    </a>
  </div>
);

// 💬 Lanceur + panneau de chat de session, regroupés en bas à droite.
// Onglets : Assistant (bot Boosttribe) · Groupe · Privé. Gating Pro pour les trois.
// Plein écran sur mobile, carte flottante bas-droite sur desktop.
export const ChatPanel: React.FC<ChatPanelProps> = ({
  open, onToggle, onClose, isPro, gradient, unreadTotal,
  meUserId, isHost, participants,
  tab, onTab, partner, onOpenPartner,
  groupMessages, privateThreads, unread,
  onSendGroup, onSendPrivate, onDeleteGroup,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const partnerInfo = useMemo(
    () => participants.find((p) => p.id === partner) || null,
    [participants, partner],
  );
  const activeThread = partner ? (privateThreads[partner] || []) : [];

  // Auto-défilement vers le bas à chaque nouveau message / changement de vue.
  useEffect(() => {
    if (!open || tab === 'assistant') return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, tab, partner, groupMessages, activeThread.length]);

  const groupUnread = unread['group'] || 0;
  const privateUnread = Object.entries(unread)
    .filter(([k]) => k !== 'group')
    .reduce((s, [, n]) => s + (n || 0), 0);

  const TABS: { key: ChatTab; label: string; icon: React.ReactNode; badge: number }[] = [
    { key: 'assistant', label: 'Assistant', icon: <Bot size={14} />, badge: 0 },
    { key: 'group', label: 'Groupe', icon: <Users size={14} />, badge: groupUnread },
    { key: 'private', label: 'Privé', icon: <MessageCircle size={14} />, badge: privateUnread },
  ];

  return (
    <>
      {/* 🚀 Lanceur flottant bas-droite (badge non-lus groupe + privé) — masqué quand le chat est ouvert
          (le panneau a son propre bouton « fermer ») pour ne pas chevaucher le panneau ancré. */}
      {!open && (
        <button
          onClick={onToggle}
          // z-[130] : AU-DESSUS de la vidéo agrandie (overlay z-[100]) → le lanceur reste visible/cliquable.
          className="fixed bottom-6 right-6 z-[130] w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110"
          style={{ background: gradient }}
          data-testid="session-chat-launcher"
          aria-label="Ouvrir le chat de la session"
        >
          <MessageCircle className="w-6 h-6 text-white" />
          {unreadTotal > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-[#E24A9E] text-white text-[10px] font-bold flex items-center justify-center border-2 border-[#0d0d12]">
              {unreadTotal > 99 ? '99+' : unreadTotal}
            </span>
          )}
        </button>
      )}

      {!open ? null : (
        <>
          {/* 💬 Chat COEXISTANT avec la vidéo/visio (jamais plein écran, pas de fond opaque qui masque) :
              • Mobile/tablette : feuille BASSE (~58vh) ancrée en bas → la vidéo/visio reste visible au-dessus.
              • Desktop (lg) : panneau LATÉRAL droit pleine hauteur, compact → la page se redimensionne à côté
                (cf. padding droit appliqué au conteneur de session quand le chat est ouvert). */}
          <div
            className="fixed z-[120] inset-x-0 bottom-0 h-[58vh] max-h-[62vh] rounded-t-2xl border-t border-white/10
                       lg:inset-y-0 lg:left-auto lg:right-0 lg:h-screen lg:w-[372px] lg:max-h-none lg:rounded-t-none lg:border-t-0 lg:border-l
                       flex flex-col bg-[#0d0d12] shadow-2xl overflow-hidden"
            data-testid="chat-panel"
          >
            {/* En-tête */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10" style={{ background: gradient }}>
              <h3 className="flex items-center gap-2 text-white text-sm font-semibold">
                <MessageCircle className="w-4 h-4" /> Chat de la session
              </h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition-colors"
                title="Fermer"
                data-testid="chat-close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Onglets Assistant / Groupe / Privé */}
            <div className="flex items-center gap-1 px-2 pt-2 flex-shrink-0">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => onTab(t.key)}
                  className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    tab === t.key ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'
                  }`}
                  data-testid={`chat-tab-${t.key}`}
                >
                  {t.icon} {t.label}
                  {t.badge > 0 && tab !== t.key && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#E24A9E] text-white text-[10px] font-bold flex items-center justify-center">
                      {t.badge > 99 ? '99+' : t.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Contenu */}
            {tab === 'assistant' ? (
              <AssistantChat hasAccess={isPro} gradient={gradient} active={open && tab === 'assistant'} />
            ) : !isPro ? (
              <ProLock gradient={gradient} />
            ) : tab === 'group' ? (
              <>
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                  {groupMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-white/35 px-6">
                      <Users size={32} className="mb-2 opacity-50" />
                      <p className="text-sm">Aucun message pour l'instant.</p>
                      <p className="text-xs mt-1">Lancez la discussion avec le groupe&nbsp;!</p>
                    </div>
                  ) : (
                    groupMessages.map((m) => (
                      <MessageBubble
                        key={m.id}
                        m={m}
                        mine={m.userId === meUserId}
                        canDelete={isHost}
                        onDelete={onDeleteGroup}
                      />
                    ))
                  )}
                </div>
                <Composer onSend={onSendGroup} placeholder="Message au groupe…" />
              </>
            ) : partner && partnerInfo ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/5 flex-shrink-0">
                  <button
                    onClick={() => onOpenPartner(null)}
                    className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                    title="Retour aux conversations"
                    data-testid="chat-private-back"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <ProfilePhoto url={partnerInfo.avatarUrl} name={partnerInfo.name} size={26} />
                  <span className="text-white text-sm font-medium truncate">{partnerInfo.name}</span>
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-white/40">
                    <Lock size={11} /> privé
                  </span>
                </div>
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                  {activeThread.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-white/35 px-6">
                      <MessageCircle size={32} className="mb-2 opacity-50" />
                      <p className="text-sm">Conversation privée avec {partnerInfo.name}.</p>
                      <p className="text-xs mt-1">Vous seuls voyez ces messages.</p>
                    </div>
                  ) : (
                    activeThread.map((m) => (
                      <MessageBubble key={m.id} m={m} mine={m.userId === meUserId} canDelete={false} />
                    ))
                  )}
                </div>
                <Composer onSend={(t) => onSendPrivate(partner, t)} placeholder={`Message privé à ${partnerInfo.name}…`} />
              </>
            ) : (
              /* Liste des conversations privées disponibles */
              <div className="flex-1 overflow-y-auto p-2">
                <p className="px-2 py-2 text-[11px] uppercase tracking-wide text-white/35">Participants</p>
                {participants.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center text-white/35 px-6 py-10">
                    <Users size={32} className="mb-2 opacity-50" />
                    <p className="text-sm">Aucun autre participant pour l'instant.</p>
                  </div>
                ) : (
                  participants.map((p) => {
                    const n = unread[p.id] || 0;
                    return (
                      <button
                        key={p.id}
                        onClick={() => onOpenPartner(p.id)}
                        className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/8 transition-colors text-left"
                        data-testid="chat-private-open"
                      >
                        <ProfilePhoto url={p.avatarUrl} name={p.name} size={36} />
                        <span className="flex-1 min-w-0 text-white/90 text-sm truncate">{p.name}</span>
                        {n > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#E24A9E] text-white text-[10px] font-bold flex items-center justify-center">
                            {n > 99 ? '99+' : n}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default ChatPanel;
