import { useEffect, useState, useCallback } from 'react';
import supabase, { isSupabaseConfigured } from '@/lib/supabaseClient';
import { useTheme } from '@/context/ThemeContext';

// Site settings interface
interface SiteSettings {
  id?: string;
  site_name: string;
  site_slogan: string;
  site_description: string;
  site_badge: string;
  favicon_url: string;
  color_primary: string;
  color_secondary: string;
  color_background: string;
  btn_login: string;
  btn_start: string;
  btn_join: string;
  btn_explore: string;
  stat_creators: string;
  stat_beats: string;
  stat_countries: string;
  // Stripe Payment Links
  stripe_pro_monthly: string;
  stripe_pro_yearly: string;
  stripe_enterprise_monthly: string;
  stripe_enterprise_yearly: string;
  // Plan visibility & pricing
  plan_pro_visible: boolean;
  plan_enterprise_visible: boolean;
  plan_pro_price_monthly: string;
  plan_pro_price_yearly: string;
  plan_enterprise_price_monthly: string;
  plan_enterprise_price_yearly: string;
  default_language: string;
}

const DEFAULT_SETTINGS: SiteSettings = {
  site_name: 'Boosttribe',
  site_slogan: 'Unite Through Rhythm',
  site_description: 'Rejoignez la communauté des beatmakers et producteurs.',
  site_badge: 'La communauté des créateurs',
  favicon_url: '',
  color_primary: '#8A2EFF',
  color_secondary: '#FF2FB3',
  color_background: '#000000',
  btn_login: 'Connexion',
  btn_start: 'Commencer',
  btn_join: 'Rejoindre la tribu',
  btn_explore: 'Explorer les beats',
  stat_creators: '50K+',
  stat_beats: '1M+',
  stat_countries: '120+',
  // Stripe defaults (empty - to be configured by admin)
  stripe_pro_monthly: '',
  stripe_pro_yearly: '',
  stripe_enterprise_monthly: '',
  stripe_enterprise_yearly: '',
  // Plan visibility & pricing defaults
  plan_pro_visible: true,
  plan_enterprise_visible: true,
  plan_pro_price_monthly: '9.99',
  plan_pro_price_yearly: '99.99',
  plan_enterprise_price_monthly: '29.99',
  plan_enterprise_price_yearly: '299.99',
  default_language: 'fr',
};

/**
 * Safely merge DB data with defaults to prevent TypeError on missing columns
 * Any missing column returns empty string instead of crashing
 */
function safeSettings(data: Record<string, unknown> | null): SiteSettings {
  if (!data) return DEFAULT_SETTINGS;
  
  try {
    // Force "Boosttribe" si la DB contient encore "Beattribe"
    let siteName = String(data.site_name ?? DEFAULT_SETTINGS.site_name);
    if (siteName.toLowerCase() === 'beattribe') {
      siteName = 'Boosttribe';
    }
    
    return {
      id: String(data.id ?? ''),
      site_name: siteName,
      site_slogan: String(data.site_slogan ?? DEFAULT_SETTINGS.site_slogan),
      site_description: String(data.site_description ?? DEFAULT_SETTINGS.site_description),
      site_badge: String(data.site_badge ?? DEFAULT_SETTINGS.site_badge),
      favicon_url: String(data.favicon_url ?? ''),
      color_primary: String(data.color_primary ?? DEFAULT_SETTINGS.color_primary),
      color_secondary: String(data.color_secondary ?? DEFAULT_SETTINGS.color_secondary),
      color_background: String(data.color_background ?? DEFAULT_SETTINGS.color_background),
      btn_login: String(data.btn_login ?? DEFAULT_SETTINGS.btn_login),
      btn_start: String(data.btn_start ?? DEFAULT_SETTINGS.btn_start),
      btn_join: String(data.btn_join ?? DEFAULT_SETTINGS.btn_join),
      btn_explore: String(data.btn_explore ?? DEFAULT_SETTINGS.btn_explore),
      stat_creators: String(data.stat_creators ?? DEFAULT_SETTINGS.stat_creators),
      stat_beats: String(data.stat_beats ?? DEFAULT_SETTINGS.stat_beats),
      stat_countries: String(data.stat_countries ?? DEFAULT_SETTINGS.stat_countries),
      // Stripe - SAFE: returns empty string if column missing
      stripe_pro_monthly: String(data.stripe_pro_monthly ?? ''),
      stripe_pro_yearly: String(data.stripe_pro_yearly ?? ''),
      stripe_enterprise_monthly: String(data.stripe_enterprise_monthly ?? ''),
      stripe_enterprise_yearly: String(data.stripe_enterprise_yearly ?? ''),
      // Plan visibility & pricing - SAFE: returns defaults if missing
      plan_pro_visible: data.plan_pro_visible !== false,
      plan_enterprise_visible: data.plan_enterprise_visible !== false,
      plan_pro_price_monthly: String(data.plan_pro_price_monthly ?? '9.99'),
      plan_pro_price_yearly: String(data.plan_pro_price_yearly ?? '99.99'),
      plan_enterprise_price_monthly: String(data.plan_enterprise_price_monthly ?? '29.99'),
      plan_enterprise_price_yearly: String(data.plan_enterprise_price_yearly ?? '299.99'),
      default_language: String(data.default_language ?? 'fr'),
    };
  } catch (err) {
    console.warn('[SiteSettings] safeSettings error:', err);
    return DEFAULT_SETTINGS;
  }
}

// Global cache for settings
let cachedSettings: SiteSettings | null = null;
let isLoading = false;
let loadPromise: Promise<SiteSettings> | null = null;

/**
 * Hook to load and apply site settings globally
 * Loads from Supabase once and caches the result
 * Falls back to defaults if Supabase fails
 */
export function useSiteSettings() {
  const [settings, setSettings] = useState<SiteSettings>(cachedSettings || DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(!!cachedSettings);
  const { updateConfig } = useTheme();

  // Load settings from Supabase (singleton pattern)
  // IMPORTANT: If table is empty, insert default row automatically
  const loadSettings = useCallback(async (): Promise<SiteSettings> => {
    // Return cached if available
    if (cachedSettings) {
      return cachedSettings;
    }

    // Return existing promise if loading
    if (loadPromise) {
      return loadPromise;
    }

    // Start loading
    isLoading = true;
    
    loadPromise = (async () => {
      if (!isSupabaseConfigured || !supabase) {
        console.log('[SiteSettings] Supabase not configured, using defaults');
        cachedSettings = DEFAULT_SETTINGS;
        return DEFAULT_SETTINGS;
      }

      try {
        // Step 1: Try to fetch existing settings
        const { data, error } = await supabase
          .from('site_settings')
          .select('*')
          .limit(1)
          .maybeSingle();

        // Step 2: If no data exists, INSERT default row
        if (!data && !error) {
          console.log('[SiteSettings] Table empty, inserting default row...');
          const { data: insertedData, error: insertError } = await supabase
            .from('site_settings')
            .insert([{
              site_name: DEFAULT_SETTINGS.site_name,
              site_slogan: DEFAULT_SETTINGS.site_slogan,
              site_description: DEFAULT_SETTINGS.site_description,
              site_badge: DEFAULT_SETTINGS.site_badge,
              favicon_url: DEFAULT_SETTINGS.favicon_url,
              color_primary: DEFAULT_SETTINGS.color_primary,
              color_secondary: DEFAULT_SETTINGS.color_secondary,
              color_background: DEFAULT_SETTINGS.color_background,
              btn_login: DEFAULT_SETTINGS.btn_login,
              btn_start: DEFAULT_SETTINGS.btn_start,
              btn_join: DEFAULT_SETTINGS.btn_join,
              btn_explore: DEFAULT_SETTINGS.btn_explore,
              stat_creators: DEFAULT_SETTINGS.stat_creators,
              stat_beats: DEFAULT_SETTINGS.stat_beats,
              stat_countries: DEFAULT_SETTINGS.stat_countries,
              stripe_pro_monthly: DEFAULT_SETTINGS.stripe_pro_monthly,
              stripe_pro_yearly: DEFAULT_SETTINGS.stripe_pro_yearly,
              stripe_enterprise_monthly: DEFAULT_SETTINGS.stripe_enterprise_monthly,
              stripe_enterprise_yearly: DEFAULT_SETTINGS.stripe_enterprise_yearly,
            }])
            .select()
            .single();

          if (insertError) {
            console.warn('[SiteSettings] Failed to insert default row:', insertError);
            cachedSettings = DEFAULT_SETTINGS;
            return DEFAULT_SETTINGS;
          }

          console.log('[SiteSettings] ✅ Default row inserted successfully');
          // Use safeSettings to prevent TypeError on missing columns
          cachedSettings = safeSettings(insertedData);
          return cachedSettings;
        }

        if (error) {
          console.warn('[SiteSettings] Query error:', error.message);
          cachedSettings = DEFAULT_SETTINGS;
          return DEFAULT_SETTINGS;
        }

        console.log('[SiteSettings] ✅ Loaded from Supabase:', data.site_name);
        // Use safeSettings to prevent TypeError on missing columns
        cachedSettings = safeSettings(data);
        return cachedSettings;
      } catch (err) {
        console.warn('[SiteSettings] Error loading:', err);
        cachedSettings = DEFAULT_SETTINGS;
        return DEFAULT_SETTINGS;
      } finally {
        isLoading = false;
      }
    })();

    return loadPromise;
  }, []);

  // Load settings on mount
  useEffect(() => {
    let isMounted = true;

    loadSettings().then(loadedSettings => {
      if (isMounted) {
        setSettings(loadedSettings);
        setIsLoaded(true);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [loadSettings]);

  // Apply favicon when settings change
  useEffect(() => {
    if (settings.favicon_url) {
      let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      if (link.href !== settings.favicon_url) {
        link.href = settings.favicon_url;
        console.log('[SiteSettings] Favicon applied:', settings.favicon_url);
      }
    }
  }, [settings.favicon_url]);

  // Apply document title
  useEffect(() => {
    if (settings.site_name) {
      document.title = `${settings.site_name} - ${settings.site_slogan}`;
    }
  }, [settings.site_name, settings.site_slogan]);

  // Update theme context with settings
  useEffect(() => {
    if (isLoaded) {
      updateConfig({
        name: settings.site_name,
        slogan: settings.site_slogan,
        description: settings.site_description,
        badge: settings.site_badge,
        colors: {
          primary: settings.color_primary,
          secondary: settings.color_secondary,
          background: settings.color_background,
          gradient: {
            primary: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)`,
          },
        },
        buttons: {
          login: settings.btn_login,
          start: settings.btn_start,
          joinTribe: settings.btn_join,
          exploreBeats: settings.btn_explore,
        },
        stats: [
          { value: settings.stat_creators, label: 'Créateurs' },
          { value: settings.stat_beats, label: 'Beats partagés' },
          { value: settings.stat_countries, label: 'Pays' },
        ],
      });
    }
  }, [settings, isLoaded, updateConfig]);

  return {
    settings,
    isLoaded,
    isLoading: isLoading,
    reload: loadSettings, // Expose reload function
  };
}

// Event emitter for global refresh
type RefreshListener = () => void;
const refreshListeners: Set<RefreshListener> = new Set();

// Subscribe to refresh events
export function onSettingsRefresh(listener: RefreshListener): () => void {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
}

// Force refresh cached settings AND notify all subscribers
export function refreshSiteSettings() {
  console.log('[SiteSettings] Force refresh triggered');
  cachedSettings = null;
  loadPromise = null;
  // Notify all subscribers to reload
  refreshListeners.forEach(listener => listener());
}

export default useSiteSettings;
