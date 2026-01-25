import React from "react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

export const HeroSection = () => {
  return (
    <section 
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{ 
        background: "#000000",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Background Glow Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Primary violet glow - top left */}
        <div 
          className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 rounded-full opacity-30 blur-3xl"
          style={{
            background: "radial-gradient(circle, #8A2EFF 0%, transparent 70%)",
          }}
        />
        {/* Secondary rose glow - bottom right */}
        <div 
          className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full opacity-25 blur-3xl"
          style={{
            background: "radial-gradient(circle, #FF2FB3 0%, transparent 70%)",
          }}
        />
        {/* Center subtle glow behind title */}
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-64 rounded-full opacity-20 blur-3xl"
          style={{
            background: "radial-gradient(ellipse, #8A2EFF 0%, #FF2FB3 50%, transparent 80%)",
          }}
        />
      </div>

      {/* Animated particles/rhythm dots */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full"
            style={{
              background: i % 2 === 0 ? "#8A2EFF" : "#FF2FB3",
              opacity: Math.random() * 0.5 + 0.2,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `bt-float ${3 + Math.random() * 4}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 2}s`,
            }}
          />
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <div 
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 opacity-0"
          style={{
            background: "rgba(138, 46, 255, 0.15)",
            border: "1px solid rgba(138, 46, 255, 0.3)",
            animation: "bt-fade-in 0.6s ease-out 0.2s forwards",
          }}
        >
          <span 
            className="w-2 h-2 rounded-full"
            style={{ background: "#8A2EFF" }}
          />
          <span 
            className="text-sm text-white/80"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            La communauté des créateurs de musique
          </span>
        </div>

        {/* Main Title with Gradient and Glow */}
        <div className="relative mb-6">
          {/* Glow layer behind title */}
          <h1 
            className="absolute inset-0 text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight blur-2xl opacity-50 select-none"
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              background: "linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
            aria-hidden="true"
          >
            Beattribe
          </h1>
          {/* Main visible title */}
          <h1 
            className="relative text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight opacity-0"
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              background: "linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              animation: "bt-fade-in 0.8s ease-out 0.4s forwards",
            }}
          >
            Beattribe
          </h1>
        </div>

        {/* Slogan */}
        <p 
          className="text-xl sm:text-2xl md:text-3xl font-medium mb-4 opacity-0"
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            color: "rgba(255, 255, 255, 0.9)",
            animation: "bt-fade-in 0.8s ease-out 0.6s forwards",
          }}
        >
          Unite Through Rhythm
        </p>

        {/* Description */}
        <p 
          className="text-base sm:text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed opacity-0"
          style={{
            fontFamily: "'Inter', sans-serif",
            color: "rgba(255, 255, 255, 0.6)",
            animation: "bt-fade-in 0.8s ease-out 0.8s forwards",
          }}
        >
          Rejoignez la communauté des beatmakers et producteurs. 
          Partagez vos créations, collaborez et évoluez ensemble.
        </p>

        {/* CTA Buttons */}
        <div 
          className="flex flex-col sm:flex-row items-center justify-center gap-4 opacity-0"
          style={{
            animation: "bt-fade-in 0.8s ease-out 1s forwards",
          }}
        >
          <PrimaryButton size="lg">
            Rejoindre la tribu
          </PrimaryButton>
          <PrimaryButton variant="outline" size="lg">
            Explorer les beats
          </PrimaryButton>
        </div>

        {/* Stats */}
        <div 
          className="grid grid-cols-3 gap-8 mt-16 pt-8 border-t border-white/10 max-w-lg mx-auto opacity-0"
          style={{
            animation: "bt-fade-in 0.8s ease-out 1.2s forwards",
          }}
        >
          <div className="text-center">
            <p 
              className="text-2xl sm:text-3xl font-bold"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                background: "linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              50K+
            </p>
            <p 
              className="text-xs sm:text-sm mt-1"
              style={{
                fontFamily: "'Inter', sans-serif",
                color: "rgba(255, 255, 255, 0.5)",
              }}
            >
              Créateurs
            </p>
          </div>
          <div className="text-center">
            <p 
              className="text-2xl sm:text-3xl font-bold"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                background: "linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              1M+
            </p>
            <p 
              className="text-xs sm:text-sm mt-1"
              style={{
                fontFamily: "'Inter', sans-serif",
                color: "rgba(255, 255, 255, 0.5)",
              }}
            >
              Beats partagés
            </p>
          </div>
          <div className="text-center">
            <p 
              className="text-2xl sm:text-3xl font-bold"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                background: "linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              120+
            </p>
            <p 
              className="text-xs sm:text-sm mt-1"
              style={{
                fontFamily: "'Inter', sans-serif",
                color: "rgba(255, 255, 255, 0.5)",
              }}
            >
              Pays
            </p>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div 
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-0"
        style={{
          animation: "bt-fade-in 0.8s ease-out 1.4s forwards",
        }}
      >
        <span 
          className="text-xs uppercase tracking-widest"
          style={{
            fontFamily: "'Inter', sans-serif",
            color: "rgba(255, 255, 255, 0.4)",
          }}
        >
          Découvrir
        </span>
        <div 
          className="w-6 h-10 rounded-full border border-white/20 flex justify-center pt-2"
        >
          <div 
            className="w-1 h-2 rounded-full"
            style={{
              background: "linear-gradient(180deg, #8A2EFF, #FF2FB3)",
              animation: "bt-float 1.5s ease-in-out infinite",
            }}
          />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
