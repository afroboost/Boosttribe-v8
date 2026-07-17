import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

// Admin emails for access control
const ADMIN_EMAILS = ['contact.artboost@gmail.com'];

interface RequireAdminProps {
  children: React.ReactNode;
}

/**
 * Wrapper component that only allows admin access
 * Admin is determined by email (contact.artboost@gmail.com)
 */
export const RequireAdmin: React.FC<RequireAdminProps> = ({ children }) => {
  const { user, isLoading, isAdmin } = useAuth();

  // Check email directly for faster bypass
  const userEmail = user?.email?.toLowerCase() || '';
  const isAdminByEmail = ADMIN_EMAILS.includes(userEmail);

  // Admin by email or profile gets instant access
  if ((isAdminByEmail || isAdmin) && user) {
    console.log('[RequireAdmin] ✅ Admin access granted for:', userEmail);
    return <>{children}</>;
  }

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[var(--bt-accent)] border-t-transparent rounded-full animate-spin" />
          <span className="text-white/50">Vérification des accès admin...</span>
        </div>
      </div>
    );
  }

  // Not admin - redirect to home
  console.log('[RequireAdmin] ❌ Access denied for:', userEmail || 'anonymous');
  return <Navigate to="/" replace />;
};

export default RequireAdmin;
