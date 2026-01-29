import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

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

// Language Selector Component
export const LanguageSelector: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { language, setLanguage } = useI18n();

  const languages: { code: Language; flag: string; label: string }[] = [
    { code: 'fr', flag: '🇫🇷', label: 'FR' },
    { code: 'en', flag: '🇬🇧', label: 'EN' },
    { code: 'de', flag: '🇩🇪', label: 'DE' },
  ];

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {languages.map((lang) => (
        <button
          key={lang.code}
          onClick={() => setLanguage(lang.code)}
          className={`px-2 py-1 rounded text-xs font-medium transition-all ${
            language === lang.code
              ? 'bg-purple-500 text-white'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
          title={lang.label}
          data-testid={`lang-${lang.code}`}
        >
          {lang.flag}
        </button>
      ))}
    </div>
  );
};

export default I18nProvider;
