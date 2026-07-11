import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'pro.boosttribe.app',
  appName: 'BoostTribe',
  webDir: 'build',                 // ⚠️ Vite sort dans build/ (PAS dist/)
  android: { allowMixedContent: false },
  server: {
    androidScheme: 'https',
    // Charge le site live (déjà configuré : Supabase, TURN, etc.) → login OK dans l'app native.
    // Interim : on repassera aux assets bundlés (avec .env) avant la publication Store si besoin.
    url: 'https://boosttribe.pro',
    cleartext: false,
  },
};

export default config;
