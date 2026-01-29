import React, { useState, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Admin password - In production, this should be handled by a proper auth system
const ADMIN_PASSWORD = "BEATTRIBE2026";
const AUTH_STORAGE_KEY = "bt_admin_auth";
const AUTH_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes session

interface AuthState {
  authenticated: boolean;
  timestamp: number;
}

interface ProtectedRouteProps {
  children: React.ReactNode;
}

// Safe check for browser environment
const isBrowser = (): boolean => {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
};

// Check if authentication is still valid
function checkAuthValidity(): boolean {
  if (!isBrowser()) return false;
  
  try {
    const stored = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const authState: AuthState = JSON.parse(stored);
      const now = Date.now();
      if (authState.authenticated && (now - authState.timestamp) < AUTH_EXPIRY_MS) {
        return true;
      }
      // Clean up expired session
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Auth check failed:", error);
    // Clean up corrupted data
    try {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // Ignore cleanup errors
    }
  }
  return false;
}

// Store authentication state
function storeAuth(): boolean {
  if (!isBrowser()) return false;
  
  try {
    const authState: AuthState = {
      authenticated: true,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authState));
    // Also mark as admin for subscription context
    sessionStorage.setItem('bt_is_admin', 'true');
    return true;
  } catch (error) {
    console.error("Failed to store auth:", error);
    return false;
  }
}

// Clear authentication
function clearAuth(): void {
  if (!isBrowser()) return;
  
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem('bt_is_admin');
  } catch (error) {
    console.warn("Failed to clear auth:", error);
  }
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  // Initialize auth state - check on first render
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Check auth on mount (client-side only)
  useEffect(() => {
    const isValid = checkAuthValidity();
    setIsAuthenticated(isValid);
    setIsInitialized(true);
  }, []);

  // Handle form submission
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    // Small delay for UX and security
    setTimeout(() => {
      if (password === ADMIN_PASSWORD) {
        const stored = storeAuth();
        if (stored) {
          setIsAuthenticated(true);
          setPassword("");
          setError("");
        } else {
          setError("Erreur de stockage de session");
        }
      } else {
        setError("Accès refusé - Mot de passe incorrect");
        setPassword("");
      }
      setIsLoading(false);
    }, 500);
  }, [password]);

  // Handle logout
  const handleLogout = useCallback(() => {
    clearAuth();
    setIsAuthenticated(false);
    setPassword("");
    setError("");
  }, []);

  // Handle password input change
  const handlePasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (error) setError(""); // Clear error on new input
  }, [error]);

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#000000" }}
      >
        <div className="flex items-center gap-3 text-white/60">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span style={{ fontFamily: "'Inter', sans-serif" }}>Chargement...</span>
        </div>
      </div>
    );
  }

  // If authenticated, render children with logout capability
  if (isAuthenticated) {
    return (
      <div className="relative">
        {/* Logout button overlay */}
        <button
          onClick={handleLogout}
          className="fixed bottom-4 right-4 z-50 px-4 py-2 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-full hover:bg-red-500/30 transition-colors"
          style={{ fontFamily: "var(--bt-font-body)" }}
        >
          🔒 Déconnexion Admin
        </button>
        {children}
      </div>
    );
  }

  // Login screen - NOT authenticated
  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4"
      style={{ 
        background: "#000000",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #8A2EFF 0%, transparent 70%)" }}
        />
        <div 
          className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, #FF2FB3 0%, transparent 70%)" }}
        />
      </div>

      <Card className="w-full max-w-md border-white/10 bg-black/50 backdrop-blur-xl relative z-10">
        <CardHeader className="text-center">
          {/* Logo */}
          <div className="flex justify-center mb-4">
            <div 
              className="w-16 h-16 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)" }}
            >
              <svg 
                viewBox="0 0 24 24" 
                className="w-8 h-8 text-white"
                fill="currentColor"
              >
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            </div>
          </div>
          
          <CardTitle 
            className="text-2xl text-white"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Boosttribe Admin
          </CardTitle>
          <CardDescription className="text-white/50">
            Accès restreint - Veuillez entrer le mot de passe
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-password" className="text-white/70">
                Mot de passe administrateur
              </Label>
              <Input
                id="admin-password"
                name="password"
                type="password"
                value={password}
                onChange={handlePasswordChange}
                placeholder="Entrez le mot de passe"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#8A2EFF] h-12"
                autoFocus
                autoComplete="current-password"
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading || password.length === 0}
              className="w-full h-12 text-white border-none font-medium text-base"
              style={{ 
                background: password.length > 0 
                  ? "linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)"
                  : "rgba(255,255,255,0.1)",
                boxShadow: password.length > 0 
                  ? "0 4px 24px rgba(138, 46, 255, 0.35)"
                  : "none",
              }}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Vérification...
                </span>
              ) : (
                "Entrer"
              )}
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t border-white/10 text-center">
            <p className="text-white/30 text-xs">
              🔐 Session sécurisée • Expiration: 30 minutes
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProtectedRoute;
