import React from "react";
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
