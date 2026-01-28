import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabaseClient';

interface RequireAuthProps {
  children: React.ReactNode;
  requireSubscription?: boolean;
}

/**
 * Wrapper component that redirects to login if user is not authenticated
 * If requireSubscription is true, also checks for valid subscription
 */
export const RequireAuth: React.FC<RequireAuthProps> = ({ 
  children, 
  requireSubscription = false 
}) => {
  const { isAuthenticated, isLoading, isSubscribed, isAdmin } = useAuth();
  const location = useLocation();

  // If Supabase is not configured, allow access (demo mode)
  if (!isSupabaseConfigured) {
    return <>{children}</>;
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-white/50 text-sm">Chargement...</span>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Admin always has access
  if (isAdmin) {
    return <>{children}</>;
  }

  // Check subscription if required
  if (requireSubscription && !isSubscribed) {
    return <Navigate to="/pricing" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
};

export default RequireAuth;
