import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle, X, Bot } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { AssistantChat } from '@/components/AssistantChat';

// 🤖 Lanceur global de l'assistant Boosttribe (bas à droite).
// Dans une SESSION, ce lanceur est masqué : le chat de session regroupe Assistant + Groupe + Privé
// dans un seul lanceur (voir SessionChatLauncher). Hors session, ce bouton reste l'assistant.
const ChatBot: React.FC = () => {
  const { profile, isSubscribed, isAdmin } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  // Masqué sur les pages de session (le lanceur de session prend le relais avec ses onglets).
  const inSession = location.pathname.startsWith('/session');

  // Accès Pro (Pro, Enterprise, ou Admin)
  const userPlan = profile?.subscription_status || 'free';
  const hasAccess = isAdmin || isSubscribed || ['pro', 'enterprise'].includes(userPlan);

  if (inSession) return null;

  return (
    <>
      {/* Bouton flottant */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110"
        style={{ background: theme.colors.gradient.primary }}
        data-testid="chatbot-toggle"
        aria-label="Ouvrir le chat assistant"
      >
        {isOpen ? <X className="w-6 h-6 text-white" /> : <MessageCircle className="w-6 h-6 text-white" />}
      </button>

      {/* Fenêtre de chat */}
      {isOpen && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 h-[480px] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-white/10"
          style={{ background: 'rgba(10, 10, 15, 0.98)', backdropFilter: 'blur(20px)' }}
        >
          {/* En-tête */}
          <div className="px-4 py-3 flex items-center gap-3 border-b border-white/10" style={{ background: theme.colors.gradient.primary }}>
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold text-sm">Assistant Boosttribe</h3>
              <p className="text-white/70 text-xs">{hasAccess ? '🟢 En ligne' : '🔒 Pro requis'}</p>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white">
              <X size={20} />
            </button>
          </div>

          {/* Conversation (partagée avec le chat de session) */}
          <AssistantChat hasAccess={hasAccess} gradient={theme.colors.gradient.primary} active={isOpen} />
        </div>
      )}
    </>
  );
};

export default ChatBot;
