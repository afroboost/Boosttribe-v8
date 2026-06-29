import React, { useState, useRef, useEffect } from 'react';
import { Send, Lock } from 'lucide-react';
import { getCreditsConfig, type CreditsConfig } from '@/lib/paymentApi';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// 🧠 Connaissances de l'assistant BoostTribe — système de CRÉDITS (1 crédit = 1 accès à un live).
// Les textes "crédits/tarifs" sont enrichis dynamiquement depuis la config admin (getCreditsConfig).
const BOT_RESPONSES: Record<string, string[]> = {
  default: [
    "Bonjour ! Je suis l'assistant BoostTribe 👋 Je peux vous parler des sessions synchronisées, du Live Visio, du chat en direct, du micro, de l'enregistrement + transcription IA, des modes de session (ouverte / payante / privée), de l'Espace Coach et des crédits.",
    "BoostTribe permet d'animer des lives où tout le monde écoute/regarde la même chose, parfaitement synchronisé, avec visio, chat et transcription IA. Posez-moi votre question !",
  ],
  session: [
    "Pour créer une session : cliquez sur « Créer ma session ». Vous partagez ensuite un lien ou un QR code, et vos participants rejoignent en un clic — audio ET vidéo restent synchronisés pour tout le monde.",
    "Dans une session, l'hôte contrôle la lecture pour tous : musique, vidéo uploadée ou lien YouTube/Vimeo, tout est synchronisé au même instant. Trois modes d'accès : Ouverte (crédits), Payante (billet CHF) ou Privée (lien/QR).",
  ],
  modes: [
    "Trois modes d'accès au choix de l'hôte : 🟢 Ouverte — le public dépense 1 crédit pour rejoindre ; 💳 Payante — billet en CHF (réservée aux coachs en mode commission) ; 🔒 Privée — accès gratuit sur invitation via lien/QR, avec salle d'attente.",
  ],
  video: [
    "BoostTribe synchronise aussi la VIDÉO : partagez une vidéo uploadée ou un lien YouTube/Vimeo, et tous les participants la voient au même instant (l'hôte pilote play/pause/seek).",
  ],
  visio: [
    "Le Live Visio, c'est la visio façon Zoom DANS la session : activez votre caméra et voyez les autres en direct, tout en gardant la vidéo partagée. Scène jusqu'à 10 intervenants, « lever la main » pour demander à monter, spotlight pour épingler une caméra, et partage d'écran. Le lecteur est même déplaçable. 🎥",
  ],
  voice: [
    "Côté voix : prenez le micro pour guider votre audience, parlez à tout le groupe ou en privé à un ou plusieurs participants choisis. Chaque participant peut aussi régler le volume des autres.",
  ],
  record: [
    "Option premium : l'hôte peut lancer l'ENREGISTREMENT COMPLET de la session (toutes les voix + la musique) puis obtenir automatiquement une TRANSCRIPTION IA en français + un résumé / notes de cours. L'audio et la transcription sont téléchargeables dans l'Espace Coach. Un avis de consentement et un bandeau préviennent les participants. L'option coûte quelques crédits (réglable par l'admin).",
  ],
  chat: [
    "Un CHAT en direct accompagne chaque session : messages au groupe, échanges privés et assistant intégré. Likes, commentaires, photos de profil et partage de vidéo/image/lien complètent l'expérience de groupe. 💬",
  ],
  coach: [
    "Espace Coach : deviens coach pour animer tes propres sessions. L'Abonnement Illimité (99,99 CHF/mois) te donne des crédits illimités et 0% de commission — tu encaisses tes élèves toi-même via ton lien/QR privé. Sur demande, l'admin peut te passer en mode commission (billets payants en CHF encaissés via la plateforme, virements par IBAN). Rends-toi sur la page Tarifs → « Devenir Coach ».",
  ],
  private: [
    "Les sessions privées ont une SALLE D'ATTENTE : même si le lien fuite, l'hôte admet (ou refuse) chaque participant manuellement. Parfait pour réserver tes lives à tes invités.",
  ],
  lang: [
    "L'application est multilingue : Français, Anglais et Allemand (bouton globe 🌐). Le français est la langue par défaut.",
  ],
  access: [
    "Rejoindre une session est ultra simple : un lien ou un QR code, aucune application à installer, compatible tous appareils (et installable en PWA).",
  ],
  help: [
    "Je peux vous expliquer : les crédits (1er cours offert), les sessions synchronisées, le Live Visio (scène jusqu'à 10, lever la main, spotlight, partage d'écran), le chat en direct, le micro & la voix privée, l'enregistrement + transcription IA, les modes de session (ouverte/payante/privée), l'Espace Coach (abonnement 99,99/mois) et les langues. Que voulez-vous savoir ?",
  ],
};

// Texte « crédits » par défaut (si la config admin n'est pas encore chargée).
const CREDITS_FALLBACK =
  "BoostTribe fonctionne avec des CRÉDITS (en CHF), sans abonnement : 1 crédit = 1 accès à un live. " +
  "Vous dépensez 1 crédit pour rejoindre un live, et l'animateur dépense 1 crédit pour l'héberger. " +
  "Votre 1er cours est offert à l'inscription, et les crédits achetés sont valables 12 mois. " +
  "Achetez des packs depuis la page Tarifs.";

// Construit la réponse « crédits » à partir de la config admin (dynamique).
function buildCreditsText(cfg: CreditsConfig | null): string {
  if (!cfg) return CREDITS_FALLBACK;
  const parts: string[] = [];
  parts.push("BoostTribe fonctionne avec des CRÉDITS, sans abonnement : 1 crédit = 1 accès à un live.");
  parts.push(`Rejoindre un live coûte ${cfg.cost_join} crédit(s) ; l'animer coûte ${cfg.cost_host} crédit(s).`);
  if (cfg.signup_free_credits > 0) parts.push(`Votre 1er cours est offert (${cfg.signup_free_credits} crédit(s) à l'inscription).`);
  parts.push(`Les crédits achetés sont valables ${cfg.credit_validity_months} mois.`);
  if (cfg.packs && cfg.packs.length) {
    const list = cfg.packs.slice(0, 4).map((p) => `${p.name} (${p.credits} cr. — ${Number(p.price_chf).toFixed(0)} CHF)`).join(', ');
    parts.push(`Packs disponibles : ${list}.`);
  }
  const activeOffers = Object.values(cfg.offers || {}).filter((o: any) => o && o.enabled).map((o: any) => o.title);
  if (activeOffers.length) parts.push(`Offres en cours : ${activeOffers.join(', ')}.`);
  return parts.join(' ');
}

// Détection par mots-clés (français)
function getBotResponse(userMessage: string, cfg: CreditsConfig | null): string {
  const msg = userMessage.toLowerCase();
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

  // Coach / abonnement : prioritaire sur « crédits » pour bien orienter vers l'Espace Coach.
  if (msg.includes('coach') || msg.includes('abonn') || msg.includes('illimité') || msg.includes('illimite') ||
      msg.includes('commission') || msg.includes('animateur') || msg.includes('99'))
    return pick(BOT_RESPONSES.coach);
  if (msg.includes('crédit') || msg.includes('credit') || msg.includes('prix') || msg.includes('tarif') ||
      msg.includes('coût') || msg.includes('cout') || msg.includes('payer') || msg.includes('acheter') ||
      msg.includes('pack') || msg.includes('gratuit') || msg.includes('free') ||
      msg.includes('plan') || msg.includes('chf'))
    return buildCreditsText(cfg);
  if (msg.includes('transcri') || msg.includes('enregistr') || msg.includes('record') || msg.includes('résumé') || msg.includes('resume') || msg.includes('télécharg')) return pick(BOT_RESPONSES.record);
  if (msg.includes('visio') || msg.includes('caméra') || msg.includes('camera') || msg.includes('zoom') || msg.includes('webcam') || msg.includes('main') || msg.includes('spotlight') || msg.includes('écran') || msg.includes('ecran') || msg.includes('scène') || msg.includes('scene')) return pick(BOT_RESPONSES.visio);
  if (msg.includes('mode') || msg.includes('ouverte') || msg.includes('accès') || msg.includes('acces')) return pick(BOT_RESPONSES.modes);
  if (msg.includes('privé') || msg.includes('prive') || msg.includes('salle') || msg.includes('attente') || msg.includes('admet') || msg.includes('payant')) return pick(BOT_RESPONSES.private);
  if (msg.includes('chat') || msg.includes('message') || msg.includes('commentaire') || msg.includes('like') || msg.includes('aime') || msg.includes('photo')) return pick(BOT_RESPONSES.chat);
  if (msg.includes('micro') || msg.includes('voix') || msg.includes('parler')) return pick(BOT_RESPONSES.voice);
  if (msg.includes('vidéo') || msg.includes('video') || msg.includes('youtube') || msg.includes('vimeo')) return pick(BOT_RESPONSES.video);
  if (msg.includes('langue') || msg.includes('anglais') || msg.includes('english') || msg.includes('allemand') || msg.includes('traduc')) return pick(BOT_RESPONSES.lang);
  if (msg.includes('rejoindre') || msg.includes('lien') || msg.includes('qr') || msg.includes('installer') || msg.includes('mobile')) return pick(BOT_RESPONSES.access);
  if (msg.includes('session') || msg.includes('créer') || msg.includes('hôte') || msg.includes('synchron')) return pick(BOT_RESPONSES.session);
  if (msg.includes('aide') || msg.includes('help') || msg.includes('comment') || msg.includes('quoi')) return pick(BOT_RESPONSES.help);

  return pick(BOT_RESPONSES.default);
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
        id: `${Date.now()}-a`, role: 'assistant', content: getBotResponse(userMessage.content, creditsCfg), timestamp: Date.now(),
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
        <a
          href="/pricing"
          className="px-6 py-2 rounded-full text-white text-sm font-medium transition-all hover:opacity-90"
          style={{ background: gradient }}
        >
          Acheter des crédits
        </a>
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
                msg.role === 'user' ? 'bg-purple-500 text-white rounded-br-sm' : 'bg-white/10 text-white/90 rounded-bl-sm'
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
            className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-purple-500"
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
