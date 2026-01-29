import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "@/styles/globals.css";
import { ThemeProvider } from "@/context/ThemeContext";
import { SocketProvider } from "@/context/SocketContext";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/components/ui/Toast";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import Header from "@/components/layout/Header";
import HeroSection from "@/components/sections/HeroSection";
import AdminDashboard from "@/pages/admin/Dashboard";
import SessionPage from "@/pages/SessionPage";
import PricingPage from "@/pages/PricingPage";
import FeaturesPage from "@/pages/FeaturesPage";
import LoginPage from "@/pages/LoginPage";

// Global settings loader component
const SiteSettingsLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // This hook loads settings from Supabase and applies favicon/title globally
  useSiteSettings();
  return <>{children}</>;
};

// 🛡️ KILL BADGE - Injection CSS globale pour supprimer tout élément Emergent
const EmergentBlocker: React.FC = () => {
  useEffect(() => {
    // 1. Injection CSS dans HEAD
    const style = document.createElement('style');
    style.id = 'emergent-killer-css';
    style.innerHTML = `
      iframe[src*="emergent"] { 
        display: none !important; 
        pointer-events: none !important; 
        visibility: hidden !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
        position: absolute !important;
        left: -99999px !important;
        z-index: -99999 !important;
      }
      [class*="emergent"], [id*="emergent"], [data-emergent] {
        display: none !important;
        visibility: hidden !important;
      }
      .made-with-emergent, #made-with-emergent, [class*="MadeWith"] {
        display: none !important;
      }
    `;
    document.head.appendChild(style);

    // 2. Suppression DOM agressive
    const killEmergent = () => {
      // Supprimer les iframes
      document.querySelectorAll('iframe').forEach((iframe) => {
        const src = (iframe.src || '').toLowerCase();
        if (src.includes('emergent')) {
          iframe.remove();
        }
      });
      // Supprimer les éléments avec emergent
      document.querySelectorAll('[class*="emergent"],[id*="emergent"],[class*="MadeWith"]').forEach((el) => {
        el.remove();
      });
    };

    // Exécuter immédiatement et périodiquement
    killEmergent();
    const interval = setInterval(killEmergent, 200);

    // MutationObserver pour le contenu dynamique
    const observer = new MutationObserver(killEmergent);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearInterval(interval);
      observer.disconnect();
    };
  }, []);

  return null;
};

const HomePage: React.FC = () => {
  return (
    <div 
      className="min-h-screen"
      style={{ 
        background: "#000000",
        color: "#FFFFFF",
      }}
    >
      <Header />
      <main>
        <HeroSection />
      </main>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <SiteSettingsLoader>
              <SocketProvider>
                {/* 🛡️ Blocker iframe emergent */}
                <EmergentBlocker />
                <div className="App">
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/pricing" element={<PricingPage />} />
                    <Route path="/features" element={<FeaturesPage />} />
                    <Route 
                      path="/session" 
                      element={
                        <RequireAuth>
                          <SessionPage />
                        </RequireAuth>
                      } 
                    />
                    <Route 
                      path="/session/:sessionId" 
                      element={<SessionPage />} 
                    />
                    <Route 
                      path="/admin" 
                      element={
                        <RequireAdmin>
                          <AdminDashboard />
                        </RequireAdmin>
                      } 
                    />
                  </Routes>
                </div>
              </SocketProvider>
            </SiteSettingsLoader>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  );
};

export default App;
