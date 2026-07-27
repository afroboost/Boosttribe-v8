import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '@/context/ThemeContext';

// Mention de copyright discrète, affichée en pied de page sur les pages publiques.
// Année de fin dynamique (2024–année courante), à jour automatiquement.
export const Footer: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme } = useTheme();
  const year = new Date().getFullYear();
  return (
    <footer className={`py-6 border-t border-white/10 ${className}`}>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 text-sm text-white/40">
        <span>© 2024–{year} {theme.name}. Tous droits réservés.</span>
        <span aria-hidden="true" className="hidden sm:inline text-white/20">·</span>
        {/* 📄 Lien légal discret — requis pour la fiche Play Store */}
        <Link to="/confidentialite" className="hover:text-white transition-colors">
          Confidentialité
        </Link>
      </div>
    </footer>
  );
};

export default Footer;
