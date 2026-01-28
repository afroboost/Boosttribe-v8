import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";
import { LogOut, User } from "lucide-react";

export const Header: React.FC = () => {
  const { theme } = useTheme();
  const { name, colors, fonts, navigation, buttons } = theme;
  const { isAuthenticated, profile, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Filter out "Communauté" from navigation
  const filteredNavLinks = navigation.links.filter(
    link => link.label.toLowerCase() !== 'communauté'
  );

  const handleStartClick = () => {
    if (isAuthenticated) {
      navigate('/session');
    } else {
      navigate('/login', { state: { from: '/session' } });
    }
  };

  const handleLoginClick = () => {
    navigate('/login');
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

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
            <Link to="/" className="flex items-center gap-2 group">
              {/* Logo Icon */}
              <div 
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center"
                style={{
                  background: colors.gradient.primary,
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
              {/* Logo Text - Dynamic from theme */}
              <span 
                className="text-xl sm:text-2xl font-bold tracking-tight"
                style={{
                  fontFamily: fonts.heading,
                  background: colors.gradient.primary,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {name}
              </span>
            </Link>
          </div>

          {/* Navigation - Dynamic from theme (without Communauté) */}
          <nav className="hidden md:flex items-center gap-8">
            {filteredNavLinks.map((link) => {
              // Skip "Tarifs" as we add it separately with correct route
              if (link.label.toLowerCase() === 'tarifs') return null;
              return (
                <a 
                  key={link.href}
                  href={link.href} 
                  className="text-white/70 hover:text-white transition-colors duration-200 text-sm font-medium"
                  style={{ fontFamily: fonts.body }}
                >
                  {link.label}
                </a>
              );
            })}
            <Link 
              to="/pricing"
              className="text-white/70 hover:text-white transition-colors duration-200 text-sm font-medium"
              style={{ fontFamily: fonts.body }}
            >
              Tarifs
            </Link>
          </nav>

          {/* CTA Buttons */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <>
                {/* User info */}
                <div className="hidden sm:flex items-center gap-2 text-sm text-white/70">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                    {profile?.avatar_url ? (
                      <img 
                        src={profile.avatar_url} 
                        alt="" 
                        className="w-8 h-8 rounded-full"
                      />
                    ) : (
                      <User size={16} />
                    )}
                  </div>
                  <span className="max-w-[100px] truncate">
                    {profile?.full_name || profile?.email?.split('@')[0]}
                  </span>
                  {isAdmin && (
                    <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded-full">
                      Admin
                    </span>
                  )}
                </div>
                
                {/* Sign out button */}
                <button
                  onClick={handleSignOut}
                  className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                  title="Déconnexion"
                >
                  <LogOut size={18} />
                </button>

                <PrimaryButton size="sm" onClick={handleStartClick}>
                  Ma session
                </PrimaryButton>
              </>
            ) : (
              <>
                <PrimaryButton 
                  variant="outline" 
                  size="sm"
                  className="hidden sm:inline-flex"
                  onClick={handleLoginClick}
                >
                  {buttons.login}
                </PrimaryButton>
                <PrimaryButton size="sm" onClick={handleStartClick}>
                  {buttons.start}
                </PrimaryButton>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
