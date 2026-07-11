import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'pro.boosttribe.app',
  appName: 'BoostTribe',
  webDir: 'build',                 // ⚠️ Vite sort dans build/ (PAS dist/)
  android: { allowMixedContent: false },
  server: { androidScheme: 'https' },
};

export default config;
