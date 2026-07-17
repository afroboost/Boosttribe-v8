import React, { createContext, useContext, ReactNode, useState, useCallback } from 'react';
import { BeattribeTheme, theme as initialThemeConfig } from '@/config/theme.types';

// LocalStorage key for theme persistence
const STORAGE_KEY = 'bt_theme_config';

// Deep partial type for partial updates
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Context type with update function
interface ThemeContextType {
  theme: BeattribeTheme;
  updateConfig: (updates: DeepPartial<BeattribeTheme>) => void;
  saveConfig: () => boolean;
  resetConfig: () => void;
  clearStoredConfig: () => void;
  hasChanges: boolean;
  isStoredConfig: boolean;
}

// Create context with default value
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Provider props
interface ThemeProviderProps {
  children: ReactNode;
}

// Deep merge utility function with proper typing
function deepMerge(target: BeattribeTheme, source: DeepPartial<BeattribeTheme>): BeattribeTheme {
  const result = JSON.parse(JSON.stringify(target)) as BeattribeTheme;
  
  function mergeDeep(targetObj: Record<string, unknown>, sourceObj: Record<string, unknown>): void {
    for (const key in sourceObj) {
      if (Object.prototype.hasOwnProperty.call(sourceObj, key)) {
        const sourceValue = sourceObj[key];
        const targetValue = targetObj[key];
        
        if (
          sourceValue !== null &&
          sourceValue !== undefined &&
          typeof sourceValue === 'object' &&
          !Array.isArray(sourceValue) &&
          targetValue !== null &&
          targetValue !== undefined &&
          typeof targetValue === 'object' &&
          !Array.isArray(targetValue)
        ) {
          mergeDeep(targetValue as Record<string, unknown>, sourceValue as Record<string, unknown>);
        } else if (sourceValue !== undefined) {
          targetObj[key] = sourceValue;
        }
      }
    }
  }
  
  mergeDeep(result as unknown as Record<string, unknown>, source as unknown as Record<string, unknown>);
  
  return result;
}

// Load theme from LocalStorage
function loadStoredTheme(): BeattribeTheme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as BeattribeTheme;
      // Validate the structure has required fields
      if (parsed.name && parsed.slogan && parsed.colors && parsed.fonts) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('Failed to load stored theme config:', error);
  }
  return null;
}

// Save theme to LocalStorage
function saveThemeToStorage(theme: BeattribeTheme): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
    return true;
  } catch (error) {
    console.error('Failed to save theme config:', error);
    return false;
  }
}

// Clear theme from LocalStorage
function clearStoredTheme(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear stored theme:', error);
  }
}

// Convertit une couleur hex (#RGB ou #RRGGBB) en canaux « R G B » pour rgb(var(--x) / alpha).
// Retourne null si la valeur n'est pas un hex (ex. déjà rgb()/hsl()/var()).
function hexToRgbChannels(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

// Apply CSS variables to document
function applyCSSVariables(theme: BeattribeTheme): void {
  const root = document.documentElement;
  const { colors, fonts } = theme;

  // 🎨 ACCENT CENTRALISÉ — piloté par l'admin (site_settings.color_primary / _secondary).
  //    Une seule source de vérité : toute l'app lit var(--bt-accent) / var(--bt-accent-2).
  //    ⚠️ NE PAS réutiliser --accent (déjà pris par shadcn en format HSL). D'où --bt-accent.
  //    Variantes « -rgb » pour pouvoir appliquer une opacité : rgb(var(--bt-accent-rgb) / .2).
  root.style.setProperty('--bt-accent', colors.primary);
  root.style.setProperty('--bt-accent-2', colors.secondary);
  const rgb1 = hexToRgbChannels(colors.primary);
  const rgb2 = hexToRgbChannels(colors.secondary);
  if (rgb1) root.style.setProperty('--bt-accent-rgb', rgb1);
  if (rgb2) root.style.setProperty('--bt-accent-2-rgb', rgb2);
  root.style.setProperty('--bt-accent-gradient', `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`);

  // Set --bt- CSS variables
  root.style.setProperty('--bt-background', colors.background);
  root.style.setProperty('--bt-primary', colors.primary);
  root.style.setProperty('--bt-secondary', colors.secondary);
  root.style.setProperty('--bt-surface', colors.surface);
  root.style.setProperty('--bt-surface-solid', colors.surfaceSolid);
  root.style.setProperty('--bt-text-primary', colors.text.primary);
  root.style.setProperty('--bt-text-secondary', colors.text.secondary);
  root.style.setProperty('--bt-text-muted', colors.text.muted);
  root.style.setProperty('--bt-gradient-primary', colors.gradient.primary);
  root.style.setProperty('--bt-glow', colors.gradient.glow);
  root.style.setProperty('--bt-font-heading', fonts.heading);
  root.style.setProperty('--bt-font-body', fonts.body);
}

// Theme Provider component
export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // Initialize from LocalStorage or default config
  const [theme, setTheme] = useState<BeattribeTheme>(() => {
    const storedTheme = loadStoredTheme();
    if (storedTheme) {
      // Force name to Boosttribe (override any cached "Beattribe")
      return { ...storedTheme, name: initialThemeConfig.name };
    }
    return JSON.parse(JSON.stringify(initialThemeConfig)) as BeattribeTheme;
  });
  
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [isStoredConfig, setIsStoredConfig] = useState<boolean>(() => loadStoredTheme() !== null);

  // Apply CSS variables on mount and when theme changes
  React.useEffect(() => {
    applyCSSVariables(theme);
  }, [theme]);

  // Update config function - performs deep merge
  const updateConfig = useCallback((updates: DeepPartial<BeattribeTheme>) => {
    setTheme((currentTheme: BeattribeTheme): BeattribeTheme => {
      return deepMerge(currentTheme, updates);
    });
    setHasChanges(true);
  }, []);

  // Save config to LocalStorage
  const saveConfig = useCallback((): boolean => {
    const success = saveThemeToStorage(theme);
    if (success) {
      setHasChanges(false);
      setIsStoredConfig(true);
    }
    return success;
  }, [theme]);

  // Reset to initial config (from JSON file)
  const resetConfig = useCallback(() => {
    setTheme(JSON.parse(JSON.stringify(initialThemeConfig)) as BeattribeTheme);
    setHasChanges(false);
  }, []);

  // Clear stored config and reset to defaults
  const clearStoredConfig = useCallback(() => {
    clearStoredTheme();
    setTheme(JSON.parse(JSON.stringify(initialThemeConfig)) as BeattribeTheme);
    setHasChanges(false);
    setIsStoredConfig(false);
  }, []);

  const value: ThemeContextType = {
    theme,
    updateConfig,
    saveConfig,
    resetConfig,
    clearStoredConfig,
    hasChanges,
    isStoredConfig,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook to use theme
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Export the raw theme for direct access (initial values)
export { initialThemeConfig as theme };
