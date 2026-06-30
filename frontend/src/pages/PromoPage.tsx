import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Ticket, ArrowRight, PlayCircle } from 'lucide-react';
import { getPromo, type PromoConfig } from '@/lib/paymentApi';
import { videoEmbedUrl, isHttpUrl } from '@/lib/videoEmbed';

// 🎨 Couleurs Afroboost
const AFRO = {
  magenta: '#D91CD2',
  pink: '#FF2DAA',
  gradient: 'linear-gradient(135deg, #D91CD2 0%, #FF2DAA 100%)',
};

/**
 * 📣 Page PROMO / affiche de session — PUBLIQUE et partageable (Instagram, etc.).
 * Affiche (image) OU vidéo 9:16 + description + CTA :
 *   - lien de paiement du coach → bouton « Payer [prix] » (le coach encaisse lui-même)
 *   - OU gratuite → bouton « Rejoindre gratuitement » (entre dans la session)
 */
const PromoPage: React.FC = () => {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [promo, setPromo] = useState<PromoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { promo: p, error: e } = await getPromo(sessionId);
      if (cancelled) return;
      // 🔁 Point d'entrée TRANSPARENT : si aucune page promo n'est publiée pour cette session,
      //    on entre directement dans la session (le participant ne voit pas de page « indisponible »).
      if (!p || !p.enabled) { navigate(`/session/${encodeURIComponent(sessionId)}`, { replace: true }); return; }
      setPromo(p);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId, navigate]);

  // 🔒 Sécurité : on n'accepte QUE des liens http(s) (bloque javascript:/data: → XSS au clic).
  const safePaymentLink = (() => {
    const raw = promo?.payment_link?.trim();
    if (!raw) return null;
    try {
      const u = new URL(raw);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
    } catch { return null; }
  })();
  const isPaid = !!safePaymentLink;

  const handleCta = () => {
    if (isPaid) {
      // Lien de paiement du coach (Stripe Payment Link / Twint / etc.) — il encaisse lui-même.
      window.location.href = safePaymentLink!;
    } else {
      navigate(`/session/${encodeURIComponent(sessionId)}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8" style={{ background: '#0A0A0F', fontFamily: "'Inter', sans-serif" }}>
      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: AFRO.pink }} />
      ) : error || !promo || promo.enabled === false ? (
        <div className="text-center text-white/70 max-w-sm">
          <p className="text-lg font-semibold text-white mb-2">Page indisponible</p>
          <p className="text-sm">{error || "Cette page promo n'est pas (encore) publiée."}</p>
          <button onClick={() => navigate('/')} className="mt-5 px-5 py-2 rounded-full text-white text-sm font-medium" style={{ background: AFRO.gradient }}>
            Accueil
          </button>
        </div>
      ) : (
        <div className="w-full max-w-sm flex flex-col items-center gap-5">
          {/* Affiche / vidéo au format choisi par le coach (9:16 ou 16:9) */}
          <div className="w-full rounded-3xl overflow-hidden border border-white/10 shadow-2xl bg-black"
               style={{ aspectRatio: promo.format === '16:9' ? '16 / 9' : '9 / 16', maxHeight: '70vh' }}>
            {promo.media_url && promo.media_type === 'video' ? (
              videoEmbedUrl(promo.media_url) ? (
                <iframe src={videoEmbedUrl(promo.media_url)!} title="Vidéo de la session" className="w-full h-full"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
              ) : (
                <a href={isHttpUrl(promo.media_url) ? promo.media_url : undefined} target="_blank" rel="noopener noreferrer"
                   className="w-full h-full flex flex-col items-center justify-center gap-2 text-white" style={{ background: AFRO.gradient }}>
                  <PlayCircle className="w-16 h-16" /><span className="text-sm font-semibold">Voir la vidéo</span>
                </a>
              )
            ) : promo.media_url && promo.media_type === 'image' ? (
              <img src={promo.media_url} alt="Affiche de la session" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: AFRO.gradient }}>
                <Ticket className="w-16 h-16 text-white/80" />
              </div>
            )}
          </div>

          {/* Description */}
          {promo.description && (
            <p className="text-white/85 text-center text-sm sm:text-base whitespace-pre-wrap leading-relaxed">{promo.description}</p>
          )}

          {/* CTA */}
          <button
            onClick={handleCta}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-white font-bold text-base shadow-lg transition-transform hover:scale-[1.02] active:scale-95"
            style={{ background: AFRO.gradient }}
            data-testid="promo-cta"
          >
            {isPaid
              ? <>{promo.cta_text || 'Payer'}{promo.price ? ` ${promo.price}` : ''}</>
              : <>{promo.cta_text || 'Rejoindre gratuitement'}</>}
            <ArrowRight className="w-5 h-5" />
          </button>

          <p className="text-white/30 text-xs text-center">Propulsé par Boosttribe</p>
        </div>
      )}
    </div>
  );
};

export default PromoPage;
