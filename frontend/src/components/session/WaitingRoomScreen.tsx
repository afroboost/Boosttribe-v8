import React from 'react';
import { Loader2, ShieldCheck, XCircle, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

interface WaitingRoomScreenProps {
  name: string;
  photoUrl?: string | null;
  refused?: boolean;
  checking?: boolean; // vérification de la confidentialité en cours (pas encore "en attente")
}

// Écran "Salle d'attente" affiché au participant d'une session privée tant qu'il n'est pas admis.
export const WaitingRoomScreen: React.FC<WaitingRoomScreenProps> = ({ name, photoUrl, refused, checking }) => {
  const initials = (name || '?').slice(0, 2).toUpperCase();
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0a0a0f' }}>
      {/* halos décoratifs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 rounded-full opacity-20 blur-3xl" style={{ background: 'radial-gradient(circle, #8A2EFF 0%, transparent 70%)' }} />
        <div className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full opacity-15 blur-3xl" style={{ background: 'radial-gradient(circle, #FF2FB3 0%, transparent 70%)' }} />
      </div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[rgba(20,20,25,0.9)] backdrop-blur-xl p-8 text-center">
        {/* Avatar */}
        <div className="w-20 h-20 mx-auto mb-5 rounded-full overflow-hidden flex items-center justify-center ring-2 ring-[#8A2EFF]/40"
          style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}>
          {photoUrl ? (
            <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-white text-2xl font-bold">{initials}</span>
          )}
        </div>

        {refused ? (
          <>
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <h1 className="text-xl font-bold text-white mb-2">Accès refusé par l'hôte</h1>
            <p className="text-white/60 text-sm mb-6">L'hôte n'a pas validé votre demande d'accès à cette session privée.</p>
            <Link to="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 text-sm">
              <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
            </Link>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className="flex items-center gap-1.5 text-[#c9a3ff] text-xs px-2.5 py-1 rounded-full bg-[#8A2EFF]/15 border border-[#8A2EFF]/30">
                <ShieldCheck className="w-3.5 h-3.5" /> Session privée
              </span>
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Salle d'attente</h1>
            <p className="text-white/70 text-sm">
              {checking ? 'Vérification de la session…' : "En attente d'admission par l'hôte"}
            </p>
            <p className="text-white/40 text-xs mt-2 mb-6">
              {checking ? 'Un instant…' : "Votre demande a été envoyée. Vous entrerez automatiquement dès que l'hôte vous admet."}
            </p>
            <div className="flex items-center justify-center gap-2 text-[#8A2EFF]">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <p className="text-white/50 text-sm mt-4 truncate">Bonjour <span className="text-white font-medium">{name}</span> 👋</p>
          </>
        )}
      </div>
    </div>
  );
};

export default WaitingRoomScreen;
