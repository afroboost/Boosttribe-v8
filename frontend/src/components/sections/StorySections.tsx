import React from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Video, Mic, FileText, ArrowRight } from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useTheme } from "@/context/ThemeContext";
import { useReveal } from "@/hooks/useReveal";
import HomeCarousel from "@/components/sections/HomeCarousel";

type Tone = "light" | "dark";

const TONES: Record<Tone, { bg: string; title: string; body: string; panelBg: string; panelBorder: string; icon: string }> = {
  light: { bg: "#FFFFFF", title: "#1D1D1F", body: "#6E6E73", panelBg: "#F5F5F7", panelBorder: "#E5E5EA", icon: "#1D1D1F" },
  dark: { bg: "#000000", title: "#F5F5F7", body: "#A1A1A6", panelBg: "#1C1C1E", panelBorder: "rgba(255,255,255,0.10)", icon: "#FFFFFF" },
};

interface Chapter {
  eyebrow: string;
  title: React.ReactNode;
  body: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties; strokeWidth?: number }>;
}

// Chapitres éditoriaux — copie honnête, dérivée des fonctionnalités réelles.
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

// Visuel d'un chapitre — panneau monochrome tonal + icône XXL + motif « onde » (accent discret).
const ChapterVisual: React.FC<{ icon: Chapter["icon"]; tone: Tone; accent: string }> = ({ icon: Icon, tone, accent }) => {
  const c = TONES[tone];
  return (
    <div
      className="relative mx-auto w-full max-w-3xl aspect-video rounded-[28px] overflow-hidden flex items-center justify-center"
      style={{ background: c.panelBg, border: `1px solid ${c.panelBorder}` }}
    >
      <Icon size={84} strokeWidth={1.25} className="bt-icon-breathe" style={{ color: c.icon }} />
      {/* Motif onde / égaliseur — seule touche d'accent, animé en douceur */}
      <div aria-hidden="true" className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-end gap-1.5 h-10">
        {[10, 24, 15, 34, 19, 28, 13].map((h, i) => (
          <span
            key={i}
            className="bt-eq-bar w-1 rounded-full"
            style={{ height: h, background: accent, opacity: 0.7, animationDelay: `${i * 0.13}s` }}
          />
        ))}
      </div>
    </div>
  );
};

// Une section plein écran, centrée (composition façon page produit Apple).
const ChapterSection: React.FC<{ chapter: Chapter; tone: Tone; accent: string }> = ({ chapter, tone, accent }) => {
  const c = TONES[tone];
  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-6 py-24" style={{ background: c.bg }}>
      <div className="w-full max-w-5xl mx-auto text-center">
        <p className="eyebrow reveal mb-5" style={{ color: accent }}>{chapter.eyebrow}</p>
        <h2 className="font-display display-chapter reveal reveal-delay-1 mb-6" style={{ color: c.title }}>{chapter.title}</h2>
        <p className="reveal reveal-delay-2 mx-auto max-w-xl text-lg leading-relaxed mb-14" style={{ color: c.body }}>{chapter.body}</p>
        <div className="reveal reveal-delay-3">
          <ChapterVisual icon={chapter.icon} tone={tone} accent={accent} />
        </div>
      </div>
    </section>
  );
};

export const StorySections: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { colors } = theme;
  const accent = colors.primary;
  const revealRef = useReveal<HTMLDivElement>();

  // La hero est BLANCHE → on démarre en NOIR, puis on alterne.
  const tones: Tone[] = ["light", "dark", "light", "dark"];

  return (
    <div ref={revealRef}>
      {CHAPTERS.map((ch, i) => (
        <ChapterSection key={i} chapter={ch} tone={tones[i]} accent={accent} />
      ))}

      {/* Bande cinématique — carrousel plein-largeur sur NOIR (si images en admin) */}
      <section className="px-6 py-24" style={{ background: "#000000" }}>
        <div className="reveal mx-auto max-w-6xl">
          <p className="eyebrow mb-8 text-center" style={{ color: accent }}>La tribu, partout</p>
          <HomeCarousel />
        </div>
      </section>

      {/* Chapitre final — CTA sur BLANC */}
      <section className="min-h-[70vh] flex flex-col items-center justify-center px-6 py-28" style={{ background: "#FFFFFF" }}>
        <div className="reveal mx-auto max-w-3xl text-center">
          <h2 className="font-display display-chapter mb-6" style={{ color: "#1D1D1F" }}>
            Lancez votre première<br />session en direct.
          </h2>
          <p className="text-lg max-w-xl mx-auto mb-10" style={{ color: "#6E6E73" }}>
            Votre premier cours est offert. Aucune installation : vos participants rejoignent en un lien ou un QR code.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <PrimaryButton size="lg" className="group" onClick={() => navigate("/session")}>
              Créer ma session
              <ArrowRight size={18} className="ml-2 transition-transform duration-200 group-hover:translate-x-0.5" />
            </PrimaryButton>
            <button
              onClick={() => navigate("/pricing")}
              className="h-14 px-8 rounded-full font-medium transition-all duration-200"
              style={{ border: "1px solid #1D1D1F", color: "#1D1D1F" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#1D1D1F"; e.currentTarget.style.color = "#FFFFFF"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#1D1D1F"; }}
            >
              Voir les tarifs
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default StorySections;
