import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';

// Types
export type UserRole = 'user' | 'admin';
export type SubscriptionStatus = 'none' | 'trial' | 'monthly' | 'yearly' | 'enterprise';

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  role: UserRole;
  subscription_status: SubscriptionStatus;
  has_accepted_terms: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthContextValue {
  // Auth state
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  
  // Role checks
  isAdmin: boolean;
  isSubscribed: boolean;
  hasAcceptedTerms: boolean;
  
  // Limits
  trackLimit: number;
  canUploadTrack: (currentCount: number) => boolean;
  
  // Auth actions
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUpWithEmail: (email: string, password: string, fullName?: string) => Promise<{ error: AuthError | null }>;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
  
  // Profile actions
  acceptTerms: () => Promise<boolean>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<boolean>;
  refreshProfile: () => Promise<void>;
}

// Track limits by subscription
const TRACK_LIMITS: Record<SubscriptionStatus, number> = {
  none: 1,
  trial: 1,
  monthly: 50,
  yearly: 200,
  enterprise: -1,
};

// Context
const AuthContext = createContext<AuthContextValue | null>(null);

// Provider
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Derived state
  const isAuthenticated = !!user;
  const isAdmin = profile?.role === 'admin';
  const isSubscribed = profile?.subscription_status !== 'none' && profile?.subscription_status !== 'trial';
  const hasAcceptedTerms = profile?.has_accepted_terms ?? false;
  const trackLimit = isAdmin ? -1 : TRACK_LIMITS[profile?.subscription_status || 'none'];

  // Check upload limit
  const canUploadTrack = useCallback((currentCount: number): boolean => {
    if (isAdmin) return true;
    if (trackLimit === -1) return true;
    return currentCount < trackLimit;
  }, [isAdmin, trackLimit]);

  // Fetch user profile from database
  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        // Table doesn't exist or profile not found
        if (error.code === 'PGRST116' || error.code === '42P01') {
          console.warn('[AUTH] Profile not found, creating default profile');
          // Create a local profile without database
          return createLocalProfile(userId);
        }
        console.error('[AUTH] Error fetching profile:', error.message);
        // Return local profile on error
        return createLocalProfile(userId);
      }

      return data as UserProfile;
    } catch (err) {
      console.error('[AUTH] Exception fetching profile:', err);
      // Return local profile on exception
      return createLocalProfile(userId);
    }
  }, []);

  // Create local profile (fallback when DB is not ready)
  const createLocalProfile = (userId: string): UserProfile => {
    // Check if this user should be admin (by email)
    const adminEmails = ['contact.artboost@gmail.com'];
    const userEmail = user?.email || '';
    const isAdminUser = adminEmails.includes(userEmail.toLowerCase());

    return {
      id: userId,
      email: userEmail,
      full_name: user?.user_metadata?.full_name || userEmail.split('@')[0] || '',
      avatar_url: user?.user_metadata?.avatar_url || '',
      role: isAdminUser ? 'admin' : 'user',
      subscription_status: isAdminUser ? 'enterprise' : 'trial',
      has_accepted_terms: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  // Create new profile for user in database
  const createProfile = async (userId: string): Promise<UserProfile | null> => {
    if (!supabase || !user) return createLocalProfile(userId);

    const newProfile: Partial<UserProfile> = {
      id: userId,
      email: user.email || '',
      full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || '',
      avatar_url: user.user_metadata?.avatar_url || '',
      role: 'user',
      subscription_status: 'trial',
      has_accepted_terms: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      const { data, error } = await supabase
        .from('profiles')
        .insert(newProfile)
        .select()
        .single();

      if (error) {
        console.error('[AUTH] Error creating profile:', error.message);
        return createLocalProfile(userId);
      }

      return data as UserProfile;
    } catch (err) {
      console.error('[AUTH] Exception creating profile:', err);
      return createLocalProfile(userId);
    }
  };

  // Refresh profile
  const refreshProfile = useCallback(async (): Promise<void> => {
    if (user) {
      const updatedProfile = await fetchProfile(user.id);
      setProfile(updatedProfile);
    }
  }, [user, fetchProfile]);

  // Sign in with email
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      return { error: { message: 'Supabase non configuré' } as AuthError };
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return { error };
  }, []);

  // Sign up with email
  const signUpWithEmail = useCallback(async (email: string, password: string, fullName?: string) => {
    if (!supabase) {
      return { error: { message: 'Supabase non configuré' } as AuthError };
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || email.split('@')[0],
        },
      },
    });

    return { error };
  }, []);

  // Sign in with Google
  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      return { error: { message: 'Supabase non configuré' } as AuthError };
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/session`,
      },
    });

    return { error };
  }, []);

  // Sign out
  const signOut = useCallback(async () => {
    if (!supabase) return;

    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setSession(null);
    
    // Clear any stored admin state
    sessionStorage.removeItem('bt_is_admin');
  }, []);

  // Reset password
  const resetPassword = useCallback(async (email: string) => {
    if (!supabase) {
      return { error: { message: 'Supabase non configuré' } as AuthError };
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    return { error };
  }, []);

  // Update password
  const updatePassword = useCallback(async (newPassword: string) => {
    if (!supabase) {
      return { error: { message: 'Supabase non configuré' } as AuthError };
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    return { error };
  }, []);

  // Accept terms
  const acceptTerms = useCallback(async (): Promise<boolean> => {
    if (!supabase || !user) return false;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          has_accepted_terms: true, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', user.id);

      if (error) {
        console.error('[AUTH] Error accepting terms:', error);
        return false;
      }

      setProfile(prev => prev ? { ...prev, has_accepted_terms: true } : null);
      return true;
    } catch (err) {
      console.error('[AUTH] Exception accepting terms:', err);
      return false;
    }
  }, [user]);

  // Update profile
  const updateProfile = useCallback(async (updates: Partial<UserProfile>): Promise<boolean> => {
    if (!supabase || !user) return false;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          ...updates,
          updated_at: new Date().toISOString() 
        })
        .eq('id', user.id);

      if (error) {
        console.error('[AUTH] Error updating profile:', error);
        return false;
      }

      setProfile(prev => prev ? { ...prev, ...updates } : null);
      return true;
    } catch (err) {
      console.error('[AUTH] Exception updating profile:', err);
      return false;
    }
  }, [user]);

  // Initialize auth state
  useEffect(() => {
    if (!supabase) {
      console.log('[AUTH] Supabase not configured, using demo mode');
      setIsLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const userProfile = await fetchProfile(session.user.id);
        setProfile(userProfile);
        
        // Set admin flag in sessionStorage if user is admin
        if (userProfile?.role === 'admin') {
          sessionStorage.setItem('bt_is_admin', 'true');
        }
      }
      
      setIsLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[AUTH] Auth state changed:', event);
      
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const userProfile = await fetchProfile(session.user.id);
        setProfile(userProfile);
        
        if (userProfile?.role === 'admin') {
          sessionStorage.setItem('bt_is_admin', 'true');
        } else {
          sessionStorage.removeItem('bt_is_admin');
        }
      } else {
        setProfile(null);
        sessionStorage.removeItem('bt_is_admin');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const value: AuthContextValue = {
    user,
    profile,
    session,
    isLoading,
    isAuthenticated,
    isAdmin,
    isSubscribed,
    hasAcceptedTerms,
    trackLimit,
    canUploadTrack,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
    resetPassword,
    updatePassword,
    acceptTerms,
    updateProfile,
    refreshProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Hook
export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
