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

// 🧠 Connaissances de l'assistant Boosttribe — à jour (réponses pré-écrites, 100% front).
const BOT_RESPONSES: Record<string, string[]> = {
  default: [
    "Bonjour ! Je suis l'assistant Boosttribe 👋 Je peux vous parler des sessions audio/vidéo synchronisées, du Live Visio, du micro, de l'enregistrement, des sessions privées ou des abonnements.",
    "BoostTribe permet d'animer des sessions où tout le monde écoute/regarde la même chose, parfaitement synchronisé. Posez-moi votre question !",
  ],
  session: [
    "Pour créer une session : cliquez sur « Créer ma session ». Vous partagez ensuite un lien ou un QR code, et vos participants rejoignent en un clic — audio ET vidéo restent synchronisés pour tout le monde.",
    "Dans une session, l'hôte contrôle la lecture pour tous : musique, vidéo uploadée ou lien YouTube/Vimeo, tout est synchronisé au même instant.",
  ],
  video: [
    "BoostTribe synchronise aussi la VIDÉO : partagez une vidéo uploadée ou un lien YouTube/Vimeo, et tous les participants la voient au même instant (l'hôte pilote play/pause/seek).",
    "En plan gratuit, la vidéo partagée est limitée à 30 secondes. Les membres Pro profitent de la vidéo complète (jusqu'à 90 min).",
  ],
  visio: [
    "Le Live Visio, c'est la visio façon Zoom DANS la session : activez votre caméra et voyez les autres en direct (jusqu'à 6 caméras), tout en gardant la vidéo partagée. Le lecteur est même déplaçable sur l'écran. 🎥 Réservé aux membres Pro.",
  ],
  voice: [
    "Côté voix : prenez le micro pour guider votre audience, parlez à tout le groupe ou en privé à un ou plusieurs participants choisis. Chaque participant peut aussi régler le volume des autres.",
  ],
  record: [
    "L'hôte peut enregistrer les VOIX de la session (micro + participants) en un clic, puis télécharger l'audio — idéal pour créer du contenu pour vos réseaux. Un bandeau prévient tout le monde quand l'enregistrement est actif.",
  ],
  social: [
    "Pendant une session : likes et commentaires en direct, photos de profil, et partage de vidéo, image ou lien. Une vraie expérience de groupe. 💬",
  ],
  private: [
    "Les sessions privées ont une SALLE D'ATTENTE : même si le lien fuite, l'hôte admet (ou refuse) chaque participant manuellement. Parfait pour vendre vos sessions et ne laisser entrer que ceux qui ont payé.",
  ],
  pricing: [
    "Les plans : Essai Gratuit (1 session active, audio & vidéo synchronisés, partage vidéo 30s max, sans Live Visio), Pro à 9,99€/mois (Live Visio, vidéo complète jusqu'à 90 min, micro + voix privée, enregistrement) et Enterprise à 29,99€/mois (branding, analytics, API, support 24/7).",
    "Le plan Pro (9,99€/mois) débloque le Live Visio, la vidéo complète, le micro/voix privée et l'enregistrement de session.",
  ],
  free: [
    "En gratuit : 1 session active, audio & vidéo synchronisés, participants illimités, MAIS partage vidéo limité à 30s et pas de Live Visio. Passez à Pro (9,99€/mois) pour tout débloquer.",
  ],
  lang: [
    "L'application est multilingue : Français, Anglais et Allemand (bouton globe 🌐). Le français est la langue par défaut.",
  ],
  access: [
    "Rejoindre une session est ultra simple : un lien ou un QR code, aucune application à installer, compatible tous appareils (et installable en PWA).",
  ],
  help: [
    "Je peux vous expliquer : sessions synchronisées, Live Visio, micro & voix privée, enregistrement, sessions privées (salle d'attente), partage vidéo/image/lien, langues et abonnements. Que voulez-vous savoir ?",
  ],
};

// Détection par mots-clés (français)
function getBotResponse(userMessage: string): string {
  const msg = userMessage.toLowerCase();
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

  if (msg.includes('visio') || msg.includes('caméra') || msg.includes('camera') || msg.includes('zoom') || msg.includes('webcam')) return pick(BOT_RESPONSES.visio);
  if (msg.includes('privé') || msg.includes('prive') || msg.includes('salle') || msg.includes('attente') || msg.includes('admet') || msg.includes('vendre') || msg.includes('payer mes') || msg.includes('payant')) return pick(BOT_RESPONSES.private);
  if (msg.includes('enregistr') || msg.includes('record') || msg.includes('télécharg')) return pick(BOT_RESPONSES.record);
  if (msg.includes('micro') || msg.includes('voix') || msg.includes('parler')) return pick(BOT_RESPONSES.voice);
  if (msg.includes('commentaire') || msg.includes('like') || msg.includes('aime') || msg.includes('photo')) return pick(BOT_RESPONSES.social);
  if (msg.includes('vidéo') || msg.includes('video') || msg.includes('youtube') || msg.includes('vimeo') || msg.includes('30s') || msg.includes('30 sec')) return pick(BOT_RESPONSES.video);
  if (msg.includes('gratuit') || msg.includes('free') || msg.includes('limite')) return pick(BOT_RESPONSES.free);
  if (msg.includes('prix') || msg.includes('tarif') || msg.includes('abonnement') || msg.includes('pro') || msg.includes('enterprise') || msg.includes('plan')) return pick(BOT_RESPONSES.pricing);
  if (msg.includes('langue') || msg.includes('anglais') || msg.includes('english') || msg.includes('allemand') || msg.includes('traduc')) return pick(BOT_RESPONSES.lang);
  if (msg.includes('rejoindre') || msg.includes('lien') || msg.includes('qr') || msg.includes('installer') || msg.includes('mobile')) return pick(BOT_RESPONSES.access);
  if (msg.includes('session') || msg.includes('créer') || msg.includes('hôte') || msg.includes('synchron')) return pick(BOT_RESPONSES.session);
  if (msg.includes('aide') || msg.includes('help') || msg.includes('comment') || msg.includes('quoi')) return pick(BOT_RESPONSES.help);

  return pick(BOT_RESPONSES.default);
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
        content: "👋 Bonjour ! Je suis l'assistant Boosttribe. Comment puis-je vous aider aujourd'hui ?",
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
              <h3 className="text-white font-semibold text-sm">Assistant Boosttribe</h3>
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
          {!hasAccess ? (
            /* Message pour utilisateurs non-Pro */
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
                <Lock className="w-8 h-8 text-white/50" />
              </div>
              <h3 className="text-white font-semibold mb-2">Assistant Boosttribe réservé aux membres PRO.</h3>
              <p className="text-white/60 text-sm mb-4">
                Passez à Pro ou Enterprise pour accéder à l'assistant.
              </p>
              <a
                href="/pricing"
                className="px-6 py-2 rounded-full text-white text-sm font-medium transition-all hover:opacity-90"
                style={{ background: theme.colors.gradient.primary }}
              >
                Passer à Pro
              </a>
            </div>
          ) : (
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
          )}
        </div>
      )}
    </>
  );
};

export default ChatBot;
