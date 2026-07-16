import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";
import { LanguageSelector } from "@/context/I18nContext";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { MobileMenu } from "@/components/layout/MobileMenu";
import { ProfilePhotoEditor } from "@/components/profile/ProfilePhotoEditor";
import { sessionExists } from "@/lib/supabaseClient";
import { getMyLastSession } from "@/lib/paymentApi";
import { LogOut, Settings } from "lucide-react";

export const Header: React.FC = () => {
  const { theme } = useTheme();
  const { name, colors, fonts, navigation, buttons } = theme;
  const { isAuthenticated, profile, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Filter out "Communauté" from navigation
  const filteredNavLinks = navigation.links.filter(
    link => link.label.toLowerCase() !== 'communauté'
  );

  // « Ma session » : REPREND la dernière session de l'utilisateur (ne RECRÉE pas). On interroge la DB
  // (host_id = uid) en priorité ; repli sur le code mémorisé localement ; sinon seulement, on crée.
  const handleStartClick = async () => {
    if (!isAuthenticated) { navigate('/login', { state: { from: '/session' } }); return; }
    // 1) Source fiable : la DB (dernière session dont je suis l'hôte).
    const { sessionId, error } = await getMyLastSession();
    if (sessionId) { navigate(`/session/${sessionId}`); return; }
    console.log('[MA SESSION] aucune session DB pour cet hôte', error ? `(${error})` : '', '→ repli localStorage');
    // 2) Repli : code mémorisé localement (s'il existe encore).
    let last: string | null = null;
    try { last = localStorage.getItem('bt_last_session_code'); } catch { /* ignore */ }
    if (last) {
      const exists = await sessionExists(last);
      if (exists !== false) { navigate(`/session/${last}`); return; }
      try { localStorage.removeItem('bt_last_session_code'); } catch { /* ignore */ }
    }
    console.log('[MA SESSION] aucune session existante → création');
    navigate('/session'); // aucune session existante → en créer une
  };

  const handleLoginClick = () => {
    navigate('/login');
  };

  const handleAdminClick = () => {
    navigate('/admin');
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
          background: "rgba(22, 22, 23, 0.8)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Logo */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center gap-2 group">
              {/* Logo Icon */}
              <div
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-[10px] flex items-center justify-center"
                style={{
                  background: colors.primary,
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-5 h-5 text-white"
                  fill="currentColor"
                >
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
              {/* Logo Text — monochrome (2 couleurs max) */}
              <span
                className="text-lg sm:text-xl font-semibold tracking-tight text-white"
                style={{ fontFamily: fonts.heading }}
              >
                {name}
              </span>
            </Link>
          </div>

          {/* Navigation - Dynamic from theme (without Communauté) */}
          <nav className="hidden md:flex items-center gap-8">
            {filteredNavLinks.map((link) => {
              // Skip "Tarifs" and "Fonctionnalités" as we add them with React Router
              if (link.label.toLowerCase() === 'tarifs' || link.label.toLowerCase() === 'fonctionnalités') return null;
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
              to="/features"
              className="text-white/70 hover:text-white transition-colors duration-200 text-sm font-medium"
              style={{ fontFamily: fonts.body }}
            >
              Fonctionnalités
            </Link>
            <Link
              to="/pricing"
              className="text-white/70 hover:text-white transition-colors duration-200 text-sm font-medium"
              style={{ fontFamily: fonts.body }}
            >
              Tarifs
            </Link>
            {/* 💎 Point d'entrée VISIBLE vers l'espace coach / abonnement (tout le monde) */}
            <Link
              to="/wallet"
              className="text-sm font-medium transition-colors duration-200 hover:opacity-90"
              style={{ fontFamily: fonts.body, color: colors.primary }}
            >
              {isAuthenticated ? 'Espace Coach' : 'Devenir Coach'}
            </Link>
          </nav>

          {/* CTA Buttons */}
          <div className="flex items-center gap-3">
            {/* PWA Install Button - Discret */}
            <PWAInstallPrompt variant="minimal" className="hidden sm:flex" />
            
            {/* Language Selector - TOUJOURS VISIBLE avec z-index élevé */}
            <div className="relative z-50">
              <LanguageSelector className="flex" />
            </div>
            
            {isAuthenticated ? (
              <>
                {/* User info — avatar cliquable = modifier la photo de profil */}
                <div className="hidden sm:flex items-center gap-2 text-sm text-white/70">
                  <ProfilePhotoEditor variant="avatar" />
                  <span className="max-w-[100px] truncate">
                    {profile?.full_name || profile?.email?.split('@')[0]}
                  </span>
                  {isAdmin && (
                    <span className="px-2 py-0.5 text-xs bg-[#7A5CFF]/15 text-[#A78BFF] rounded-full border border-[#7A5CFF]/25">
                      👑 Admin
                    </span>
                  )}
                </div>
                
                {/* Admin button - Only visible to admin */}
                {isAdmin && (
                  <button
                    onClick={handleAdminClick}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[#A78BFF] hover:text-white hover:bg-[#7A5CFF]/10 transition-colors text-sm"
                    title="Gestion du Site"
                  >
                    <Settings size={16} />
                    <span className="hidden sm:inline">Gestion Site</span>
                  </button>
                )}

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
                <PrimaryButton size="sm" onClick={handleStartClick} className="hidden sm:inline-flex">
                  {buttons.start}
                </PrimaryButton>
              </>
            )}

            {/* 📱 Hamburger — composant réutilisable (mobile uniquement) */}
            <MobileMenu />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
