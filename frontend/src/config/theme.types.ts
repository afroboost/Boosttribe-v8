// Boosttribe Theme Type Definitions

export interface ThemeColors {
  background: string;
  primary: string;
  secondary: string;
  surface: string;
  surfaceSolid: string;
  text: {
    primary: string;
    secondary: string;
    muted: string;
  };
  gradient: {
    primary: string;
    glow: string;
  };
}

export interface ThemeFonts {
  heading: string;
  body: string;
}

export interface ThemeBorderRadius {
  sm: string;
  md: string;
  lg: string;
  full: string;
}

export interface NavigationLink {
  label: string;
  href: string;
}

export interface ThemeNavigation {
  links: NavigationLink[];
}

export interface ThemeButtons {
  login: string;
  start: string;
  joinTribe: string;
  exploreBeats: string;
}

export interface ThemeStat {
  value: string;
  label: string;
}

export interface BeattribeTheme {
  name: string;
  slogan: string;
  description: string;
  badge: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  borderRadius: ThemeBorderRadius;
  navigation: ThemeNavigation;
  buttons: ThemeButtons;
  stats: ThemeStat[];
  scrollIndicator: string;
}

// Le thème initial dépend de la MARQUE du build (cf. ./brand.ts) : Boosttribe
// par défaut, Afroboost Live quand REACT_APP_BRAND=afroboost.
import themeBoosttribe from './theme.json';
import themeAfroboost from './theme.afroboost.json';
const _brandId = String(import.meta.env.REACT_APP_BRAND || '').trim().toLowerCase();
export const theme: BeattribeTheme = (_brandId === 'afroboost' ? themeAfroboost : themeBoosttribe) as BeattribeTheme;
