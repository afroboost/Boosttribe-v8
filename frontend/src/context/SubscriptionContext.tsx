import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';

// Types
export type UserRole = 'user' | 'admin';
export type SubscriptionStatus = 'none' | 'trial' | 'monthly' | 'yearly' | 'enterprise';

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  subscription_status: SubscriptionStatus;
  has_accepted_terms: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: 'month' | 'year' | 'one-time';
  features: string[];
  stripe_link: string;
  track_limit: number; // -1 = unlimited
  is_popular?: boolean;
}

export interface SubscriptionContextValue {
  // User state
  user: UserProfile | null;
  isLoading: boolean;
  isAdmin: boolean;
  isSubscribed: boolean;
  hasAcceptedTerms: boolean;
  
  // Limits
  trackLimit: number;
  canUploadTrack: (currentTrackCount: number) => boolean;
  canCreateSession: () => boolean;
  
  // Actions
  acceptTerms: () => Promise<boolean>;
  checkSubscription: () => Promise<void>;
  setMockUser: (role: UserRole, subscription: SubscriptionStatus) => void;
  
  // Plans
  plans: SubscriptionPlan[];
  getStripeLink: (planId: string) => string | null;
}

// Default plans
const DEFAULT_PLANS: SubscriptionPlan[] = [
  {
    id: 'trial',
    name: 'Essai Gratuit',
    price: 0,
    currency: 'EUR',
    interval: 'month',
    features: [
      '1 chanson max',
      '1 session active',
      'Participants illimités',
      'Synchronisation temps réel',
    ],
    stripe_link: '',
    track_limit: 1,
  },
  {
    id: 'monthly',
    name: 'Pro Mensuel',
    price: 9.99,
    currency: 'EUR',
    interval: 'month',
    features: [
      '50 chansons',
      'Sessions illimitées',
      'Participants illimités',
      'Voix en temps réel',
      'Support prioritaire',
    ],
    stripe_link: '',
    track_limit: 50,
    is_popular: true,
  },
  {
    id: 'yearly',
    name: 'Pro Annuel',
    price: 99.99,
    currency: 'EUR',
    interval: 'year',
    features: [
      '200 chansons',
      'Sessions illimitées',
      'Participants illimités',
      'Voix en temps réel',
      'Support prioritaire',
      '2 mois offerts',
    ],
    stripe_link: '',
    track_limit: 200,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 299.99,
    currency: 'EUR',
    interval: 'year',
    features: [
      'Chansons illimitées',
      'Sessions illimitées',
      'API dédiée',
      'Support 24/7',
      'Analytics avancées',
      'Personnalisation marque',
    ],
    stripe_link: '',
    track_limit: -1, // Unlimited
  },
];

// Track limits by subscription
const TRACK_LIMITS: Record<SubscriptionStatus, number> = {
  none: 1,
  trial: 1,
  monthly: 50,
  yearly: 200,
  enterprise: -1, // Unlimited
};

// Context
const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

// Provider
export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [plans, setPlans] = useState<SubscriptionPlan[]>(DEFAULT_PLANS);

  // Derived state
  const isAdmin = user?.role === 'admin';
  const isSubscribed = user?.subscription_status !== 'none' && user?.subscription_status !== 'trial';
  const hasAcceptedTerms = user?.has_accepted_terms ?? false;

  // Track limit based on role and subscription
  const trackLimit = isAdmin 
    ? -1 // Admin = unlimited
    : TRACK_LIMITS[user?.subscription_status || 'none'];

  // Check if user can upload more tracks
  const canUploadTrack = useCallback((currentTrackCount: number): boolean => {
    if (isAdmin) return true; // Admin bypass
    if (trackLimit === -1) return true; // Unlimited
    return currentTrackCount < trackLimit;
  }, [isAdmin, trackLimit]);

  // Check if user can create session
  const canCreateSession = useCallback((): boolean => {
    if (isAdmin) return true; // Admin bypass
    if (!hasAcceptedTerms) return false; // Must accept terms
    return true; // For now, allow trial users too
  }, [isAdmin, hasAcceptedTerms]);

  // Accept terms
  const acceptTerms = useCallback(async (): Promise<boolean> => {
    if (!user) return false;

    // If using Supabase, update in database
    if (supabase && isSupabaseConfigured) {
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ has_accepted_terms: true, updated_at: new Date().toISOString() })
          .eq('id', user.id);

        if (error) {
          console.error('[SUBSCRIPTION] Error accepting terms:', error);
          return false;
        }
      } catch (err) {
        console.error('[SUBSCRIPTION] Exception accepting terms:', err);
        return false;
      }
    }

    // Update local state
    setUser(prev => prev ? { ...prev, has_accepted_terms: true } : null);
    
    // Also store in localStorage for demo mode
    localStorage.setItem('bt_terms_accepted', 'true');
    
    return true;
  }, [user]);

  // Check subscription status
  const checkSubscription = useCallback(async (): Promise<void> => {
    setIsLoading(true);

    // Check localStorage for demo/offline mode
    const storedRole = localStorage.getItem('bt_user_role') as UserRole | null;
    const storedSubscription = localStorage.getItem('bt_subscription_status') as SubscriptionStatus | null;
    const storedTerms = localStorage.getItem('bt_terms_accepted') === 'true';

    // If admin password was entered, set as admin
    const isAdminSession = sessionStorage.getItem('bt_is_admin') === 'true';

    if (isAdminSession) {
      setUser({
        id: 'admin_local',
        email: 'admin@beattribe.app',
        role: 'admin',
        subscription_status: 'enterprise',
        has_accepted_terms: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setIsLoading(false);
      return;
    }

    // Check Supabase auth if configured
    if (supabase && isSupabaseConfigured) {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        
        if (authUser) {
          // Fetch profile from database
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', authUser.id)
            .single();

          if (profile) {
            setUser(profile as UserProfile);
            setIsLoading(false);
            return;
          }
        }
      } catch (err) {
        console.error('[SUBSCRIPTION] Error checking auth:', err);
      }
    }

    // Fallback to localStorage mock user
    if (storedRole || storedSubscription) {
      setUser({
        id: 'local_user',
        email: 'user@beattribe.app',
        role: storedRole || 'user',
        subscription_status: storedSubscription || 'trial',
        has_accepted_terms: storedTerms,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } else {
      // Default trial user
      setUser({
        id: 'guest_' + Date.now(),
        email: 'guest@beattribe.app',
        role: 'user',
        subscription_status: 'trial',
        has_accepted_terms: storedTerms,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    setIsLoading(false);
  }, []);

  // Set mock user (for testing/demo)
  const setMockUser = useCallback((role: UserRole, subscription: SubscriptionStatus) => {
    localStorage.setItem('bt_user_role', role);
    localStorage.setItem('bt_subscription_status', subscription);
    
    setUser(prev => prev ? {
      ...prev,
      role,
      subscription_status: subscription,
    } : null);
  }, []);

  // Get Stripe link for a plan
  const getStripeLink = useCallback((planId: string): string | null => {
    const plan = plans.find(p => p.id === planId);
    return plan?.stripe_link || null;
  }, [plans]);

  // Load admin config for Stripe links
  useEffect(() => {
    const loadAdminConfig = async () => {
      if (!supabase || !isSupabaseConfigured) return;

      try {
        const { data: config } = await supabase
          .from('admin_config')
          .select('*')
          .single();

        if (config?.stripe_links) {
          setPlans(prev => prev.map(plan => ({
            ...plan,
            stripe_link: config.stripe_links[plan.id] || '',
          })));
        }
      } catch (err) {
        // Table might not exist, use defaults
        console.log('[SUBSCRIPTION] Using default plans (admin_config not found)');
      }
    };

    loadAdminConfig();
  }, []);

  // Initial load
  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  const value: SubscriptionContextValue = {
    user,
    isLoading,
    isAdmin,
    isSubscribed,
    hasAcceptedTerms,
    trackLimit,
    canUploadTrack,
    canCreateSession,
    acceptTerms,
    checkSubscription,
    setMockUser,
    plans,
    getStripeLink,
  };

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};

// Hook
export const useSubscription = (): SubscriptionContextValue => {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
};

export default SubscriptionContext;
