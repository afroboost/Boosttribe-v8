import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabaseClient';

// Admin emails for instant bypass (no DB check needed)
const ADMIN_EMAILS = ['contact.artboost@gmail.com'];

// Max loading time before forcing display (2 seconds)
const MAX_LOADING_MS = 2000;

interface RequireAuthProps {
  children: React.ReactNode;
  requireSubscription?: boolean;
}

/**
 * Wrapper component that redirects to login if user is not authenticated
 * ADMIN BYPASS: Admin emails get instant access without waiting for profile
 * TIMEOUT: Forces display after 2 seconds to prevent infinite loading
 */
export const RequireAuth: React.FC<RequireAuthProps> = ({ 
  children, 
  requireSubscription = false 
}) => {
  const { isAuthenticated, isLoading, isSubscribed, isAdmin, user } = useAuth();
  const location = useLocation();
  const [forceDisplay, setForceDisplay] = useState(false);

  // Force display after timeout to prevent infinite loading
  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => {
        console.log('[RequireAuth] ⏰ Timeout reached, forcing display');
        setForceDisplay(true);
      }, MAX_LOADING_MS);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  // If Supabase is not configured, allow access (demo mode)
  if (!isSupabaseConfigured) {
    return <>{children}</>;
  }

  // ADMIN BYPASS: Check email directly for instant access
  const userEmail = user?.email?.toLowerCase() || '';
  const isAdminByEmail = ADMIN_EMAILS.includes(userEmail);

  // Admin by email gets INSTANT access (no loading wait)
  if (isAdminByEmail && user) {
    console.log('[RequireAuth] ⚡ Admin bypass for:', userEmail);
    return <>{children}</>;
  }

  // Show loading state (but with timeout protection)
  if (isLoading && !isAdminByEmail && !forceDisplay) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[var(--bt-accent)] border-t-transparent rounded-full animate-spin" />
          <span className="text-white/50 text-sm">Chargement...</span>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated (unless forced display for admin)
  if (!isAuthenticated && !forceDisplay) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Admin (from profile) always has access
  if (isAdmin) {
    return <>{children}</>;
  }

  // If forced display but not authenticated, go to login
  if (forceDisplay && !isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Check subscription if required
  if (requireSubscription && !isSubscribed) {
    return <Navigate to="/pricing" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
};

export default RequireAuth;
