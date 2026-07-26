import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { verifyEmbedToken } from '@/lib/embedApi';

/**
 * 🔗 Page /embed — point d'entrée des abonnés afroboost (affichée DANS une iframe sur afroboost.com).
 * Lit ?bt_token=<JWT signé>, le vérifie côté backend (POST /api/embed/verify), connecte l'utilisateur
 * automatiquement puis le redirige vers le hub des sessions live avec ACCÈS GRATUIT (aucun paiement).
 * Jeton invalide/expiré → message clair « Session expirée, retournez sur afroboost.com ».
 */
type Status = 'verifying' | 'connecting' | 'error';

const EmbedPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<Status>('verifying');
  const [error, setError] = useState<string>('');
  const [verified, setVerified] = useState(false);
  const ranRef = useRef(false);
  const navigatedRef = useRef(false);

  // 1) Vérifier le jeton + connexion automatique (une seule fois).
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const token = new URLSearchParams(window.location.search).get('bt_token') || '';
    if (!token) {
      setStatus('error');
      setError('Lien invalide — aucun jeton fourni. Retournez sur afroboost.com.');
      return;
    }
    (async () => {
      const res = await verifyEmbedToken(token);
      if (!res.ok) {
        setStatus('error');
        setError(res.error || 'Session expirée, retournez sur afroboost.com.');
        return;
      }
      setVerified(true);
      setStatus('connecting');
    })();
  }, []);

  // 2) Une fois vérifié ET la session Supabase établie → hub des sessions live.
  useEffect(() => {
    if (!verified || navigatedRef.current) return;
    if (isAuthenticated) {
      navigatedRef.current = true;
      navigate('/session', { replace: true });
    }
  }, [verified, isAuthenticated, navigate]);

  // 3) Garde-fou : si la connexion n'aboutit pas dans un délai raisonnable, message d'erreur clair.
  useEffect(() => {
    if (!verified) return;
    const t = setTimeout(() => {
      if (!navigatedRef.current) {
        setStatus('error');
        setError('Connexion impossible. Rafraîchissez depuis afroboost.com.');
      }
    }, 8000);
    return () => clearTimeout(t);
  }, [verified]);

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: '#000000', color: '#FFFFFF' }}
    >
      <div className="flex flex-col items-center gap-5 text-center max-w-sm">
        {status === 'error' ? (
          <>
            <div className="text-3xl">⏳</div>
            <h1 className="text-lg font-semibold">Accès indisponible</h1>
            <p className="text-white/60 text-sm">{error}</p>
          </>
        ) : (
          <>
            <div
              className="w-10 h-10 border-2 rounded-full animate-spin"
              style={{ borderColor: 'var(--bt-accent, #7A5CFF)', borderTopColor: 'transparent' }}
            />
            <p className="text-white/70 text-sm">
              {status === 'verifying' ? 'Vérification de votre accès…' : 'Connexion à BoostTribe…'}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default EmbedPage;
