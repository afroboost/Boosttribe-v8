import React from 'react';
import { useTheme } from '@/context/ThemeContext';

// Mention de copyright discrète, affichée en pied de page sur les pages publiques.
// Année de fin dynamique (2024–année courante), à jour automatiquement.
export const Footer: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme } = useTheme();
  const year = new Date().getFullYear();
  return (
    <footer className={`py-6 border-t border-white/10 ${className}`}>
      <p className="text-center text-white/40 text-sm px-4">
        © 2024–{year} {theme.name}. Tous droits réservés.
      </p>
    </footer>
  );
};

export default Footer;
