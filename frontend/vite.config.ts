import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Migration CRA -> Vite. Comportement de l'appli inchangé ; on ne change que l'outil de build.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Cohérent avec tsconfig paths ("@/*" -> "./src/*")
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
  preview: {
    port: 3000,
    host: true,
  },
  build: {
    // IMPORTANT : garder 'build' (et non 'dist') pour ne pas casser le déploiement Coolify/nginx.
    outDir: 'build',
    sourcemap: false,
  },
  // IMPORTANT : expose les variables REACT_APP_* existantes (Coolify) en plus de VITE_*,
  // pour ne RIEN renommer côté déploiement.
  envPrefix: ['VITE_', 'REACT_APP_'],
  define: {
    // Polyfill léger pour d'éventuelles libs navigateur attendant `global` (peerjs, etc.).
    global: 'globalThis',
  },
});
