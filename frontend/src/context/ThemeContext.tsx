import React, { createContext, useContext, ReactNode, useState, useCallback } from 'react';
import { BeattribeTheme, theme as initialThemeConfig } from '@/config/theme.types';

// Deep partial type for partial updates
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Context type with update function
interface ThemeContextType {
  theme: BeattribeTheme;
  updateConfig: (updates: DeepPartial<BeattribeTheme>) => void;
  resetConfig: () => void;
  hasChanges: boolean;
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

// Apply CSS variables to document
function applyCSSVariables(theme: BeattribeTheme): void {
  const root = document.documentElement;
  const { colors, fonts } = theme;

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
  // State for the theme configuration
  const [theme, setTheme] = useState<BeattribeTheme>(() => 
    JSON.parse(JSON.stringify(initialThemeConfig)) as BeattribeTheme
  );
  const [hasChanges, setHasChanges] = useState<boolean>(false);

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

  // Reset to initial config
  const resetConfig = useCallback(() => {
    setTheme(JSON.parse(JSON.stringify(initialThemeConfig)) as BeattribeTheme);
    setHasChanges(false);
  }, []);

  const value: ThemeContextType = {
    theme,
    updateConfig,
    resetConfig,
    hasChanges,
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
