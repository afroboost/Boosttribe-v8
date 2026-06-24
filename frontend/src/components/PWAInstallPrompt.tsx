import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone, Share } from 'lucide-react';

/**
 * 🚀 PWA INSTALL PROMPT - Boosttribe V8
 * 
 * Affiche un bouton d'installation PWA discret qui :
 * - N'apparaît que si l'app n'est pas encore installée
 * - Utilise l'événement beforeinstallprompt
 * - Peut être fermé définitivement par l'utilisateur
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PWAInstallPromptProps {
  variant?: 'banner' | 'button' | 'minimal';
  className?: string;
}

export const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({
  variant = 'minimal',
  className = '',
}) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  // iOS Safari n'émet pas beforeinstallprompt → consigne manuelle "Partager → écran d'accueil"
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  // Vérifier si l'app est déjà installée
  useEffect(() => {
    // Détection iOS (iPhone/iPad/iPod, hors mode standalone)
    const ua = window.navigator.userAgent;
    const iOS = /iphone|ipad|ipod/i.test(ua);
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsIOS(iOS && !standalone);

    // Check if running in standalone mode (already installed)
    if (standalone) {
      setIsInstalled(true);
      return;
    }

    // Check localStorage for dismissed state
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
    }

    // Listen for install prompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    // Listen for successful install
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Gérer l'installation
  const handleInstall = async () => {
    // iOS Safari : pas d'API d'install → afficher la consigne manuelle
    if (!deferredPrompt) {
      if (isIOS) setShowIOSHelp(true);
      return;
    }

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        setIsInstalled(true);
      }

      setDeferredPrompt(null);
      setIsInstallable(false);
    } catch (err) {
      console.error('PWA Install error:', err);
    }
  };

  // Fermer définitivement
  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  // Consigne d'installation iOS (Partager → Sur l'écran d'accueil)
  const iosHelp = showIOSHelp ? (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setShowIOSHelp(false)}>
      <div className="bg-[#15151b] border border-purple-500/30 rounded-2xl p-5 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}>
            <Smartphone size={20} className="text-white" />
          </div>
          <h3 className="text-white font-semibold">Installer sur iPhone / iPad</h3>
        </div>
        <ol className="text-white/70 text-sm space-y-2 list-decimal list-inside">
          <li className="flex items-center gap-2"><span>Appuyez sur</span><Share size={16} className="text-purple-400" /><span>(Partager) dans Safari</span></li>
          <li>Choisissez « Sur l'écran d'accueil »</li>
          <li>Confirmez avec « Ajouter »</li>
        </ol>
        <button onClick={() => setShowIOSHelp(false)} className="mt-4 w-full py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition-colors">
          Compris
        </button>
      </div>
    </div>
  ) : null;

  // Ne pas afficher si installé, fermé, ou (non installable ET pas iOS)
  if (isInstalled || isDismissed || (!isInstallable && !isIOS)) {
    return null;
  }

  // Variante Minimal - Juste un bouton discret
  if (variant === 'minimal') {
    return (
      <>
        <button
          onClick={handleInstall}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-full bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors ${className}`}
          data-testid="pwa-install-btn"
        >
          <Download size={14} />
          <span>Installer</span>
        </button>
        {iosHelp}
      </>
    );
  }

  // Variante Button - Bouton plus visible
  if (variant === 'button') {
    return (
      <>
        <button
          onClick={handleInstall}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium hover:opacity-90 transition-opacity ${className}`}
          data-testid="pwa-install-btn"
        >
          <Smartphone size={18} />
          <span>Installer l'application</span>
        </button>
        {iosHelp}
      </>
    );
  }

  // Variante Banner - Bandeau en bas de page
  return (
    <>
    {iosHelp}
    <div className={`fixed bottom-4 left-4 right-4 mx-auto max-w-md z-50 ${className}`}>
      <div className="bg-[#1a1a2e] border border-purple-500/30 rounded-xl p-4 shadow-2xl shadow-purple-500/10">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div 
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)' }}
          >
            <Smartphone size={24} className="text-white" />
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-medium text-sm">
              Installer Boosttribe
            </h3>
            <p className="text-white/60 text-xs mt-0.5">
              Accédez plus rapidement à vos sessions
            </p>
            
            {/* Actions */}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleInstall}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 transition-colors"
              >
                <Download size={14} />
                Installer
              </button>
              <button
                onClick={handleDismiss}
                className="p-2 rounded-lg text-white/40 hover:text-white/60 hover:bg-white/5 transition-colors"
                aria-label="Fermer"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default PWAInstallPrompt;
