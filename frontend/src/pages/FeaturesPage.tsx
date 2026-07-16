import React from "react";
import { Link } from "react-router-dom";
import { useTheme } from "@/context/ThemeContext";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { MobileMenu } from "@/components/layout/MobileMenu";
import {
  Radio,
  Video,
  Mic,
  MessageCircle,
  FileText,
  Coins,
  Crown,
  Smartphone,
  ArrowRight,
  CheckCircle2
} from "lucide-react";

// 🎨 Palette Afroboost (cohérente, premium) — magenta / rose, accents sobres.
const MAGENTA = "#9A3FC0";
const PINK = "#E24A9E";

// Feature data — reflète TOUTES les nouveautés de BoostTribe.
const FEATURES = [
  {
    id: 1,
    icon: Radio,
    title: "Sessions d'écoute synchronisées",
    description: "Animez des lives où tout le monde écoute et regarde la même chose, au même instant. Musique, vidéo uploadée ou lien YouTube/Vimeo : l'hôte pilote la lecture pour tous, sans décalage.",
    benefits: ["Synchronisation temps réel", "Audio ET vidéo", "L'hôte contrôle la lecture"],
    color: MAGENTA,
  },
  {
    id: 2,
    icon: Video,
    title: "Live Visio façon Zoom",
    description: "Activez la caméra et voyez les participants en direct pendant la session. Une scène jusqu'à 10 intervenants, le « lever la main » pour monter, le spotlight pour épingler une caméra et le partage d'écran.",
    benefits: ["Scène jusqu'à 10 caméras", "Lever la main + spotlight", "Partage d'écran"],
    color: PINK,
  },
  {
    id: 3,
    icon: Mic,
    title: "Micro & voix privée",
    description: "Prenez le micro pour guider votre audience. Parlez à tout le groupe, ou en privé à un ou plusieurs participants choisis. Un seul bouton micro clair pour parler en live.",
    benefits: ["Voix en direct", "Conversation privée", "Volume par participant"],
    color: MAGENTA,
  },
  {
    id: 4,
    icon: MessageCircle,
    title: "Chat en direct",
    description: "Un chat intégré pour échanger pendant la session : messages au groupe, échanges privés et assistant BoostTribe. Likes, commentaires et partage de vidéo, image ou lien complètent l'expérience.",
    benefits: ["Messages groupe & privés", "Assistant intégré", "Likes & partages"],
    color: PINK,
  },
  {
    id: 5,
    icon: FileText,
    title: "Enregistrement complet + Transcription IA",
    description: "Option premium : enregistrez toute la session (toutes les voix + la musique), puis obtenez automatiquement une transcription en français et un résumé / notes de cours. Audio et texte téléchargeables.",
    benefits: ["Capte toutes les voix", "Transcription FR + résumé", "Consentement & téléchargement"],
    color: MAGENTA,
  },
  {
    id: 6,
    icon: Coins,
    title: "Crédits simples, sans abonnement",
    description: "1 crédit = 1 accès à un live. Pas d'abonnement : vous payez ce que vous utilisez. Votre 1er cours est offert à l'inscription, et les crédits achetés restent valables plusieurs mois.",
    benefits: ["1 crédit = 1 accès live", "1er cours offert", "Crédits valables dans le temps"],
    color: PINK,
  },
  {
    id: 7,
    icon: Crown,
    title: "Espace Coach",
    description: "Animez vos propres sessions et choisissez votre modèle. L'Abonnement Illimité (99,99 CHF/mois) offre des crédits illimités et 0% de commission ; vous encaissez vos élèves vous-même via votre lien/QR privé.",
    benefits: ["Abonnement illimité 99,99/mois", "0% de commission", "Modes ouverte / payante / privée"],
    color: MAGENTA,
  },
  {
    id: 8,
    icon: Smartphone,
    title: "Accès simple, partout",
    description: "Aucune application à installer. Vos participants rejoignent en un clic via un lien ou un QR code, sur tous les appareils. Installable en PWA pour un accès immédiat.",
    benefits: ["Lien ou QR code", "Pas d'installation", "PWA installable"],
    color: PINK,
  },
];

// Feature Card Component
interface FeatureCardProps {
  feature: typeof FEATURES[0];
  index: number;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ feature, index }) => {
  const Icon = feature.icon;
  
  return (
    <div 
      className="group relative p-6 sm:p-8 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm transition-all duration-200 hover:border-white/20 hover:bg-white/[0.06] hover:-translate-y-0.5"
      style={{
        animationDelay: `${index * 0.1}s`,
        animation: "fadeInUp 0.6s ease-out forwards",
        opacity: 0,
      }}
    >
      {/* Glow effect on hover */}
      <div 
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-20 transition-opacity duration-300 blur-xl"
        style={{ background: feature.color }}
      />
      
      {/* Icon */}
      <div 
        className="relative w-14 h-14 rounded-xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110"
        style={{ 
          background: `linear-gradient(135deg, ${feature.color}40 0%, ${feature.color}20 100%)`,
          boxShadow: `0 0 20px ${feature.color}20`,
        }}
      >
        <Icon
          size={28}
          style={{ color: feature.color }}
        />
      </div>
      
      {/* Title */}
      <h3 
        className="relative text-xl font-bold text-white mb-3"
        style={{ fontFamily: "'Space Grotesk', sans-serif" }}
      >
        {feature.title}
      </h3>
      
      {/* Description */}
      <p className="relative text-white/60 text-sm leading-relaxed mb-5">
        {feature.description}
      </p>
      
      {/* Benefits */}
      <ul className="relative space-y-2">
        {feature.benefits.map((benefit, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <CheckCircle2 size={16} style={{ color: feature.color }} className="flex-shrink-0" />
            <span className="text-white/70">{benefit}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// Main Features Page
const FeaturesPage: React.FC = () => {
  const { theme } = useTheme();
  const { colors, fonts } = theme;

  return (
    <div 
      className="min-h-screen"
      style={{ background: "#000000" }}
    >
      {/* Header */}
      <header 
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          background: "rgba(0, 0, 0, 0.55)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            <Link to="/" className="flex items-center gap-2">
              <div 
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center"
                style={{ background: colors.gradient.primary }}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="currentColor">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
              <span 
                className="text-xl sm:text-2xl font-bold"
                style={{
                  fontFamily: fonts.heading,
                  backgroundImage: colors.gradient.primary,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {theme.name}
              </span>
            </Link>
            
            <div className="flex items-center gap-3 sm:gap-4">
              <Link to="/pricing" className="text-white/70 hover:text-white text-sm hidden sm:block">
                Tarifs
              </Link>
              <Link to="/session" className="hidden sm:block">
                <PrimaryButton size="sm">
                  Commencer
                </PrimaryButton>
              </Link>
              {/* 📱 Menu hamburger réutilisé (mobile) */}
              <MobileMenu />
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section — éditorial */}
      <section className="pt-40 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="eyebrow mb-6" style={{ color: colors.primary }}>Fonctionnalités</p>

          <h1 className="font-display display-hero text-white mb-8">
            Tout, pour un live
            <br />
            <span className="font-display-italic text-white/90">parfaitement synchronisé.</span>
          </h1>

          <p
            className="text-lg sm:text-xl text-white/55 max-w-2xl mx-auto leading-relaxed"
            style={{ fontFamily: fonts.body }}
          >
            Lives synchronisés, Live Visio, chat en direct et transcription IA — une plateforme complète pour animer et partager vos sessions.
          </p>
        </div>
      </section>

      {/* Features Grid */}
      <section className="pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {FEATURES.map((feature, index) => (
              <FeatureCard key={feature.id} feature={feature} index={index} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section 
        className="py-20 px-4 sm:px-6 lg:px-8"
        style={{
          background: "linear-gradient(180deg, transparent 0%, rgba(122, 92, 255, 0.1) 50%, transparent 100%)",
        }}
      >
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display display-chapter text-white mb-6">
            Prêt à créer votre<br />première session ?
          </h2>
          <p className="text-white/60 mb-8 text-lg">
            Votre 1er cours est offert. Créez une session en quelques secondes — aucune installation requise.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/session">
              <PrimaryButton size="lg" className="group">
                Créer ma session gratuite
                <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
              </PrimaryButton>
            </Link>
            <Link to="/pricing">
              <PrimaryButton variant="outline" size="lg">
                Voir les tarifs
              </PrimaryButton>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-white/40 text-sm">
              © 2024–{new Date().getFullYear()} {theme.name}. Tous droits réservés.
            </p>
            <div className="flex items-center gap-6">
              <Link to="/" className="text-white/40 hover:text-white text-sm transition-colors">
                Accueil
              </Link>
              <Link to="/pricing" className="text-white/40 hover:text-white text-sm transition-colors">
                Tarifs
              </Link>
              <Link to="/login" className="text-white/40 hover:text-white text-sm transition-colors">
                Connexion
              </Link>
            </div>
          </div>
        </div>
      </footer>

      {/* CSS Animations */}
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default FeaturesPage;
