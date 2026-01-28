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

// Admin emails constant (used for instant bypass)
const ADMIN_EMAILS = ['contact.artboost@gmail.com'];

// Provider
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ADMIN CHECK: By email OR by profile role (email takes priority)
  const isAdminByEmail = user?.email ? ADMIN_EMAILS.includes(user.email.toLowerCase()) : false;
  const isAdmin = isAdminByEmail || profile?.role === 'admin';
  
  // Derived state
  const isAuthenticated = !!user;
  const isSubscribed = isAdmin || (profile?.subscription_status !== 'none' && profile?.subscription_status !== 'trial');
  const hasAcceptedTerms = isAdmin || (profile?.has_accepted_terms ?? false);
  const trackLimit = isAdmin ? -1 : TRACK_LIMITS[profile?.subscription_status || 'none'];

  // Check upload limit
  const canUploadTrack = useCallback((currentCount: number): boolean => {
    if (isAdmin) return true;
    if (trackLimit === -1) return true;
    return currentCount < trackLimit;
  }, [isAdmin, trackLimit]);

  // Create local profile (fallback when DB is not ready)
  const createLocalProfile = useCallback((userId: string, userEmail: string, userMetadata?: Record<string, unknown>): UserProfile => {
    // Check if this user should be admin (by email)
    const adminEmails = ['contact.artboost@gmail.com'];
    const isAdminUser = adminEmails.includes(userEmail.toLowerCase());

    console.log('[AUTH] Creating local profile for:', userEmail, 'isAdmin:', isAdminUser);

    return {
      id: userId,
      email: userEmail,
      full_name: (userMetadata?.full_name as string) || userEmail.split('@')[0] || '',
      avatar_url: (userMetadata?.avatar_url as string) || '',
      role: isAdminUser ? 'admin' : 'user',
      subscription_status: isAdminUser ? 'enterprise' : 'trial',
      has_accepted_terms: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }, []);

  // Fetch user profile from database
  const fetchProfile = useCallback(async (userId: string, userEmail: string, userMetadata?: Record<string, unknown>): Promise<UserProfile | null> => {
    if (!supabase) return createLocalProfile(userId, userEmail, userMetadata);

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
          return createLocalProfile(userId, userEmail, userMetadata);
        }
        console.error('[AUTH] Error fetching profile:', error.message);
        return createLocalProfile(userId, userEmail, userMetadata);
      }

      // Check if DB profile should be admin but isn't (fix role if email matches)
      const adminEmails = ['contact.artboost@gmail.com'];
      if (adminEmails.includes(userEmail.toLowerCase()) && data.role !== 'admin') {
        console.log('[AUTH] Upgrading user to admin role');
        // Update DB if possible
        await supabase.from('profiles').update({ role: 'admin', subscription_status: 'enterprise' }).eq('id', userId);
        return { ...data, role: 'admin', subscription_status: 'enterprise' } as UserProfile;
      }

      return data as UserProfile;
    } catch (err) {
      console.error('[AUTH] Exception fetching profile:', err);
      return createLocalProfile(userId, userEmail, userMetadata);
    }
  }, [createLocalProfile]);

  // Create new profile for user in database
  const createProfile = async (userId: string, userEmail: string, userMetadata?: Record<string, unknown>): Promise<UserProfile | null> => {
    if (!supabase) return createLocalProfile(userId, userEmail, userMetadata);

    // Check if user should be admin
    const adminEmails = ['contact.artboost@gmail.com'];
    const isAdminUser = adminEmails.includes(userEmail.toLowerCase());

    const newProfile: Partial<UserProfile> = {
      id: userId,
      email: userEmail,
      full_name: (userMetadata?.full_name as string) || userEmail.split('@')[0] || '',
      avatar_url: (userMetadata?.avatar_url as string) || '',
      role: isAdminUser ? 'admin' : 'user',
      subscription_status: isAdminUser ? 'enterprise' : 'trial',
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
        return createLocalProfile(userId, userEmail, userMetadata);
      }

      return data as UserProfile;
    } catch (err) {
      console.error('[AUTH] Exception creating profile:', err);
      return createLocalProfile(userId, userEmail, userMetadata);
    }
  };

  // Refresh profile
  const refreshProfile = useCallback(async (): Promise<void> => {
    if (user) {
      const updatedProfile = await fetchProfile(user.id, user.email || '', user.user_metadata);
      setProfile(updatedProfile);
    }
  }, [user, fetchProfile]);

  // Sign in with email - using Supabase SDK only
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      return { error: { message: 'Supabase non configuré' } as AuthError };
    }

    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        console.error('[AUTH] Sign in error:', error.message);
        setIsLoading(false);
        return { error };
      }

      console.log('[AUTH] Sign in successful:', data.user?.email);
      
      // Profile will be loaded by onAuthStateChange listener
      return { error: null };
    } catch (err) {
      console.error('[AUTH] Sign in exception:', err);
      setIsLoading(false);
      
      // Handle stream error specifically
      const errorMessage = err instanceof Error ? err.message : 'Erreur de connexion';
      if (errorMessage.includes('stream') || errorMessage.includes('body')) {
        return { 
          error: { 
            message: 'Erreur réseau. Veuillez réessayer.' 
          } as AuthError 
        };
      }
      
      return { 
        error: { 
          message: errorMessage
        } as AuthError 
      };
    }
  }, []);

  // Sign up with email
  const signUpWithEmail = useCallback(async (email: string, password: string, fullName?: string) => {
    if (!supabase) {
      return { error: { message: 'Supabase non configuré' } as AuthError };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName || email.split('@')[0],
          },
        },
      });

      if (error) {
        console.error('[AUTH] Sign up error:', error.message);
        return { error };
      }

      console.log('[AUTH] Sign up successful:', data.user?.email);
      return { error: null };
    } catch (err) {
      console.error('[AUTH] Sign up exception:', err);
      return { 
        error: { 
          message: err instanceof Error ? err.message : 'Erreur d\'inscription' 
        } as AuthError 
      };
    }
  }, []);

  // Sign in with Google - force production URL redirect
  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      return { error: { message: 'Supabase non configuré' } as AuthError };
    }

    // Get the current origin - NEVER use localhost
    const currentOrigin = window.location.origin;
    const redirectUrl = `${currentOrigin}/session`;
    
    console.log('[AUTH] Google OAuth redirect URL:', redirectUrl);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        console.error('[AUTH] Google sign in error:', error.message);
        // Specific message for unsupported provider
        if (error.message.includes('unsupported') || error.message.includes('provider')) {
          return { 
            error: { 
              message: 'Google Auth non activé. Activez-le dans Supabase Dashboard > Authentication > Providers > Google' 
            } as AuthError 
          };
        }
        return { error };
      }

      return { error: null };
    } catch (err) {
      console.error('[AUTH] Google sign in exception:', err);
      return { 
        error: { 
          message: 'Erreur de connexion Google' 
        } as AuthError 
      };
    }
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

  // Admin emails for instant bypass
  const ADMIN_EMAILS = ['contact.artboost@gmail.com'];

  // Check if email is admin (instant check, no DB needed)
  const isAdminEmail = useCallback((email: string | undefined | null): boolean => {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase());
  }, []);

  // Create instant admin profile (no DB wait)
  const createInstantAdminProfile = useCallback((userId: string, email: string, metadata?: Record<string, unknown>): UserProfile => {
    console.log('[AUTH] ⚡ Creating instant admin profile for:', email);
    return {
      id: userId,
      email: email,
      full_name: (metadata?.full_name as string) || (metadata?.name as string) || email.split('@')[0],
      avatar_url: (metadata?.avatar_url as string) || (metadata?.picture as string) || '',
      role: 'admin',
      subscription_status: 'enterprise',
      has_accepted_terms: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }, []);

  // Initialize auth state
  useEffect(() => {
    if (!supabase) {
      console.log('[AUTH] Supabase not configured, using demo mode');
      setIsLoading(false);
      return;
    }

    // Local reference to avoid null checks
    const sb = supabase;
    let isMounted = true;

    // Get initial session - with GUARANTEED loading end
    const initializeAuth = async () => {
      console.log('[AUTH] 🔄 Initializing auth...');
      
      try {
        const { data: { session }, error } = await sb.auth.getSession();
        
        if (error) {
          console.error('[AUTH] getSession error:', error.message);
          return; // finally will handle setIsLoading
        }

        if (!isMounted) return;

        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          const userEmail = session.user.email || '';
          console.log('[AUTH] Session found for:', userEmail);
          
          // ADMIN BYPASS: Instant profile creation for admin emails
          if (isAdminEmail(userEmail)) {
            const adminProfile = createInstantAdminProfile(
              session.user.id,
              userEmail,
              session.user.user_metadata
            );
            setProfile(adminProfile);
            sessionStorage.setItem('bt_is_admin', 'true');
            console.log('[AUTH] ✅ ADMIN BYPASS - Instant access granted');
            return; // Skip DB fetch for admin
          }
          
          // Regular users: fetch profile from DB
          const userProfile = await fetchProfile(
            session.user.id, 
            userEmail, 
            session.user.user_metadata
          );
          
          if (isMounted) {
            setProfile(userProfile);
            console.log('[AUTH] Profile loaded:', userProfile?.role);
          }
        }
      } catch (err) {
        console.error('[AUTH] Init error:', err);
      } finally {
        // GUARANTEED: Always stop loading
        if (isMounted) {
          console.log('[AUTH] ✅ Loading complete');
          setIsLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth changes (includes Google OAuth callback)
    const { data: { subscription } } = sb.auth.onAuthStateChange(async (event, session) => {
      console.log('[AUTH] Auth state changed:', event, session?.user?.email);
      
      if (!isMounted) return;
      
      // Always update session and user immediately
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const userEmail = session.user.email || '';
        
        // ADMIN BYPASS: Instant profile for admin emails
        if (isAdminEmail(userEmail)) {
          const adminProfile = createInstantAdminProfile(
            session.user.id,
            userEmail,
            session.user.user_metadata
          );
          setProfile(adminProfile);
          sessionStorage.setItem('bt_is_admin', 'true');
          setIsLoading(false);
          console.log('[AUTH] ✅ ADMIN BYPASS on', event);
          return;
        }
        
        // Regular users: fetch profile (with timeout protection)
        try {
          const userProfile = await Promise.race([
            fetchProfile(session.user.id, userEmail, session.user.user_metadata),
            new Promise<UserProfile | null>((_, reject) => 
              setTimeout(() => reject(new Error('Profile fetch timeout')), 3000)
            )
          ]);
          
          if (isMounted) {
            setProfile(userProfile);
            if (userProfile?.role === 'admin') {
              sessionStorage.setItem('bt_is_admin', 'true');
            } else {
              sessionStorage.removeItem('bt_is_admin');
            }
          }
        } catch (err) {
          console.warn('[AUTH] Profile fetch failed, using local:', err);
          // Fallback to local profile on timeout/error
          const localProfile = createLocalProfile(
            session.user.id,
            userEmail,
            session.user.user_metadata
          );
          if (isMounted) setProfile(localProfile);
        }
      } else {
        setProfile(null);
        sessionStorage.removeItem('bt_is_admin');
      }
      
      // Always ensure loading is false after auth change
      if (isMounted) setIsLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile, isAdminEmail, createInstantAdminProfile, createLocalProfile]);

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
