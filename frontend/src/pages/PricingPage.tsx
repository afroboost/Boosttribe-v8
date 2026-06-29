import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Footer } from '@/components/layout/Footer';
import { MobileMenu } from '@/components/layout/MobileMenu';
import { useToast } from '@/components/ui/Toast';
import { getCreditsConfig, buyCredits, type CreditsConfig, type CreditPack } from '@/lib/paymentApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Check, ArrowLeft, Sparkles, Coins, Gift, Users, Mic2, Clock, Star, Loader2,
} from 'lucide-react';

// 🎨 Couleurs Afroboost
const AFRO = {
  magenta: '#D91CD2',
  pink: '#FF2DAA',
  dark: '#0A0A0F',
  white: '#FFFFFF',
  gradient: 'linear-gradient(135deg, #D91CD2 0%, #FF2DAA 100%)',
};

// Libellés des services configurables (pricing_settings.services_shown)
const SERVICE_LABELS: Record<string, string> = {
  live: 'Lives audio synchronisés',
  visio: 'Live Visio (caméras façon Zoom)',
  stage: 'Scène / co-animation',
  chat: 'Chat en direct',
};

const PricingPage: React.FC = () => {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const {
    isAuthenticated,
    credits,
    isAdmin,
    hasAcceptedTerms,
    acceptTerms,
    refreshCredits,
  } = useAuth();
  const { showToast } = useToast();

  const [config, setConfig] = useState<CreditsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyingPackId, setBuyingPackId] = useState<number | null>(null);

  const [termsChecked, setTermsChecked] = useState(hasAcceptedTerms);
  const [isAccepting, setIsAccepting] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [pendingPack, setPendingPack] = useState<CreditPack | null>(null);

  // Charge la config publique (packs + offres + réglages) — tout est éditable en admin.
  const loadConfig = useCallback(async () => {
    setLoading(true);
    const { data } = await getCreditsConfig();
    if (data) setConfig(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // Retour de paiement Stripe (?success=1 / ?canceled=1)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === '1') {
      showToast('Paiement validé ! Tes crédits arrivent 🎉', 'success');
      refreshCredits();
      setTimeout(() => refreshCredits(), 3000);
      window.history.replaceState({}, '', '/pricing');
    } else if (params.get('canceled') === '1') {
      showToast('Paiement annulé', 'default');
      window.history.replaceState({}, '', '/pricing');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAcceptTerms = async () => {
    if (termsChecked && !hasAcceptedTerms) {
      setIsAccepting(true);
      await acceptTerms();
      setIsAccepting(false);
    }
  };

  const startCheckout = useCallback(async (pack: CreditPack) => {
    setBuyingPackId(pack.id);
    try {
      const { url, error } = await buyCredits(pack.id);
      if (url) window.location.href = url;
      else showToast(error || 'Impossible de démarrer le paiement', 'error');
    } finally {
      setBuyingPackId(null);
    }
  }, [showToast]);

  const handleBuy = async (pack: CreditPack) => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: '/pricing' } });
      return;
    }
    if (!hasAcceptedTerms && !termsChecked) {
      setPendingPack(pack);
      setShowTermsModal(true);
      return;
    }
    if (termsChecked && !hasAcceptedTerms) await handleAcceptTerms();
    await startCheckout(pack);
  };

  const packs = config?.packs || [];
  const participantPacks = packs.filter((p) => p.audience === 'participant');
  const creatorPacks = packs.filter((p) => p.audience === 'creator');
  const offers = config?.offers || {};
  const validityMonths = config?.credit_validity_months ?? 12;
  const services = config?.services_shown || [];

  // Offres actives à mettre en avant (toggle admin via pricing_settings.offers[key].enabled)
  const activeOffers = Object.entries(offers)
    .filter(([, o]: [string, any]) => o && o.enabled)
    .map(([key, o]: [string, any]) => ({ key, ...o }));

  const offerIcon = (key: string) => {
    switch (key) {
      case 'first_free': return <Gift className="w-5 h-5" />;
      case 'discovery': return <Sparkles className="w-5 h-5" />;
      case 'validity': return <Clock className="w-5 h-5" />;
      case 'referral': return <Users className="w-5 h-5" />;
      case 'gift': return <Gift className="w-5 h-5" />;
      case 'launch': return <Star className="w-5 h-5" />;
      default: return <Sparkles className="w-5 h-5" />;
    }
  };

  const renderPack = (pack: CreditPack) => {
    const busy = buyingPackId === pack.id;
    const perCredit = pack.credits > 0 ? (pack.price_chf / pack.credits) : pack.price_chf;
    return (
      <Card
        key={pack.id}
        className={`relative border-white/10 bg-white/5 backdrop-blur-sm transition-all hover:border-white/20 ${
          pack.is_highlighted ? 'ring-2 scale-105' : ''
        }`}
        style={pack.is_highlighted ? { borderColor: AFRO.magenta } : {}}
      >
        {pack.is_highlighted && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge className="px-3 py-1 text-white border-0" style={{ background: AFRO.gradient }}>
              Plus populaire
            </Badge>
          </div>
        )}

        <CardHeader className="text-center pb-2">
          <div
            className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: pack.is_highlighted ? AFRO.gradient : 'rgba(255,255,255,0.1)' }}
          >
            <Coins className="w-6 h-6 text-white" />
          </div>
          <CardTitle className="text-white">{pack.name}</CardTitle>
          <CardDescription className="text-white/50">
            {pack.credits} crédit{pack.credits > 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>

        <CardContent className="text-center">
          <div className="mb-2">
            <span className="text-4xl font-bold text-white">{pack.price_chf.toFixed(2)}</span>
            <span className="text-white/50 text-sm ml-1">CHF</span>
          </div>
          <p className="text-white/40 text-xs mb-6">
            {perCredit.toFixed(2)} CHF / crédit · valable {validityMonths} mois
          </p>

          <ul className="space-y-3 mb-6 text-left">
            <li className="flex items-center gap-2 text-white/70 text-sm">
              <Check size={16} style={{ color: AFRO.pink }} className="flex-shrink-0" />
              {pack.credits} accès à un live ({pack.audience === 'creator' ? 'animer' : 'rejoindre'})
            </li>
            <li className="flex items-center gap-2 text-white/70 text-sm">
              <Check size={16} style={{ color: AFRO.pink }} className="flex-shrink-0" />
              Crédits valables {validityMonths} mois
            </li>
            <li className="flex items-center gap-2 text-white/70 text-sm">
              <Check size={16} style={{ color: AFRO.pink }} className="flex-shrink-0" />
              Sans abonnement, sans engagement
            </li>
          </ul>

          <Button
            onClick={() => handleBuy(pack)}
            disabled={busy}
            className="w-full text-white border-0"
            style={pack.is_highlighted ? { background: AFRO.gradient } : { background: 'rgba(255,255,255,0.12)' }}
          >
            {busy ? (
              <><Loader2 size={16} className="mr-2 animate-spin" /> Redirection…</>
            ) : (
              <>Acheter des crédits</>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen py-12 px-4" style={{ background: AFRO.dark }}>
      <div className="max-w-6xl mx-auto mb-10">
        <div className="flex items-center justify-between gap-2 mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors">
            <ArrowLeft size={20} />
            Retour à l'accueil
          </Link>
          {/* 📱 Menu hamburger réutilisé (mobile) */}
          <MobileMenu dropdownTopClass="top-0" />
        </div>

        <div className="text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4" style={{ fontFamily: theme.fonts.heading }}>
            Achète des crédits
          </h1>
          <p className="text-white/60 text-lg max-w-2xl mx-auto mb-6">
            <span className="font-semibold text-white">1 crédit = 1 accès à un live.</span>{' '}
            Pas d'abonnement : tu paies uniquement ce que tu utilises, et tes crédits restent valables {validityMonths} mois.
          </p>

          {/* Solde courant */}
          {isAuthenticated && !isAdmin && (
            <Badge className="px-4 py-2 text-white border-0" style={{ background: AFRO.gradient }}>
              <Coins size={16} className="mr-2" />
              {credits} crédit{credits > 1 ? 's' : ''} disponible{credits > 1 ? 's' : ''}
            </Badge>
          )}
          {isAdmin && (
            <Badge className="px-4 py-2 bg-white/10 text-white border-white/20">
              Mode admin — accès illimité
            </Badge>
          )}
        </div>
      </div>

      {/* Offres mises en avant (configurables en admin) */}
      {activeOffers.length > 0 && (
        <div className="max-w-5xl mx-auto mb-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeOffers.map((o) => (
            <div key={o.key} className="flex items-start gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white"
                   style={{ background: AFRO.gradient }}>
                {offerIcon(o.key)}
              </div>
              <div>
                <div className="text-white font-semibold text-sm">
                  {o.title}{o.key === 'launch' && o.percent ? ` (+${o.percent}%)` : ''}
                </div>
                <div className="text-white/50 text-xs">{o.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-white/50" />
        </div>
      ) : (
        <>
          {/* Packs pour participer */}
          {participantPacks.length > 0 && (
            <div className="max-w-5xl mx-auto mb-12">
              <h2 className="text-2xl font-bold text-white mb-1 text-center">Pour participer</h2>
              <p className="text-white/50 text-center mb-6 text-sm">Rejoins les lives qui t'intéressent.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {participantPacks.map(renderPack)}
              </div>
            </div>
          )}

          {/* Packs pour animer */}
          {creatorPacks.length > 0 && (
            <div className="max-w-5xl mx-auto mb-12">
              <h2 className="text-2xl font-bold text-white mb-1 text-center flex items-center justify-center gap-2">
                <Mic2 size={22} style={{ color: AFRO.pink }} /> Pour animer
              </h2>
              <p className="text-white/50 text-center mb-6 text-sm">Crée et héberge tes propres lives.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {creatorPacks.map(renderPack)}
              </div>
            </div>
          )}

          {packs.length === 0 && (
            <p className="text-center text-white/50 py-12">Aucun pack disponible pour le moment.</p>
          )}
        </>
      )}

      {/* Services inclus (configurables en admin) */}
      {services.length > 0 && (
        <div className="max-w-3xl mx-auto mt-4 mb-8">
          <h3 className="text-white/80 text-center font-semibold mb-4">Ce que tu débloques avec tes crédits</h3>
          <div className="flex flex-wrap justify-center gap-3">
            {services.map((s) => (
              <span key={s} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/70 text-sm">
                <Check size={14} style={{ color: AFRO.pink }} />
                {SERVICE_LABELS[s] || s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* CGU Modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1f] border border-white/10 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-white/10">
              <h2 className="text-xl font-bold text-white">Conditions Générales d'Utilisation</h2>
            </div>
            <div className="p-6 overflow-y-auto max-h-[50vh] text-white/70 text-sm space-y-4">
              <h3 className="text-white font-semibold">1. Acceptation des conditions</h3>
              <p>En utilisant BoostTribe, vous acceptez les présentes conditions générales d'utilisation.</p>
              <h3 className="text-white font-semibold">2. Crédits</h3>
              <p>BoostTribe fonctionne avec des crédits : 1 crédit donne accès à un live (rejoindre ou animer). Les crédits achetés sont valables {validityMonths} mois.</p>
              <h3 className="text-white font-semibold">3. Paiements</h3>
              <p>Les achats de crédits sont des paiements uniques traités de manière sécurisée via Stripe, en CHF.</p>
              <h3 className="text-white font-semibold">4. Propriété intellectuelle</h3>
              <p>Les utilisateurs sont responsables des contenus qu'ils partagent et doivent disposer des droits nécessaires.</p>
              <h3 className="text-white font-semibold">5. Protection des données</h3>
              <p>Nous collectons uniquement les données nécessaires au fonctionnement du service.</p>
            </div>
            {/* Barre d'actions responsive : case sur sa propre ligne, boutons empilés en mobile
                (pleine largeur) et côte à côte en desktop — tout reste visible et cliquable. */}
            <div className="p-4 sm:p-6 border-t border-white/10 space-y-4">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsChecked}
                  onChange={(e) => setTermsChecked(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-white/30 bg-transparent flex-shrink-0"
                />
                <span className="text-white/80 text-sm">J'ai lu et j'accepte les CGU</span>
              </label>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
                <Button variant="outline" onClick={() => setShowTermsModal(false)} className="w-full sm:w-auto border-white/20 text-white/70">
                  Fermer
                </Button>
                <Button
                  onClick={async () => {
                    if (!termsChecked) return;
                    await handleAcceptTerms();
                    setShowTermsModal(false);
                    if (pendingPack) { const p = pendingPack; setPendingPack(null); await startCheckout(p); }
                  }}
                  disabled={!termsChecked || isAccepting}
                  className="w-full sm:w-auto text-white border-0"
                  style={{ background: AFRO.gradient }}
                >
                  {isAccepting ? 'Enregistrement…' : 'Accepter et continuer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
};

export default PricingPage;
