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

// Re-export the theme JSON with proper typing
import themeData from './theme.json';
export const theme: BeattribeTheme = themeData as BeattribeTheme;
