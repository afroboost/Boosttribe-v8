import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Lock } from 'lucide-react';
import { getCreditsConfig, getBilletterieConfig, type CreditsConfig } from '@/lib/paymentApi';
import { getBotResponse } from '@/lib/assistantConnaissances';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface AssistantChatProps {
  hasAccess: boolean;
  gradient: string;            // dégradé du thème (bouton envoi)
  active?: boolean;            // l'onglet/le panneau est visible (déclenche le message d'accueil)
}

// 💬 Conversation avec l'assistant Boosttribe — présentation seule (remplit son parent en colonne).
// Réutilisé par le ChatBot global (hors session) et par le lanceur de chat de session (onglet Assistant).
export const AssistantChat: React.FC<AssistantChatProps> = ({ hasAccess, gradient, active = true }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [creditsCfg, setCreditsCfg] = useState<CreditsConfig | null>(null);
  // Prix Coach : MÊME source que /pricing (configuration billetterie) — jamais écrit en dur.
  const [prixCoach, setPrixCoach] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    getBilletterieConfig().then(({ data }) => { if (alive && data?.coach_sub_price_chf) setPrixCoach(data.coach_sub_price_chf); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Charge la config crédits (dynamique, éditable en admin) pour des réponses tarifaires à jour.
  useEffect(() => {
    let alive = true;
    getCreditsConfig().then(({ data }) => { if (alive && data) setCreditsCfg(data); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Message d'accueil à la première ouverture
  useEffect(() => {
    if (active && messages.length === 0 && hasAccess) {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: "👋 Bonjour ! Je suis l'assistant Boosttribe. Comment puis-je vous aider aujourd'hui ?",
        timestamp: Date.now(),
      }]);
    }
  }, [active, hasAccess, messages.length]);

  const handleSend = () => {
    if (!inputValue.trim() || !hasAccess) return;
    const userMessage: Message = {
      id: `${Date.now()}-u`, role: 'user', content: inputValue.trim(), timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);
    setTimeout(() => {
      const botResponse: Message = {
        id: `${Date.now()}-a`, role: 'assistant', content: getBotResponse(userMessage.content, creditsCfg, prixCoach), timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, botResponse]);
      setIsTyping(false);
    }, 1000 + Math.random() * 1000);
  };

  if (!hasAccess) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-white/50" />
        </div>
        <h3 className="text-white font-semibold mb-2">Assistant BoostTribe</h3>
        <p className="text-white/60 text-sm mb-4">Procurez-vous des crédits pour accéder à l'assistant et aux lives.</p>
        {/* <Link> et non <a href> : sous /live, un lien brut sortirait de l'app. */}
        <Link
          to="/pricing"
          className="px-6 py-2 rounded-full text-white text-sm font-medium transition-all hover:opacity-90"
          style={{ background: gradient }}
        >
          Acheter des crédits
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm ${
                msg.role === 'user' ? 'bg-[var(--bt-accent)] text-white rounded-br-sm' : 'bg-white/10 text-white/90 rounded-bl-sm'
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
            onKeyPress={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Tapez votre message..."
            className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-[var(--bt-accent)]"
            data-testid="chatbot-input"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-50"
            style={{ background: gradient }}
            data-testid="chatbot-send"
          >
            <Send size={18} className="text-white" />
          </button>
        </div>
      </div>
    </>
  );
};

export default AssistantChat;
