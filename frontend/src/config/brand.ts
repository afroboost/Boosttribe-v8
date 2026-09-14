// 🏷️ LA MARQUE DE CE BUILD — une seule application, deux habillages.
//
//  POURQUOI. Afroboost embarque le live dans une iframe sur afroboost.com/live.
//  Cette variante était une COPIE du dépôt (« Afroboost Live », août 2026) :
//  figée le 7 août, elle n'a jamais reçu le prompteur ni les commandes musique
//  du plein écran, pendant que boosttribe.pro les avait. Deux codes = deux
//  produits qui divergent en silence. Désormais, le MÊME code se construit
//  dans l'un ou l'autre habillage : `REACT_APP_BRAND=afroboost` au build.
//
//  CE QUI CHANGE AVEC LA MARQUE : nom, textes par défaut, couleurs, chemin de
//  base (/live/), URL publique, manifeste, ce que vend la page Tarifs.
//  CE QUI NE CHANGE JAMAIS : la session, le live, le prompteur, la musique —
//  aucun composant ne doit lire cette marque pour décider d'un OUTIL du coach.
//
//  Le catalogue (`brands.json`) est aussi lu par `vite.config.ts` (Node), qui
//  en tire le `base` du build et les métadonnées de `index.html` : une seule
//  source pour les deux côtés.
import brands from './brands.json';
import { theme as _theme, type BeattribeTheme } from './theme.types';

export type BrandId = 'boosttribe' | 'afroboost';

export interface Brand {
  id: BrandId;
  name: string;
  title: string;
  description: string;
  shortDescription: string;
  keywords: string;
  author: string;
  publicUrl: string;
  basePath: string;
  themeColor: string;
  communityBadge: { fr: string; en: string; de: string };
  filePrefix: string;
  vendCredits: boolean;
  manifest: {
    description: string;
    categories: string[];
    shortcut: { name: string; short_name: string; description: string };
  };
}

export function resolveBrandId(raw: unknown): BrandId {
  return String(raw || '').trim().toLowerCase() === 'afroboost' ? 'afroboost' : 'boosttribe';
}

export const BRAND_ID: BrandId = resolveBrandId(import.meta.env.REACT_APP_BRAND);
export const BRAND: Brand = (brands as Record<BrandId, Brand>)[BRAND_ID];

/** URL publique canonique (liens partagés, redirections d'auth), sans barre finale.
 *  Surchargeable par `REACT_APP_PUBLIC_URL` pour un environnement de test. */
export const PUBLIC_URL: string = String(import.meta.env.REACT_APP_PUBLIC_URL || BRAND.publicUrl)
  .replace(/\/+$/, '');

/** Le thème initial de ce build (couleurs, textes du hero). */
export const BRAND_THEME: BeattribeTheme = _theme;
