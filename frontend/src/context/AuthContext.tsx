import { PUBLIC_URL } from '@/config/brand';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { claimSignupBonus, getMyCredits } from '@/lib/paymentApi';
import {
  CGU_VERSION, CLE_CGU_EN_ATTENTE, MESSAGE_ECHEC_CGU, cguAJour, consentementInscription, enAttenteValide,
  fonctionCguAbsente, metadonneesInscription, serialiserEnAttente, verdictRelecture, type ResultatCgu,
} from '@/lib/cguConsentement';

// Types
export type UserRole = 'user' | 'admin';
export type SubscriptionStatus = 'none' | 'trial' | 'monthly' | 'yearly' | 'pro' | 'enterprise';

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  role: UserRole;
  subscription_status: SubscriptionStatus;
  // CGU : valeur d'AFFICHAGE, déduite de la colonne réelle `terms_accepted` (post-S0, 19/10/2026).
  // ⚠️ `has_accepted_terms` n'existe dans AUCUNE base (boosttribe.pro, afroboost.com/live) : ne jamais l'écrire.
  has_accepted_terms: boolean;
  terms_accepted?: boolean | null;
  // Preuve SERVEUR (migration post-S0 03) : date et version des CGU acceptées. Jamais écrites par le navigateur.
  terms_accepted_at?: string | null;
  terms_version?: string | null;
  // 💳 Solde de crédits (colonne maintenue par trigger côté Supabase). 1 crédit = 1 accès à un live.
  credits?: number;
  // POINT 6 : accès offert par l'admin (DÉPRÉCIÉ — conservé pour compat migration)
  comp_access_until?: string | null;
  comp_access_plan?: SubscriptionStatus | string | null;
  created_at: string;
  updated_at: string;
}

// Post-S0 : la colonne en base est `terms_accepted`. Seul un `true` explicite vaut acceptation
// (aucun ancien compte n'est réputé avoir accepté sans preuve). Avec la migration 03 : il faut en plus
// la date serveur ET la version courante (CGU_VERSION) — sinon l'utilisateur est sollicité une fois.
const avecCgu = (row: UserProfile): UserProfile => ({ ...row, has_accepted_terms: cguAJour(row, CGU_VERSION) });

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
  isFree: boolean; // utilisateur gratuit : ni Pro/Enterprise, ni accès offert, ni admin
  hasAcceptedTerms: boolean;
  // 💳 Crédits : solde courant + raccourci hasCredits (solde > 0)
  credits: number;
  hasCredits: boolean;
  refreshCredits: () => Promise<void>;
  // POINT 6 : plan EFFECTIF (abonnement payant OU accès offert actif) + accès offert actif
  effectivePlan: SubscriptionStatus;
  compActive: boolean;
  // ♾️ Coach ILLIMITÉ (aligné backend is_coach_unlimited) : accès offert pro/enterprise actif,
  // abonnement enterprise, ou admin. Aucune limite d'upload ni de durée d'essai.
  isUnlimited: boolean;

  // Limits
  trackLimit: number;
  sessionLimit: number; // POINT 2 : nombre de sessions simultanées autorisées (Infinity = illimité)
  canUploadTrack: (currentCount: number) => boolean;
  
  // Auth actions
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUpWithEmail: (email: string, password: string, fullName?: string) => Promise<{ error: AuthError | null }>;
  // consentementCgu : case CGU cochée AVANT la redirection Google (inscription) → enregistrée au retour.
  signInWithGoogle: (consentementCgu?: boolean) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
  
  // Profile actions
  // Enregistre l'acceptation (serveur) puis RELIT la ligne : ok uniquement si la relecture le confirme.
  acceptTerms: () => Promise<ResultatCgu>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<boolean>;
  refreshProfile: () => Promise<void>;
}

// Track limits by subscription
const TRACK_LIMITS: Record<SubscriptionStatus, number> = {
  none: 1,
  trial: 1,
  monthly: 50,
  yearly: 200,
  pro: 50,        // Stripe "pro" → plusieurs titres
  enterprise: -1, // illimité
};

// POINT 2 : nombre de sessions simultanées par plan (gratuit = 1, payant = illimité)
const SESSION_LIMITS: Record<SubscriptionStatus, number> = {
  none: 1,
  trial: 1,
  monthly: Infinity,
  yearly: Infinity,
  pro: Infinity,
  enterprise: Infinity,
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
  // ⏱️ Horloge interne : réévalue l'accès offert (expiration) sans rechargement de page.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000); // re-check chaque minute
    return () => clearInterval(id);
  }, []);

  // ADMIN CHECK: By email OR by profile role (email takes priority)
  const isAdminByEmail = user?.email ? ADMIN_EMAILS.includes(user.email.toLowerCase()) : false;
  const isAdmin = isAdminByEmail || profile?.role === 'admin';
  
  // Derived state
  const isAuthenticated = !!user;

  // POINT 6 : accès offert actif (comp_access_until dans le futur) → plan = comp_access_plan.
  // Réévalué via nowTick → à l'expiration, l'utilisateur repasse automatiquement en gratuit.
  const compUntilMs = profile?.comp_access_until ? new Date(profile.comp_access_until).getTime() : 0;
  const compActive = !!compUntilMs && !Number.isNaN(compUntilMs) && compUntilMs > nowTick;
  const effectivePlan: SubscriptionStatus = (
    compActive && profile?.comp_access_plan
      ? profile.comp_access_plan
      : profile?.subscription_status || 'none'
  ) as SubscriptionStatus;

  // ♾️ ILLIMITÉ — miroir FRONT du backend `is_coach_unlimited` :
  //   • accès offert admin ACTIF avec plan pro/enterprise (l'offre « Abonnement illimité »), OU
  //   • abonnement enterprise, OU
  //   • admin.
  // Un coach illimité est traité comme l'admin : trackLimit = -1, aucune limite d'essai (5 min / 30 s).
  // ⚠️ On NE promeut PAS le plan public Stripe 'pro' (= 50 titres) ni 'monthly'/'yearly' :
  //    seul le comp-access admin pro/enterprise (ou enterprise) rend illimité, comme côté backend.
  const isCompUnlimited = compActive && (profile?.comp_access_plan === 'pro' || profile?.comp_access_plan === 'enterprise');
  const isUnlimited = isAdmin || isCompUnlimited || profile?.subscription_status === 'enterprise';

  // 💳 Solde de crédits courant (0 si anonyme/sans profil). 1 crédit = 1 accès à un live.
  const credits = Math.max(0, Number(profile?.credits ?? 0));
  const hasCredits = isAdmin || credits > 0;

  // 🔒 Accès aux fonctionnalités « premium » : admin, OU possède des crédits,
  // OU (legacy) accès offert/abonnement encore actif — pour ne casser aucun gate existant.
  const isSubscribed =
    isAdmin ||
    isUnlimited ||
    hasCredits ||
    compActive ||
    (profile !== null && effectivePlan !== 'none' && effectivePlan !== 'trial');
  // Gratuit = aucun crédit, ni admin, ni accès legacy actif (les anonymes comptent comme gratuits)
  const isFree = !isSubscribed;
  const hasAcceptedTerms = isAdmin || (profile?.has_accepted_terms ?? false);
  // ♾️ Illimité (admin OU coach comp pro/enterprise / enterprise) → aucune limite d'upload.
  const trackLimit = (isAdmin || isUnlimited) ? -1 : (TRACK_LIMITS[effectivePlan] ?? TRACK_LIMITS.none);
  const sessionLimit = isAdmin ? Infinity : (SESSION_LIMITS[effectivePlan] ?? SESSION_LIMITS.none);

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

  // Crée SA ligne profiles (RLS : soi-même uniquement ; S0 02 force les colonnes sensibles à une
  // valeur sûre). Charge minimale : rôle, crédits… prennent la valeur par DÉFAUT de la base.
  // Utilisée par acceptTerms en REPLI (fonction serveur accepter_cgu absente, migration 03 non appliquée).
  const createProfile = useCallback(async (userId: string, userEmail: string, userMetadata?: Record<string, unknown>,
    accepteCgu = false): Promise<UserProfile | null> => {
    if (!supabase) return null;

    const newProfile: Partial<UserProfile> = {
      id: userId,
      email: userEmail,
      full_name: (userMetadata?.full_name as string) || (userMetadata?.name as string) || userEmail.split('@')[0] || '',
      avatar_url: (userMetadata?.avatar_url as string) || (userMetadata?.picture as string) || '',
      terms_accepted: accepteCgu,
    };

    try {
      const { data, error } = await supabase
        .from('profiles')
        .insert(newProfile)
        .select()
        .single();

      if (error) {
        // Course (ligne créée entre-temps, 23505) ou refus : on relit avant de se rabattre sur le local.
        const { data: relue } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
        if (relue) return avecCgu(relue as UserProfile);
        console.error('[AUTH] Error creating profile:', error.message);
        return null;
      }

      return avecCgu(data as UserProfile);
    } catch (err) {
      console.error('[AUTH] Exception creating profile:', err);
      return null;
    }
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
        // Ligne absente : profil LOCAL d'affichage (inchangé). La ligne en base est créée par le
        // serveur au moment de l'acceptation des CGU (accepter_cgu), avec des valeurs neutres —
        // la créer ici donnerait subscription_status = 'free' (défaut base), que le front compte
        // à tort comme un plan payant (isSubscribed).
        if (error.code === 'PGRST116' || error.code === '42P01') {
          console.warn('[AUTH] Profile not found, using local profile');
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
        return avecCgu({ ...data, role: 'admin', subscription_status: 'enterprise' } as UserProfile);
      }

      return avecCgu(data as UserProfile);
    } catch (err) {
      console.error('[AUTH] Exception fetching profile:', err);
      return createLocalProfile(userId, userEmail, userMetadata);
    }
  }, [createLocalProfile]);

  // Refresh profile
  const refreshProfile = useCallback(async (): Promise<void> => {
    if (user) {
      const updatedProfile = await fetchProfile(user.id, user.email || '', user.user_metadata);
      setProfile(updatedProfile);
    }
  }, [user, fetchProfile]);

  // 💳 Rafraîchit uniquement le solde de crédits (après achat/dépense) sans recharger tout le profil.
  const refreshCredits = useCallback(async (): Promise<void> => {
    if (!user) return;
    const { balance } = await getMyCredits();
    setProfile((prev) => (prev ? { ...prev, credits: balance } : prev));
  }, [user]);

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
          // Consentement CGU tracé sur le COMPTE dès l'inscription (version + heure locale), puis
          // enregistré comme PREUVE serveur (accepter_cgu) dès la première session.
          data: metadonneesInscription(fullName, email, CGU_VERSION),
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
  const signInWithGoogle = useCallback(async (consentementCgu?: boolean) => {
    if (!supabase) {
      return { error: { message: 'Supabase non configuré' } as AuthError };
    }
    // Case CGU cochée avant de partir chez Google : mémorisée (version + heure), relue au retour.
    const oublierEnAttente = () => { try { localStorage.removeItem(CLE_CGU_EN_ATTENTE); } catch { /* ignore */ } };
    if (consentementCgu) {
      try { localStorage.setItem(CLE_CGU_EN_ATTENTE, serialiserEnAttente(CGU_VERSION)); } catch { /* ignore */ }
    } else {
      oublierEnAttente();
    }

    // 🔒 VERROUILLAGE DOMAINE PRODUCTION — l'URL publique de la MARQUE du build
    // (boosttribe.pro, ou afroboost.com/live pour l'habillage Afroboost) : figée
    // sur boosttribe.pro, la connexion Google renvoyait les abonnés Afroboost
    // chez Boosttribe. Voir config/brand.ts.
    const PRODUCTION_URL = PUBLIC_URL;
    const redirectUrl = `${PRODUCTION_URL}/session`;
    
    console.log('[AUTH] Google OAuth redirect URL (LOCKED):', redirectUrl);

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
        oublierEnAttente();
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
      oublierEnAttente();
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
    try { localStorage.removeItem(CLE_CGU_EN_ATTENTE); } catch { /* ignore */ }
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

    // 🔒 VERROUILLAGE DOMAINE PRODUCTION — même règle : l'URL publique de la marque.
    const PRODUCTION_URL = PUBLIC_URL;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${PRODUCTION_URL}/reset-password`,
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

  // Accept terms — PREUVE SERVEUR puis RELECTURE. Jamais de faux succès :
  //  1. accepter_cgu(CGU_VERSION) (migration 03) : date serveur, version, ligne créée si absente ;
  //  2. repli tant que 03 n'est pas appliquée : terms_accepted = true sur SA ligne, créée si absente ;
  //  3. relecture de la ligne : ok seulement si elle confirme l'acceptation de CETTE version.
  const acceptTerms = useCallback(async (): Promise<ResultatCgu> => {
    if (!supabase || !user) return { ok: false, erreur: 'Connectez-vous pour accepter les CGU.' };

    try {
      const { error: errRpc } = await supabase.rpc('accepter_cgu', { p_version: CGU_VERSION });
      if (errRpc) {
        if (!fonctionCguAbsente(errRpc)) {
          console.error('[AUTH] Error accepting terms:', errRpc);
          return { ok: false, erreur: MESSAGE_ECHEC_CGU };
        }
        const { data: maj, error } = await supabase
          .from('profiles')
          .update({
            terms_accepted: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id)
          .select('id');
        if (error) {
          console.error('[AUTH] Error accepting terms:', error);
          return { ok: false, erreur: MESSAGE_ECHEC_CGU };
        }
        if (!maj || maj.length === 0) {
          // Aucune ligne modifiée = ligne absente : on la crée (acceptée), sinon échec explicite.
          const creee = await createProfile(user.id, user.email || '', user.user_metadata, true);
          if (!creee) return { ok: false, erreur: MESSAGE_ECHEC_CGU };
        }
      }

      const { data: relue, error: errLec } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (errLec || !relue) {
        console.error('[AUTH] Terms re-read failed:', errLec);
        return { ok: false, erreur: MESSAGE_ECHEC_CGU };
      }
      const verdict = verdictRelecture(relue, CGU_VERSION);
      if (verdict.ok) {
        const ligne = avecCgu(relue as UserProfile);
        setProfile(prev => prev ? { ...prev, ...ligne } : ligne);
      }
      return verdict;
    } catch (err) {
      console.error('[AUTH] Exception accepting terms:', err);
      return { ok: false, erreur: MESSAGE_ECHEC_CGU };
    }
  }, [user, createProfile]);

  // Consentement donné AVANT la session (inscription e-mail : métadonnées du compte ; Google : case
  // cochée avant la redirection) → enregistré comme preuve serveur dès que la session existe.
  // Une seule tentative par compte et par chargement ; dépendances PRIMITIVES (aucune boucle).
  const cguAutoRef = useRef<string | null>(null);
  const userId = user?.id ?? null;
  const profilId = profile?.id ?? null;
  const cguOk = profile?.has_accepted_terms === true;
  useEffect(() => {
    if (!userId || !profilId || isAdmin) return;
    let enAttente: string | null = null;
    try { enAttente = localStorage.getItem(CLE_CGU_EN_ATTENTE); } catch { /* ignore */ }
    if (cguOk) {
      if (enAttente) { try { localStorage.removeItem(CLE_CGU_EN_ATTENTE); } catch { /* ignore */ } }
      return;
    }
    if (cguAutoRef.current === userId) return;
    const consenti = consentementInscription(user?.user_metadata, CGU_VERSION) || enAttenteValide(enAttente, CGU_VERSION);
    if (enAttente) { try { localStorage.removeItem(CLE_CGU_EN_ATTENTE); } catch { /* ignore */ } }
    if (!consenti) return;
    cguAutoRef.current = userId;
    acceptTerms().then((r) => {
      if (!r.ok) console.warn('[AUTH] Consentement CGU non enregistré (sera redemandé avant tout achat)');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profilId, cguOk, isAdmin]);

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
          // ⚠️ Ne PAS écraser un profil déjà chargé (qui peut porter l'accès offert comp_access_*)
          // par un profil local 'trial' sans ces champs. On ne crée un profil local que s'il n'y en a pas.
          if (isMounted) {
            setProfile((prev) => prev ?? createLocalProfile(
              session.user.id,
              userEmail,
              session.user.user_metadata,
            ));
          }
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

  // 💳 1er cours offert : réclame le bonus d'inscription une fois (idempotent côté backend).
  // Le backend ne crédite qu'une seule fois par utilisateur (ref=signup:<uid>).
  useEffect(() => {
    if (!user || isAdmin) return;
    const key = `bt_signup_bonus_${user.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    (async () => {
      try {
        const res = await claimSignupBonus();
        if (res.granted && res.granted > 0) {
          setProfile((prev) => (prev ? { ...prev, credits: res.balance ?? prev.credits } : prev));
        }
      } catch {
        /* silencieux : ne bloque jamais l'auth */
      }
    })();
  }, [user, isAdmin]);

  const value: AuthContextValue = {
    user,
    profile,
    session,
    isLoading,
    isAuthenticated,
    isAdmin,
    isSubscribed,
    isFree,
    hasAcceptedTerms,
    credits,
    hasCredits,
    refreshCredits,
    effectivePlan,
    compActive,
    isUnlimited,
    trackLimit,
    sessionLimit,
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
