import React from "react";
import { Link } from "react-router-dom";
import { useTheme } from "@/context/ThemeContext";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { 
  Dumbbell, 
  Mic, 
  Headphones, 
  Users, 
  Smartphone, 
  Share2,
  ArrowRight,
  CheckCircle2
} from "lucide-react";

// Feature data with icons and descriptions
const FEATURES = [
  {
    id: 1,
    icon: Dumbbell,
    title: "Séances sport & danse synchronisées",
    description: "Animez vos cours collectifs avec une musique parfaitement synchronisée pour tous les participants. Chacun suit le même rythme, peu importe où il se trouve.",
    benefits: ["Synchronisation en temps réel", "Pas de décalage audio", "Expérience immersive"],
    color: "#8A2EFF",
  },
  {
    id: 2,
    icon: Mic,
    title: "Animation de groupes avec contrôle total",
    description: "Prenez le micro et guidez votre audience. Votre voix se superpose à la musique avec un ducking automatique pour une communication claire.",
    benefits: ["Voice-over en direct", "Ducking automatique", "Contrôle du volume"],
    color: "#FF2FB3",
  },
  {
    id: 3,
    icon: Headphones,
    title: "Expériences immersives sans bruit ambiant",
    description: "Organisez des événements Silent Disco ou des séances de méditation guidée. Chaque participant est plongé dans son propre univers sonore.",
    benefits: ["Zéro pollution sonore", "Concentration maximale", "Qualité audio HD"],
    color: "#00D4FF",
  },
  {
    id: 4,
    icon: Users,
    title: "Ateliers, formations et team building",
    description: "Créez des sessions interactives pour vos équipes. Partagez des contenus audio pendant vos ateliers créatifs ou vos séminaires d'entreprise.",
    benefits: ["Jusqu'à 100 participants", "Gestion des rôles", "Analytics en temps réel"],
    color: "#00FF88",
  },
  {
    id: 5,
    icon: Smartphone,
    title: "Accès simple depuis son smartphone",
    description: "Aucune application à installer. Vos participants rejoignent la session en un clic via leur navigateur mobile. C'est aussi simple qu'un lien à partager.",
    benefits: ["PWA responsive", "Pas d'installation", "Compatible tous appareils"],
    color: "#FFB800",
  },
  {
    id: 6,
    icon: Share2,
    title: "Création de contenus pour les réseaux",
    description: "Enregistrez vos sessions et créez du contenu engageant pour vos réseaux sociaux. Montrez l'énergie de vos événements en ligne.",
    benefits: ["Export audio/vidéo", "Partage facile", "Branding personnalisé"],
    color: "#FF6B6B",
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
      className="group relative p-6 sm:p-8 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm transition-all duration-300 hover:border-white/20 hover:bg-white/10 hover:scale-[1.02] hover:shadow-2xl"
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
          className="transition-transform duration-300 group-hover:rotate-6"
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
          background: "rgba(0, 0, 0, 0.8)",
          backdropFilter: "blur(20px)",
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
                  background: colors.gradient.primary,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {theme.name}
              </span>
            </Link>
            
            <div className="flex items-center gap-4">
              <Link to="/pricing" className="text-white/70 hover:text-white text-sm hidden sm:block">
                Tarifs
              </Link>
              <Link to="/session">
                <PrimaryButton size="sm">
                  Commencer
                </PrimaryButton>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <div 
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 bg-white/5 mb-6"
            style={{ animation: "fadeInUp 0.6s ease-out" }}
          >
            <span className="text-white/60 text-sm">✨ Fonctionnalités</span>
          </div>
          
          <h1 
            className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6"
            style={{ 
              fontFamily: fonts.heading,
              animation: "fadeInUp 0.6s ease-out 0.1s forwards",
              opacity: 0,
            }}
          >
            Tout ce dont vous avez besoin pour{" "}
            <span 
              style={{
                background: colors.gradient.primary,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              synchroniser vos sessions
            </span>
          </h1>
          
          <p 
            className="text-lg sm:text-xl text-white/60 max-w-2xl mx-auto"
            style={{ 
              fontFamily: fonts.body,
              animation: "fadeInUp 0.6s ease-out 0.2s forwards",
              opacity: 0,
            }}
          >
            Une plateforme complète pour créer des expériences audio partagées inoubliables.
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
          background: "linear-gradient(180deg, transparent 0%, rgba(138, 46, 255, 0.1) 50%, transparent 100%)",
        }}
      >
        <div className="max-w-3xl mx-auto text-center">
          <h2 
            className="text-3xl sm:text-4xl font-bold text-white mb-6"
            style={{ fontFamily: fonts.heading }}
          >
            Prêt à créer votre première session ?
          </h2>
          <p className="text-white/60 mb-8 text-lg">
            Rejoignez des milliers d'animateurs qui utilisent Boosttribe pour leurs événements.
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
              © 2024 {theme.name}. Tous droits réservés.
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
