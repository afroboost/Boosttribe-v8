import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Bot, Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// Réponses prédéfinies du bot (contexte Beattribe)
const BOT_RESPONSES: Record<string, string[]> = {
  default: [
    "Bonjour ! Je suis l'assistant Beattribe. Comment puis-je vous aider ?",
    "Je peux vous aider avec les sessions d'écoute, les abonnements, ou toute question sur Beattribe.",
  ],
  session: [
    "Pour créer une session d'écoute : cliquez sur 'Créer ma session' puis uploadez vos fichiers MP3.",
    "Vous pouvez inviter jusqu'à 50 participants par session avec un compte Pro !",
  ],
  pricing: [
    "Nous proposons un essai gratuit de 5 minutes, puis des plans Pro (9.99€/mois) et Enterprise (29.99€/mois).",
    "Le plan Pro vous donne accès à 50 chansons par session et à la voix en temps réel.",
  ],
  upload: [
    "Pour uploader de la musique : accédez à votre session et cliquez sur le bouton d'upload.",
    "Formats acceptés : MP3, WAV, AAC. Taille max : 50 Mo par fichier.",
  ],
  help: [
    "Besoin d'aide ? Voici ce que je peux faire : expliquer les fonctionnalités, vous guider dans l'utilisation, ou répondre à vos questions sur les abonnements.",
  ],
};

// Simple keyword matching
function getBotResponse(userMessage: string): string {
  const msg = userMessage.toLowerCase();
  
  if (msg.includes('session') || msg.includes('écoute') || msg.includes('créer')) {
    return BOT_RESPONSES.session[Math.floor(Math.random() * BOT_RESPONSES.session.length)];
  }
  if (msg.includes('prix') || msg.includes('abonnement') || msg.includes('pro') || msg.includes('payer')) {
    return BOT_RESPONSES.pricing[Math.floor(Math.random() * BOT_RESPONSES.pricing.length)];
  }
  if (msg.includes('upload') || msg.includes('musique') || msg.includes('mp3') || msg.includes('fichier')) {
    return BOT_RESPONSES.upload[Math.floor(Math.random() * BOT_RESPONSES.upload.length)];
  }
  if (msg.includes('aide') || msg.includes('help') || msg.includes('comment')) {
    return BOT_RESPONSES.help[0];
  }
  
  return BOT_RESPONSES.default[Math.floor(Math.random() * BOT_RESPONSES.default.length)];
}

const ChatBot: React.FC = () => {
  const { profile, isSubscribed, isAdmin } = useAuth();
  const { theme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Vérifier si l'utilisateur a accès (Pro, Enterprise, ou Admin)
  const userPlan = profile?.subscription_status || 'free';
  const hasAccess = isAdmin || isSubscribed || ['pro', 'enterprise'].includes(userPlan);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initial greeting when opening
  useEffect(() => {
    if (isOpen && messages.length === 0 && hasAccess) {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: "👋 Bonjour ! Je suis l'assistant Beattribe. Comment puis-je vous aider aujourd'hui ?",
        timestamp: new Date(),
      }]);
    }
  }, [isOpen, hasAccess, messages.length]);

  const handleSend = () => {
    if (!inputValue.trim() || !hasAccess) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    // Simulate bot thinking
    setTimeout(() => {
      const botResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: getBotResponse(userMessage.content),
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botResponse]);
      setIsTyping(false);
    }, 1000 + Math.random() * 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110"
        style={{ background: theme.colors.gradient.primary }}
        data-testid="chatbot-toggle"
        aria-label="Ouvrir le chat assistant"
      >
        {isOpen ? (
          <X className="w-6 h-6 text-white" />
        ) : (
          <MessageCircle className="w-6 h-6 text-white" />
        )}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div 
          className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 h-[480px] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-white/10"
          style={{ background: 'rgba(10, 10, 15, 0.98)', backdropFilter: 'blur(20px)' }}
        >
          {/* Header */}
          <div 
            className="px-4 py-3 flex items-center gap-3 border-b border-white/10"
            style={{ background: theme.colors.gradient.primary }}
          >
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold text-sm">Assistant Beattribe</h3>
              <p className="text-white/70 text-xs">
                {hasAccess ? '🟢 En ligne' : '🔒 Pro requis'}
              </p>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-white/70 hover:text-white"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          {hasAccess ? (
            <>
              {/* Messages */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm ${
                        msg.role === 'user'
                          ? 'bg-purple-500 text-white rounded-br-sm'
                          : 'bg-white/10 text-white/90 rounded-bl-sm'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-white/10 px-4 py-2 rounded-2xl rounded-bl-sm">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t border-white/10">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Tapez votre message..."
                    className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-purple-500"
                    data-testid="chatbot-input"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!inputValue.trim()}
                    className="w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-50"
                    style={{ background: theme.colors.gradient.primary }}
                    data-testid="chatbot-send"
                  >
                    <Send size={18} className="text-white" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Locked State */
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
                <Lock className="w-8 h-8 text-white/50" />
              </div>
              <h3 className="text-white font-semibold mb-2">Assistant Pro</h3>
              <p className="text-white/60 text-sm mb-4">
                Le Bot Assistant est réservé aux membres Pro et Enterprise.
              </p>
              <a
                href="/pricing"
                className="px-6 py-2 rounded-full text-white text-sm font-medium transition-all hover:opacity-90"
                style={{ background: theme.colors.gradient.primary }}
              >
                Passer à Pro
              </a>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default ChatBot;
