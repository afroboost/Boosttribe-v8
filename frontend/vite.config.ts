import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import brands from './src/config/brands.json';

// 🏷️ UNE SEULE APPLICATION, DEUX HABILLAGES (voir src/config/brand.ts).
//
//  `REACT_APP_BRAND=afroboost` construit « Afroboost Live », servi SOUS-CHEMIN
//  https://afroboost.com/live : `base` Vite, `basename` du routeur, chemin du
//  service worker, manifeste PWA et métadonnées de index.html en découlent
//  tous d'ici — la même source que l'application (`brands.json`). Sans variable,
//  c'est Boosttribe à la racine, exactement comme avant.
//
//  La variable peut venir de l'environnement du build (Coolify) OU d'un fichier
//  `.env.production` posé sur une branche de déploiement — `loadEnv` lit les
//  deux, l'environnement l'emportant. Surcharge possible : `REACT_APP_BASE_PATH`.
type BrandId = keyof typeof brands;

export function normaliserBase(valeur: string): string {
  let b = String(valeur || '/').trim();
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b = b + '/';
  return b.replace(/\/{2,}/g, '/');
}

export function resoudreMarque(env: Record<string, string | undefined>) {
  const brandId: BrandId = String(env.REACT_APP_BRAND || '').trim().toLowerCase() === 'afroboost'
    ? 'afroboost' : 'boosttribe';
  const brand = brands[brandId];
  const basePath = normaliserBase(env.REACT_APP_BASE_PATH || brand.basePath);
  const publicUrl = String(env.REACT_APP_PUBLIC_URL || brand.publicUrl).replace(/\/+$/, '');
  return { brandId, brand, basePath, publicUrl };
}

/** Le manifeste PWA de la MARQUE : nom, chemins sous `base`, couleur, raccourci. */
export function manifestePourLaMarque(source: Record<string, unknown>, id: BrandId, base: string) {
  const b = brands[id];
  const prefixe = (p: string) => base + String(p).replace(/^\/+/, '');
  const icons = (source.icons as Array<Record<string, string>>).map((i) => ({ ...i, src: prefixe(i.src) }));
  return {
    ...source,
    short_name: b.name,
    name: b.name,
    description: b.manifest.description,
    icons,
    start_url: base,
    scope: base,
    theme_color: b.themeColor,
    categories: b.manifest.categories,
    shortcuts: [{
      ...b.manifest.shortcut,
      url: prefixe('/session'),
      icons: [{ src: prefixe('/icon-192x192.png'), sizes: '192x192' }],
    }],
  };
}

function manifestePlugin(brandId: BrandId, basePath: string): Plugin {
  const publicManifest = fileURLToPath(new URL('./public/manifest.json', import.meta.url));
  return {
    name: 'boosttribe-manifeste-de-marque',
    // Build : réécrit build/manifest.json (copié brut depuis public/ par Vite).
    closeBundle() {
      const src = JSON.parse(readFileSync(publicManifest, 'utf8'));
      const cible = join(fileURLToPath(new URL('./build', import.meta.url)), 'manifest.json');
      mkdirSync(dirname(cible), { recursive: true });
      writeFileSync(cible, JSON.stringify(manifestePourLaMarque(src, brandId, basePath), null, 2) + '\n');
    },
    // Dev : même contenu servi à la volée.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0] === basePath + 'manifest.json') {
          const src = JSON.parse(readFileSync(publicManifest, 'utf8'));
          res.setHeader('Content-Type', 'application/manifest+json');
          res.end(JSON.stringify(manifestePourLaMarque(src, brandId, basePath)));
          return;
        }
        next();
      });
    },
  };
}

// Migration CRA -> Vite. Comportement de l'appli inchangé ; on ne change que l'outil de build.
export default defineConfig(({ mode }) => {
  const racine = fileURLToPath(new URL('.', import.meta.url));
  // Fichiers .env (dont .env.production) PUIS environnement du processus, qui l'emporte.
  const env = { ...loadEnv(mode, racine, ['VITE_', 'REACT_APP_']), ...process.env };
  const { brandId, brand, basePath, publicUrl } = resoudreMarque(env);

  // Les `%REACT_APP_…%` de index.html sont remplacés par Vite depuis process.env :
  // on y pose la marque résolue, pour que le HTML ne dépende d'aucune valeur absente.
  process.env.REACT_APP_BRAND = brandId;
  process.env.REACT_APP_BASE_PATH = basePath;
  process.env.REACT_APP_BRAND_NAME = brand.name;
  process.env.REACT_APP_BRAND_TITLE = brand.title;
  process.env.REACT_APP_BRAND_DESCRIPTION = brand.description;
  process.env.REACT_APP_BRAND_SHORT_DESCRIPTION = brand.shortDescription;
  process.env.REACT_APP_BRAND_KEYWORDS = brand.keywords;
  process.env.REACT_APP_BRAND_AUTHOR = brand.author;
  process.env.REACT_APP_BRAND_THEME_COLOR = brand.themeColor;
  process.env.REACT_APP_PUBLIC_URL = publicUrl;

  return {
    base: basePath,
    plugins: [react(), manifestePlugin(brandId, basePath)],
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
  };
});
