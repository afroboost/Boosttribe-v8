import React from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Video, Mic, FileText, ArrowRight } from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useTheme } from "@/context/ThemeContext";
import { useReveal } from "@/hooks/useReveal";
import HomeCarousel from "@/components/sections/HomeCarousel";

// Chapitres éditoriaux — copie honnête, dérivée des fonctionnalités réelles.
interface Chapter {
  eyebrow: string;
  title: React.ReactNode;
  body: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties; strokeWidth?: number }>;
}

const CHAPTERS: Chapter[] = [
  {
    eyebrow: "En direct",
    title: <>Le même live,<br />pour toute la tribu.</>,
    body:
      "Animez des sessions où chacun écoute et regarde la même chose, au même instant. Musique, vidéo ou lien YouTube/Vimeo : l'hôte pilote la lecture pour tous, sans décalage.",
    icon: Radio,
  },
  {
    eyebrow: "Visio",
    title: <>Une scène,<br />jusqu'à dix caméras.</>,
    body:
      "Activez la caméra et voyez les participants en direct. Le lever de main pour monter sur scène, le spotlight pour épingler une caméra, le partage d'écran — comme un vrai plateau.",
    icon: Video,
  },
  {
    eyebrow: "Voix",
    title: <>Votre voix,<br />au bon moment.</>,
    body:
      "Prenez le micro pour guider votre audience. Parlez à tout le groupe, ou en privé à quelques participants choisis. Un seul bouton, clair, pour passer en live.",
    icon: Mic,
  },
  {
    eyebrow: "Après la séance",
    title: <>Tout est gardé,<br />puis transcrit.</>,
    body:
      "Enregistrez la session entière — toutes les voix et la musique — puis recevez automatiquement une transcription en français et un résumé. Audio et texte téléchargeables.",
    icon: FileText,
  },
];

// Visuel éditorial d'un chapitre — panneau translucide, icône XXL + motif « onde » sobre.
const ChapterVisual: React.FC<{ icon: Chapter["icon"]; accent: string }> = ({ icon: Icon, accent }) => (
  <div
    className="relative aspect-[4/3] w-full rounded-[28px] overflow-hidden border border-white/10 flex items-center justify-center"
    style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)" }}
  >
    {/* halo accent très diffus */}
    <div
      aria-hidden="true"
      className="absolute -inset-8 opacity-[0.18] blur-3xl"
      style={{ background: `radial-gradient(circle at 50% 40%, ${accent} 0%, transparent 65%)` }}
    />
    <Icon size={72} className="relative z-10 text-white/90" strokeWidth={1.25} />
    {/* Motif onde / égaliseur — signature rythme, discrète */}
    <div aria-hidden="true" className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-end gap-1.5 h-10">
      {[10, 22, 14, 32, 18, 26, 12].map((h, i) => (
        <span
          key={i}
          className="w-1 rounded-full"
          style={{ height: h, background: accent, opacity: 0.45 }}
        />
      ))}
    </div>
  </div>
);

export const StorySections: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { colors } = theme;
  const revealRef = useReveal<HTMLDivElement>();

  return (
    <div ref={revealRef} className="relative" style={{ background: colors.background }}>
      {/* Bande cinématique — carrousel plein-largeur (ne s'affiche que si images en admin) */}
      <section className="px-6 py-10">
        <div className="reveal mx-auto max-w-6xl">
          <HomeCarousel />
        </div>
      </section>

      {/* Chapitres storytelling */}
      {CHAPTERS.map((ch, i) => {
        const flip = i % 2 === 1;
        return (
          <section key={i} className="px-6 py-24 sm:py-32">
            <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              {/* Texte */}
              <div className={`reveal ${flip ? "lg:order-2" : ""}`}>
                <p className="eyebrow mb-5" style={{ color: colors.primary }}>{ch.eyebrow}</p>
                <h2 className="font-display display-chapter text-white mb-6">{ch.title}</h2>
                <p className="text-lg leading-relaxed text-white/55 max-w-lg">{ch.body}</p>
              </div>
              {/* Visuel */}
              <div className={`reveal reveal-delay-1 ${flip ? "lg:order-1" : ""}`}>
                <ChapterVisual icon={ch.icon} accent={colors.primary} />
              </div>
            </div>
          </section>
        );
      })}

      {/* Chapitre final — CTA */}
      <section className="px-6 py-28 sm:py-40 border-t border-white/[0.06]">
        <div className="reveal mx-auto max-w-3xl text-center">
          <p className="eyebrow mb-6" style={{ color: colors.primary }}>Prêt·e ?</p>
          <h2 className="font-display display-chapter text-white mb-6">
            Lancez votre première<br />session en direct.
          </h2>
          <p className="text-lg text-white/55 max-w-xl mx-auto mb-10">
            Votre premier cours est offert. Aucune installation : vos participants rejoignent en un lien ou un QR code.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <PrimaryButton size="lg" className="group" onClick={() => navigate("/session")}>
              Créer ma session
              <ArrowRight size={18} className="ml-2 transition-transform duration-200 group-hover:translate-x-0.5" />
            </PrimaryButton>
            <PrimaryButton variant="outline" size="lg" onClick={() => navigate("/pricing")}>
              Voir les tarifs
            </PrimaryButton>
          </div>
        </div>
      </section>
    </div>
  );
};

export default StorySections;
