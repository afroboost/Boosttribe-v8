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
}

const DEFAULT_SETTINGS: SiteSettings = {
  site_name: 'Beattribe',
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
};

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
        const { data, error } = await supabase
          .from('site_settings')
          .select('*')
          .limit(1)
          .maybeSingle();

        if (error || !data) {
          console.log('[SiteSettings] No data in DB, using defaults');
          cachedSettings = DEFAULT_SETTINGS;
          return DEFAULT_SETTINGS;
        }

        console.log('[SiteSettings] ✅ Loaded from Supabase:', data.site_name);
        cachedSettings = data as SiteSettings;
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
  };
}

// Force refresh cached settings (call after CMS save)
export function refreshSiteSettings() {
  cachedSettings = null;
  loadPromise = null;
}

export default useSiteSettings;
