import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { Globe, Check } from 'lucide-react';

// Types
export type Language = 'fr' | 'en' | 'de';

interface Translations {
  [key: string]: {
    fr: string;
    en: string;
    de: string;
  };
}

// Traductions
const translations: Translations = {
  // Navigation
  'nav.login': {
    fr: 'Connexion',
    en: 'Login',
    de: 'Anmelden',
  },
  'nav.pricing': {
    fr: 'Tarifs',
    en: 'Pricing',
    de: 'Preise',
  },
  'nav.features': {
    fr: 'Fonctionnalités',
    en: 'Features',
    de: 'Funktionen',
  },
  
  // Hero Section
  'hero.badge': {
    fr: 'La communauté des créateurs',
    en: 'The community of creators',
    de: 'Die Gemeinschaft der Schöpfer',
  },
  'hero.title': {
    fr: 'Unite Through Rhythm',
    en: 'Unite Through Rhythm',
    de: 'Vereint durch Rhythmus',
  },
  'hero.subtitle': {
    fr: 'Créez des sessions d\'écoute synchronisées avec vos proches. Partagez la musique en temps réel.',
    en: 'Create synchronized listening sessions with your loved ones. Share music in real time.',
    de: 'Erstellen Sie synchronisierte Hörsitzungen mit Ihren Liebsten. Teilen Sie Musik in Echtzeit.',
  },
  'hero.cta.create': {
    fr: 'Créer ma session',
    en: 'Create my session',
    de: 'Meine Session erstellen',
  },
  'hero.cta.join': {
    fr: 'Rejoindre une session',
    en: 'Join a session',
    de: 'Session beitreten',
  },
  
  // Stats
  'stats.creators': {
    fr: 'Créateurs',
    en: 'Creators',
    de: 'Ersteller',
  },
  'stats.beats': {
    fr: 'Beats partagés',
    en: 'Beats shared',
    de: 'Geteilte Beats',
  },
  'stats.countries': {
    fr: 'Pays',
    en: 'Countries',
    de: 'Länder',
  },
  
  // Pricing
  'pricing.title': {
    fr: 'Choisissez votre plan',
    en: 'Choose your plan',
    de: 'Wählen Sie Ihren Plan',
  },
  'pricing.monthly': {
    fr: 'Mensuel',
    en: 'Monthly',
    de: 'Monatlich',
  },
  'pricing.yearly': {
    fr: 'Annuel',
    en: 'Yearly',
    de: 'Jährlich',
  },
  'pricing.free': {
    fr: 'Essai Gratuit',
    en: 'Free Trial',
    de: 'Kostenlose Testversion',
  },
  'pricing.pro': {
    fr: 'Pro',
    en: 'Pro',
    de: 'Pro',
  },
  'pricing.enterprise': {
    fr: 'Enterprise',
    en: 'Enterprise',
    de: 'Enterprise',
  },
  'pricing.subscribe': {
    fr: 'Souscrire',
    en: 'Subscribe',
    de: 'Abonnieren',
  },
  'pricing.free.cta': {
    fr: 'Commencer gratuitement',
    en: 'Start for free',
    de: 'Kostenlos starten',
  },
  
  // Session
  'session.title': {
    fr: 'Session d\'écoute',
    en: 'Listening Session',
    de: 'Hörsitzung',
  },
  'session.playlist': {
    fr: 'Playlist',
    en: 'Playlist',
    de: 'Playlist',
  },
  'session.participants': {
    fr: 'Participants',
    en: 'Participants',
    de: 'Teilnehmer',
  },
  'session.upload': {
    fr: 'Ajouter une piste',
    en: 'Add a track',
    de: 'Track hinzufügen',
  },
  'session.empty': {
    fr: 'Aucun titre',
    en: 'No tracks',
    de: 'Keine Titel',
  },
  
  // Auth
  'auth.login': {
    fr: 'Connexion',
    en: 'Login',
    de: 'Anmelden',
  },
  'auth.register': {
    fr: 'Inscription',
    en: 'Register',
    de: 'Registrieren',
  },
  'auth.email': {
    fr: 'Email',
    en: 'Email',
    de: 'E-Mail',
  },
  'auth.password': {
    fr: 'Mot de passe',
    en: 'Password',
    de: 'Passwort',
  },
  'auth.google': {
    fr: 'Continuer avec Google',
    en: 'Continue with Google',
    de: 'Mit Google fortfahren',
  },
  
  // Common
  'common.loading': {
    fr: 'Chargement...',
    en: 'Loading...',
    de: 'Wird geladen...',
  },
  'common.error': {
    fr: 'Erreur',
    en: 'Error',
    de: 'Fehler',
  },
  'common.success': {
    fr: 'Succès',
    en: 'Success',
    de: 'Erfolg',
  },
  'common.cancel': {
    fr: 'Annuler',
    en: 'Cancel',
    de: 'Abbrechen',
  },
  'common.save': {
    fr: 'Enregistrer',
    en: 'Save',
    de: 'Speichern',
  },
  'common.back': {
    fr: 'Retour',
    en: 'Back',
    de: 'Zurück',
  },
};

// Context
interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

// Provider
interface I18nProviderProps {
  children: ReactNode;
  defaultLanguage?: Language;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({ children, defaultLanguage = 'fr' }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    // Check localStorage first
    const saved = localStorage.getItem('boosttribe_language');
    if (saved && ['fr', 'en', 'de'].includes(saved)) {
      return saved as Language;
    }
    return defaultLanguage;
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('boosttribe_language', lang);
  }, []);

  const t = useCallback((key: string): string => {
    const translation = translations[key];
    if (!translation) {
      console.warn(`[i18n] Missing translation: ${key}`);
      return key;
    }
    return translation[language] || translation.fr || key;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

// Hook
export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};

// Language Selector Component — bouton icône Globe + menu déroulant (FR/EN/DE)
export const LanguageSelector: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { language, setLanguage } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const languages: { code: Language; label: string }[] = [
    { code: 'fr', label: 'Français' },
    { code: 'en', label: 'English' },
    { code: 'de', label: 'Deutsch' },
  ];

  // Fermeture au clic extérieur
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (code: Language) => {
    setLanguage(code); // persistance localStorage gérée dans setLanguage
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 transition-all"
        title="Langue"
        aria-haspopup="true"
        aria-expanded={isOpen}
        data-testid="lang-switcher"
      >
        <Globe className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-40 rounded-xl border border-white/10 bg-[#15151b] shadow-xl backdrop-blur-xl overflow-hidden z-50"
          role="menu"
        >
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleSelect(lang.code)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                language === lang.code
                  ? 'bg-purple-500/20 text-white'
                  : 'text-white/70 hover:bg-white/10'
              }`}
              role="menuitem"
              data-testid={`lang-${lang.code}`}
            >
              <span>{lang.label}</span>
              {language === lang.code && <Check className="w-4 h-4 text-purple-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default I18nProvider;
