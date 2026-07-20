import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { LogOut, User, Settings, Menu, X, Home, Sparkles, Tag, Camera, Wallet, Crown } from 'lucide-react';
import { ProfilePhotoModal } from '@/components/profile/ProfilePhotoEditor';
import { sessionExists } from '@/lib/supabaseClient';
import { getMyLastSession } from '@/lib/paymentApi';

/**
 * 📱 MobileMenu — LE menu hamburger réutilisable du site (un seul composant, utilisé partout :
 * pages marketing via le Header ET la console admin/CMS). Mobile uniquement (md:hidden).
 *
 * `dropdownTopClass` positionne le panneau déroulant sous la barre du conteneur
 * (Header : h-16 sm:h-20 → "top-16 sm:top-20" ; barre admin : h-16 → "top-16").
 */
interface MobileMenuProps {
  dropdownTopClass?: string;
}

export const MobileMenu: React.FC<MobileMenuProps> = ({ dropdownTopClass = 'top-16 sm:top-20' }) => {
  const { theme } = useTheme();
  const { colors, buttons } = theme;
  const { isAuthenticated, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const go = (path: string, state?: Record<string, unknown>) => {
    setOpen(false);
    navigate(path, state ? { state } : undefined);
  };

  return (
    <div ref={ref} className="md:hidden flex items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-lg text-white/80 hover:bg-white/10 transition-colors"
        aria-label="Menu"
        aria-expanded={open}
        data-testid="mobile-menu-toggle"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>

      {open && (
        <div
          className={`fixed left-0 right-0 ${dropdownTopClass} z-50 border-t border-white/10 px-4 py-3 max-h-[calc(100vh-4rem)] overflow-y-auto`}
          style={{ background: 'rgba(8,8,12,0.98)', backdropFilter: 'blur(20px)' }}
          data-testid="mobile-menu"
        >
          <nav className="flex flex-col gap-1 max-w-7xl mx-auto">
            <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-3 px-3 py-3 rounded-lg text-white/80 hover:bg-white/10">
              <Home size={18} /> Accueil
            </Link>
            <Link to="/features" onClick={() => setOpen(false)} className="flex items-center gap-3 px-3 py-3 rounded-lg text-white/80 hover:bg-white/10">
              <Sparkles size={18} /> Fonctionnalités
            </Link>
            <Link to="/pricing" onClick={() => setOpen(false)} className="flex items-center gap-3 px-3 py-3 rounded-lg text-white/80 hover:bg-white/10">
              <Tag size={18} /> Tarifs
            </Link>
            {/* 💎 Point d'entrée VISIBLE vers l'espace coach / abonnement */}
            <Link to="/wallet" onClick={() => setOpen(false)} className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/10" style={{ color: 'var(--bt-accent-2)' }}>
              <Crown size={18} /> {isAuthenticated ? 'Espace Coach' : 'Devenir Coach'}
            </Link>
            {isAuthenticated && (
              <Link to="/wallet" onClick={() => setOpen(false)} className="flex items-center gap-3 px-3 py-3 rounded-lg text-white/80 hover:bg-white/10">
                <Wallet size={18} /> Portefeuille
              </Link>
            )}
            {!isAuthenticated && (
              <button onClick={() => go('/login')} className="flex items-center gap-3 px-3 py-3 rounded-lg text-white/80 hover:bg-white/10 text-left">
                <User size={18} /> {buttons.login}
              </button>
            )}
            {/* 📷 Photo de profil modifiable (utilisateur connecté) — sur mobile aussi.
                On ferme le menu PUIS on ouvre le modal (rendu au niveau racine → survit à la fermeture). */}
            {isAuthenticated && (
              <button
                type="button"
                onClick={() => { setOpen(false); setPhotoOpen(true); }}
                className="flex w-full items-center gap-3 px-3 py-3 rounded-lg text-white/80 hover:bg-white/10 text-left"
                data-testid="profile-photo-menu-edit"
              >
                <Camera size={18} /> Modifier la photo
              </button>
            )}
            {isAdmin && (
              <button onClick={() => go('/admin')} className="flex items-center gap-3 px-3 py-3 rounded-lg text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.1)] text-left">
                <Settings size={18} /> Gestion Site
              </button>
            )}
            {isAuthenticated && (
              <button
                onClick={async () => { setOpen(false); try { await signOut(); } catch { /* ignore */ } navigate('/'); }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg text-white/70 hover:bg-white/10 text-left"
              >
                <LogOut size={18} /> Déconnexion
              </button>
            )}
            <button
              onClick={async () => {
                if (!isAuthenticated) { go('/login', { from: '/session' }); return; }
                // « Ma session » : reprendre la dernière session (DB host_id), repli localStorage, sinon créer.
                const { sessionId } = await getMyLastSession();
                if (sessionId) { go(`/session/${sessionId}`); return; }
                let last: string | null = null;
                try { last = localStorage.getItem('bt_last_session_code'); } catch { /* ignore */ }
                if (last) {
                  const exists = await sessionExists(last);
                  if (exists !== false) { go(`/session/${last}`); return; }
                  try { localStorage.removeItem('bt_last_session_code'); } catch { /* ignore */ }
                }
                go('/session');
              }}
              className="mt-2 w-full px-4 py-3 rounded-xl text-white font-semibold text-center whitespace-nowrap"
              style={{ background: colors.gradient.primary }}
            >
              {isAuthenticated ? 'Ma session' : buttons.start}
            </button>
          </nav>
        </div>
      )}

      {/* Modal photo de profil — rendu hors du panneau déroulant (porté vers body) pour
          survivre à la fermeture du menu et s'afficher en plein écran sans clipping. */}
      <ProfilePhotoModal open={photoOpen} onClose={() => setPhotoOpen(false)} />
    </div>
  );
};

export default MobileMenu;
