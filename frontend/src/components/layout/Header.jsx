import React from "react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

export const Header = () => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div 
        className="mx-auto px-4 sm:px-6 lg:px-8"
        style={{
          background: "rgba(0, 0, 0, 0.5)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Logo */}
          <div className="flex items-center">
            <a href="/" className="flex items-center gap-2 group">
              {/* Logo Icon */}
              <div 
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)",
                }}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  className="w-5 h-5 sm:w-6 sm:h-6 text-white"
                  fill="currentColor"
                >
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
              {/* Logo Text */}
              <span 
                className="text-xl sm:text-2xl font-bold tracking-tight"
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  background: "linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Beattribe
              </span>
            </a>
          </div>

          {/* Navigation - Hidden on mobile for now */}
          <nav className="hidden md:flex items-center gap-8">
            <a 
              href="#features" 
              className="text-white/70 hover:text-white transition-colors duration-200 text-sm font-medium"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              Fonctionnalités
            </a>
            <a 
              href="#community" 
              className="text-white/70 hover:text-white transition-colors duration-200 text-sm font-medium"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              Communauté
            </a>
            <a 
              href="#pricing" 
              className="text-white/70 hover:text-white transition-colors duration-200 text-sm font-medium"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              Tarifs
            </a>
          </nav>

          {/* CTA Button */}
          <div className="flex items-center gap-3">
            <PrimaryButton 
              variant="outline" 
              size="sm"
              className="hidden sm:inline-flex"
            >
              Connexion
            </PrimaryButton>
            <PrimaryButton size="sm">
              Commencer
            </PrimaryButton>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
