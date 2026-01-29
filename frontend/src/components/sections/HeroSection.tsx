import React, { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { useToast } from "@/components/ui/Toast";

// Interface for particle configuration
interface Particle {
  id: number;
  color: string;
  opacity: number;
  left: string;
  top: string;
  duration: number;
  delay: number;
}

export const HeroSection: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { t } = useI18n();
  const { showToast } = useToast();
  const { name, slogan, description, badge, colors, fonts, buttons, stats, scrollIndicator } = theme;

  // Session code input state
  const [sessionCode, setSessionCode] = useState<string>("");
  const [isJoining, setIsJoining] = useState<boolean>(false);

  // Generate particles with memoization to prevent re-renders
  const particles = useMemo<Particle[]>(() => {
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      color: i % 2 === 0 ? colors.primary : colors.secondary,
      opacity: Math.random() * 0.5 + 0.2,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      duration: 3 + Math.random() * 4,
      delay: Math.random() * 2,
    }));
  }, [colors.primary, colors.secondary]);

  // Handle join session
  const handleJoinSession = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmedCode = sessionCode.trim().toUpperCase();
    
    if (!trimmedCode) {
      showToast("Veuillez entrer un code de session", "error");
      return;
    }
    
    setIsJoining(true);
    
    // Small delay for UX feedback
    setTimeout(() => {
      navigate(`/session/${trimmedCode}`);
    }, 300);
  }, [sessionCode, navigate, showToast]);

  // Handle create new session
  const handleCreateSession = useCallback(() => {
    navigate("/session");
  }, [navigate]);

  // Handle input change
  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Convert to uppercase and remove spaces
    const value = e.target.value.toUpperCase().replace(/\s/g, "");
    setSessionCode(value);
  }, []);

  return (
    <section 
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{ 
        background: colors.background,
        fontFamily: fonts.body,
      }}
    >
      {/* Background Glow Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Primary violet glow - top left */}
        <div 
          className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 rounded-full opacity-30 blur-3xl"
          style={{
            background: `radial-gradient(circle, ${colors.primary} 0%, transparent 70%)`,
          }}
        />
        {/* Secondary rose glow - bottom right */}
        <div 
          className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full opacity-25 blur-3xl"
          style={{
            background: `radial-gradient(circle, ${colors.secondary} 0%, transparent 70%)`,
          }}
        />
        {/* Center subtle glow behind title */}
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-64 rounded-full opacity-20 blur-3xl"
          style={{
            background: `radial-gradient(ellipse, ${colors.primary} 0%, ${colors.secondary} 50%, transparent 80%)`,
          }}
        />
      </div>

      {/* Animated particles/rhythm dots */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map((particle) => (
          <div
            key={particle.id}
            className="absolute w-1 h-1 rounded-full"
            style={{
              background: particle.color,
              opacity: particle.opacity,
              left: particle.left,
              top: particle.top,
              animation: `bt-float ${particle.duration}s ease-in-out infinite`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge - Dynamic from theme or translation */}
        <div 
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 opacity-0"
          style={{
            background: `rgba(138, 46, 255, 0.15)`,
            border: `1px solid rgba(138, 46, 255, 0.3)`,
            animation: "bt-fade-in 0.6s ease-out 0.2s forwards",
          }}
        >
          <span 
            className="w-2 h-2 rounded-full"
            style={{ background: colors.primary }}
          />
          <span 
            className="text-sm text-white/80"
            style={{ fontFamily: fonts.body }}
          >
            {t('hero.badge')}
          </span>
        </div>

        {/* Main Title with Gradient and Glow - Dynamic from theme */}
        <div className="relative mb-6">
          {/* Glow layer behind title */}
          <h1 
            className="absolute inset-0 text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight blur-2xl opacity-50 select-none"
            style={{
              fontFamily: fonts.heading,
              background: colors.gradient.primary,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
            aria-hidden="true"
          >
            {name}
          </h1>
          {/* Main visible title */}
          <h1 
            className="relative text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight opacity-0"
            style={{
              fontFamily: fonts.heading,
              background: colors.gradient.primary,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              animation: "bt-fade-in 0.8s ease-out 0.4s forwards",
            }}
          >
            {name}
          </h1>
        </div>

        {/* Slogan - Dynamic from theme */}
        <p 
          className="text-xl sm:text-2xl md:text-3xl font-medium mb-4 opacity-0"
          style={{
            fontFamily: fonts.heading,
            color: colors.text.secondary,
            animation: "bt-fade-in 0.8s ease-out 0.6s forwards",
          }}
        >
          {slogan}
        </p>

        {/* Description - Dynamic from theme */}
        <p 
          className="text-base sm:text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed opacity-0"
          style={{
            fontFamily: fonts.body,
            color: colors.text.muted,
            animation: "bt-fade-in 0.8s ease-out 0.8s forwards",
          }}
        >
          {description}
        </p>

        {/* Session Join Form */}
        <div 
          className="max-w-md mx-auto mb-8 opacity-0"
          style={{
            animation: "bt-fade-in 0.8s ease-out 1s forwards",
          }}
        >
          <form onSubmit={handleJoinSession} className="space-y-4">
            {/* Session Code Input */}
            <div className="relative">
              <Input
                type="text"
                value={sessionCode}
                onChange={handleCodeChange}
                placeholder="Code de la session (ex: MKTQUYEY-5LFJ94)"
                className="w-full h-14 px-5 text-center text-lg font-mono tracking-wider rounded-xl border-2 transition-all duration-200"
                style={{
                  background: colors.surface,
                  borderColor: sessionCode ? colors.primary : 'rgba(255,255,255,0.1)',
                  color: '#FFFFFF',
                }}
                maxLength={20}
                disabled={isJoining}
              />
              {/* Decorative music note icon */}
              <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg 
                  className="w-5 h-5 text-white/30"
                  fill="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
            </div>

            {/* Join Button */}
            <PrimaryButton 
              type="submit"
              size="lg"
              className="w-full h-14 text-lg"
              disabled={isJoining}
            >
              {isJoining ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Connexion...
                </span>
              ) : (
                <>
                  🎧 {buttons.joinTribe}
                </>
              )}
            </PrimaryButton>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span 
                className="px-3"
                style={{ 
                  background: colors.background,
                  color: colors.text.muted,
                }}
              >
                ou
              </span>
            </div>
          </div>

          {/* Create Session Button */}
          <button
            onClick={handleCreateSession}
            className="w-full h-12 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              color: colors.text.secondary,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = colors.primary;
              e.currentTarget.style.color = '#FFFFFF';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
              e.currentTarget.style.color = colors.text.secondary;
            }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Créer ma session
          </button>
        </div>

        {/* Stats - Dynamic from theme */}
        <div 
          className="grid grid-cols-3 gap-8 mt-16 pt-8 border-t border-white/10 max-w-lg mx-auto opacity-0"
          style={{
            animation: "bt-fade-in 0.8s ease-out 1.2s forwards",
          }}
        >
          {stats.map((stat, index) => (
            <div key={index} className="text-center">
              <p 
                className="text-2xl sm:text-3xl font-bold"
                style={{
                  fontFamily: fonts.heading,
                  background: colors.gradient.primary,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {stat.value}
              </p>
              <p 
                className="text-xs sm:text-sm mt-1"
                style={{
                  fontFamily: fonts.body,
                  color: colors.text.muted,
                }}
              >
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator - Dynamic from theme */}
      <div 
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-0"
        style={{
          animation: "bt-fade-in 0.8s ease-out 1.6s forwards",
        }}
      >
        <span 
          className="text-xs uppercase tracking-widest"
          style={{
            fontFamily: fonts.body,
            color: "rgba(255, 255, 255, 0.4)",
          }}
        >
          {scrollIndicator}
        </span>
        <div 
          className="w-6 h-10 rounded-full border border-white/20 flex justify-center pt-2"
        >
          <div 
            className="w-1 h-2 rounded-full"
            style={{
              background: `linear-gradient(180deg, ${colors.primary}, ${colors.secondary})`,
              animation: "bt-float 1.5s ease-in-out infinite",
            }}
          />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
