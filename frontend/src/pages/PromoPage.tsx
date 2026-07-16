import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Ticket, ArrowRight, Play, X } from 'lucide-react';
import { getPromo, getVideoThumbnail, requestSessionAccess, getAccessRequestStatus, type PromoConfig } from '@/lib/paymentApi';
import { isHttpUrl, videoEmbedUrl } from '@/lib/videoEmbed';

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
  const [ctaError, setCtaError] = useState<string | null>(null);
  const [videoThumb, setVideoThumb] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false); // 🎬 lecteur intégré (modale), AUCUNE redirection
  // B) Demander l'accès (session payante, abonné)
  const [reqName, setReqName] = useState('');
  const [reqAsking, setReqAsking] = useState(false);  // formulaire nom ouvert
  const [reqSent, setReqSent] = useState(false);
  const [reqBusy, setReqBusy] = useState(false);
  const [reqId, setReqId] = useState<number | null>(null);   // id de la demande → suivi du statut (poll)
  const [reqRefused, setReqRefused] = useState(false);        // l'hôte a refusé

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
      // Miniature PROPRE de la vidéo (image seule, sans carte plateforme).
      if (p.media_type === 'video' && p.media_url) {
        const { thumbnail_url } = await getVideoThumbnail(p.media_url);
        if (!cancelled) setVideoThumb(thumbnail_url);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, navigate]);

  // 🔁 SUIVI DE LA DEMANDE D'ACCÈS (demandeur ANONYME inclus) : dès qu'une demande est envoyée,
  //    on interroge son statut toutes les ~3 s via l'endpoint PUBLIC (par id). À l'approbation de l'hôte,
  //    on ADMET AUTOMATIQUEMENT le participant → entrée en session avec ?ar=<id> (+ localStorage) qui
  //    prouve l'accès approuvé même sans compte. Nettoyage complet au démontage.
  useEffect(() => {
    if (!reqId) return;
    let cancelled = false;
    const poll = async () => {
      const { status } = await getAccessRequestStatus(reqId);
      if (cancelled) return;
      if (status === 'approved') {
        try { localStorage.setItem(`bt_ar_${sessionId}`, String(reqId)); } catch { /* ignore */ }
        navigate(`/session/${encodeURIComponent(sessionId)}?ar=${reqId}`);
      } else if (status === 'refused') {
        setReqRefused(true);
      }
    };
    poll();
    const t = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [reqId, sessionId, navigate]);

  // 💳 Flux PAIEMENT totalement SÉPARÉ du code de session : si le coach a configuré un lien de paiement,
  //    le bouton OUVRE CE LIEN (nouvel onglet) — jamais la validation de session (= « code inconnu »).
  const rawPaymentLink = (promo?.payment_link || '').trim();
  const paidIntent = !!rawPaymentLink;

  const handleCta = () => {
    if (paidIntent) {
      console.log('[PROMO] CTA paiement → lien lu depuis la promo enregistrée :', rawPaymentLink);
      if (isHttpUrl(rawPaymentLink)) {
        window.open(rawPaymentLink, '_blank', 'noopener,noreferrer'); // lien externe coach (Twint/Stripe)
      } else {
        setCtaError("Le lien de paiement configuré est invalide (il doit commencer par https://).");
      }
      return; // ⛔ on NE rejoint JAMAIS la session par code dans le flux payant.
    }
    navigate(`/session/${encodeURIComponent(sessionId)}`); // gratuite → rejoindre la session
  };
  const isPaid = paidIntent;
  // 🚪 PARTIE 4 — Mode « sans inscription » (guest) : le participant ENTRE directement (pseudo, sans
  //    compte ni demande d'accès). Le mode guest prime sur le paiement/la demande d'accès.
  const isGuest = promo?.access_mode === 'guest';
  const enterSession = () => navigate(`/session/${encodeURIComponent(sessionId)}`);
  // 🎬 Clic miniature → LECTEUR INTÉGRÉ en modale (aucune redirection externe).
  const embedSrc = promo?.media_url ? videoEmbedUrl(promo.media_url) : null;
  const openVideo = () => setVideoOpen(true);

  // B) Demander l'accès gratuit (au lieu de payer) — envoie une demande à l'hôte (temps réel).
  const submitAccessRequest = async () => {
    const name = reqName.trim();
    if (!name) return;
    setReqBusy(true);
    const { ok, id, error } = await requestSessionAccess(sessionId, name);
    setReqBusy(false);
    if (ok) { setReqSent(true); setReqAsking(false); setReqRefused(false); if (id) setReqId(id); }
    else setCtaError(error || "Échec de l'envoi de la demande");
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
              // 🎬 MINIATURE PROPRE uniquement (image seule) + bouton play centré. Aucun « chrome » plateforme.
              <button onClick={openVideo} className="group relative w-full h-full block" aria-label="Voir la vidéo">
                {videoThumb ? (
                  <img src={videoThumb} alt="Aperçu de la vidéo" className="w-full h-full object-cover" />
                ) : (
                  // Vignette neutre Afroboost si la miniature est introuvable (jamais la carte Instagram).
                  <div className="w-full h-full" style={{ background: AFRO.gradient }} />
                )}
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="w-16 h-16 rounded-full bg-black/55 group-hover:bg-black/70 flex items-center justify-center backdrop-blur-sm transition-colors">
                    <Play className="w-8 h-8 text-white ml-1" fill="currentColor" />
                  </span>
                </span>
              </button>
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

          {/* CTA : (guest) Entrer · sinon Payer + (option) Demander l'accès */}
          <div className="w-full flex flex-col gap-2">
            {isGuest ? (
              // 🚪 Sans inscription : entrée DIRECTE par pseudo (aucun paiement, aucune demande).
              <button
                onClick={enterSession}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-white font-bold text-base shadow-lg transition-transform hover:scale-[1.02] active:scale-95"
                style={{ background: AFRO.gradient }}
                data-testid="promo-enter"
              >
                {promo.cta_text || 'Entrer'}
                <ArrowRight className="w-5 h-5" />
              </button>
            ) : (
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
            )}

            {/* 🙋 Demander l'accès (session payante + option activée par le coach ; jamais en mode guest) */}
            {!isGuest && isPaid && promo.allow_access_requests && (
              reqSent ? (
                <p className="text-center text-sm text-white/80 bg-white/5 border border-white/10 rounded-xl py-2.5 px-3" data-testid="promo-request-status">
                  {reqRefused
                    ? "Demande refusée par l'hôte."
                    : 'Demande envoyée, en attente de validation…'}
                </p>
              ) : reqAsking ? (
                <div className="flex items-center gap-2">
                  <input value={reqName} onChange={(e) => setReqName(e.target.value)} placeholder="Votre nom"
                    className="flex-1 px-3 py-2.5 rounded-xl bg-black/30 border border-white/15 text-white text-sm placeholder:text-white/30" autoFocus />
                  <button onClick={submitAccessRequest} disabled={reqBusy || !reqName.trim()}
                    className="px-4 py-2.5 rounded-xl text-white text-sm font-semibold border border-[#7A5CFF]/50 bg-[#7A5CFF]/20 hover:bg-[#7A5CFF]/30 disabled:opacity-50">
                    {reqBusy ? '…' : 'Envoyer'}
                  </button>
                </div>
              ) : (
                <button onClick={() => setReqAsking(true)}
                  className="w-full py-2.5 rounded-2xl text-white/85 text-sm font-medium border border-white/20 hover:bg-white/10"
                  data-testid="promo-request-access">
                  Demander l'accès (sans payer)
                </button>
              )
            )}
          </div>
          {ctaError && <p className="text-red-300 text-xs text-center -mt-1">{ctaError}</p>}

          <p className="text-white/30 text-xs text-center">Propulsé par Boosttribe</p>
        </div>
      )}

      {/* 🎬 LECTEUR INTÉGRÉ (modale) — lit la vidéo SUR PLACE, aucune redirection externe. */}
      {videoOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm p-3" onClick={() => setVideoOpen(false)}>
          <button onClick={() => setVideoOpen(false)} className="absolute top-3 right-3 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: promo?.format === '16:9' ? '16 / 9' : '9 / 16', maxHeight: '85vh' }} onClick={(e) => e.stopPropagation()}>
            {embedSrc ? (
              <iframe src={embedSrc} title="Vidéo de la session" className="w-full h-full"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                // 🔒 ZÉRO REDIRECTION : sans sandbox, un embed tiers (Instagram/TikTok/FB) peut naviguer
                //   la fenêtre PARENTE (window.top) ou ouvrir un onglet au clic « play » → c'est la
                //   « redirection » constatée. On autorise scripts + same-origin + présentation (lecture
                //   in-page, plein écran) mais PAS allow-top-navigation ni allow-popups → impossible de
                //   quitter la page. La lecture reste dans la modale.
                sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
                referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-center text-white/70 text-sm p-4">
                Lecture intégrée indisponible pour ce lien.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PromoPage;
