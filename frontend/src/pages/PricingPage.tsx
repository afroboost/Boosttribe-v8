import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Footer } from '@/components/layout/Footer';
import { MobileMenu } from '@/components/layout/MobileMenu';
import { useToast } from '@/components/ui/Toast';
import { getCreditsConfig, buyCredits, getBilletterieConfig, createCheckout, type CreditsConfig, type CreditPack } from '@/lib/paymentApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Check, ArrowLeft, Sparkles, Coins, Gift, Users, Mic2, Clock, Star, Loader2, FileText, CreditCard,
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
  // 💎 Prix de l'abonnement coach (lu depuis la config admin, exposé publiquement).
  const [coachSubPrice, setCoachSubPrice] = useState<number>(99.99);

  const [termsChecked, setTermsChecked] = useState(hasAcceptedTerms);
  const [isAccepting, setIsAccepting] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showFullTerms, setShowFullTerms] = useState(false); // texte complet CGU replié par défaut (déplié via le lien « CGU »)
  const [pendingPack, setPendingPack] = useState<CreditPack | null>(null);
  // 💳 Abonnements (offres Utilisateur/Coach) : intervalle + état de redirection + action en attente de consentement.
  const [billing, setBilling] = useState<'month' | 'year'>('month');
  const [subscribingPlan, setSubscribingPlan] = useState<'pro' | 'enterprise' | null>(null);
  const [pendingPlan, setPendingPlan] = useState<'pro' | 'enterprise' | null>(null);

  // Charge la config publique (packs + offres + réglages) — tout est éditable en admin.
  const loadConfig = useCallback(async () => {
    setLoading(true);
    const { data } = await getCreditsConfig();
    if (data) setConfig(data);
    const bill = await getBilletterieConfig();
    if (bill.data?.coach_sub_price_chf) setCoachSubPrice(bill.data.coach_sub_price_chf);
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

  // 💳 Abonnement (offre Utilisateur=pro / Coach=enterprise) → Checkout Stripe avec essai + carte.
  const startSubscribe = useCallback(async (plan: 'pro' | 'enterprise') => {
    setSubscribingPlan(plan);
    try {
      const { url, error } = await createCheckout(plan, billing);
      if (url) window.location.href = url;
      else showToast(error || 'Impossible de démarrer l\'abonnement', 'error');
    } finally {
      setSubscribingPlan(null);
    }
  }, [billing, showToast]);

  const handleSubscribe = async (plan: 'pro' | 'enterprise') => {
    if (!isAuthenticated) {
      // 🔁 Mémoriser l'offre choisie + l'intervalle, puis aller à l'INSCRIPTION → reprise auto au retour.
      try { localStorage.setItem('bt_pending_subscribe', JSON.stringify({ plan, billing, ts: Date.now() })); } catch { /* ignore */ }
      navigate('/login', { state: { from: '/pricing', mode: 'signup' } });
      return;
    }
    if (!hasAcceptedTerms && !termsChecked) {
      setPendingPlan(plan);
      setShowTermsModal(true);
      return;
    }
    if (termsChecked && !hasAcceptedTerms) await handleAcceptTerms();
    await startSubscribe(plan);
  };

  // 🔁 Reprise AUTO du checkout après inscription/connexion : on relance l'offre mémorisée dès que
  //    l'utilisateur est authentifié (la gestion des CGU existante est conservée via handleSubscribe).
  const [resumePlan, setResumePlan] = useState<'pro' | 'enterprise' | null>(null);
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || resumedRef.current) return;
    let pending: { plan?: 'pro' | 'enterprise'; billing?: 'month' | 'year'; ts?: number } | null = null;
    try {
      const raw = localStorage.getItem('bt_pending_subscribe');
      if (raw) pending = JSON.parse(raw);
    } catch { /* ignore */ }
    if (pending?.plan !== 'pro' && pending?.plan !== 'enterprise') return;
    resumedRef.current = true;
    // Toujours nettoyer la clé (même périmée) pour ne pas la voir relancer plus tard.
    try { localStorage.removeItem('bt_pending_subscribe'); } catch { /* ignore */ }
    // ⏳ N'honorer que les intentions RÉCENTES (< 30 min) : évite qu'une clé périmée déclenche un
    //    checkout pour un AUTRE utilisateur qui se connecte plus tard sur le même appareil partagé.
    if (!pending.ts || Date.now() - pending.ts > 30 * 60 * 1000) return;
    if (pending.billing === 'month' || pending.billing === 'year') setBilling(pending.billing);
    setResumePlan(pending.plan);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!resumePlan) return;
    const p = resumePlan;
    setResumePlan(null);
    handleSubscribe(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumePlan]);

  const packs = config?.packs || [];
  const participantPacks = packs.filter((p) => p.audience === 'participant');
  const creatorPacks = packs.filter((p) => p.audience === 'creator');
  const offers = config?.offers || {};
  const validityMonths = config?.credit_validity_months ?? 12;
  const services = config?.services_shown || [];

  // 💳 Offres d'abonnement (essai illimité → débit auto). Source : /credits/config (config.plans).
  const plansCfg = config?.plans;
  const trialDays = config?.trial_days ?? 7;
  const proCredits = config?.plan_pro_monthly_credits ?? 20;
  const proVisible = plansCfg?.pro?.visible ?? true;
  const entVisible = plansCfg?.enterprise?.visible ?? true;
  const proLabel = plansCfg?.pro?.label || 'Utilisateur';
  const entLabel = plansCfg?.enterprise?.label || 'Coach';
  const proPrice = Number((billing === 'month' ? plansCfg?.pro?.price_monthly : plansCfg?.pro?.price_yearly) || (billing === 'month' ? '14.99' : '149.90'));
  const entPrice = Number((billing === 'month' ? plansCfg?.enterprise?.price_monthly : plansCfg?.enterprise?.price_yearly) || (billing === 'month' ? '99.99' : '999.00'));

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

      {/* 💳 ABONNEMENTS — 2 offres avec essai gratuit illimité → débit auto (crédits conservés en parallèle) */}
      {(proVisible || entVisible) && (
        <div className="max-w-5xl mx-auto mb-12">
          <div className="text-center mb-6">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-3" style={{ background: AFRO.gradient, color: '#fff' }}>
              <Gift size={14} /> {trialDays} jours d'essai gratuit
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2" style={{ fontFamily: theme.fonts.heading }}>
              Passe en illimité
            </h2>
            <p className="text-white/60 text-sm max-w-2xl mx-auto">
              Essai <span className="text-white font-semibold">{trialDays} jours illimité</span>, sans engagement.
              Carte demandée aujourd'hui, <span className="text-white font-semibold">0 CHF</span> maintenant —
              débit automatique à la fin de l'essai.
            </p>
            {/* Toggle mensuel / annuel */}
            <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/5 border border-white/10 mt-4">
              <button
                onClick={() => setBilling('month')}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${billing === 'month' ? 'text-white' : 'text-white/50'}`}
                style={billing === 'month' ? { background: AFRO.gradient } : {}}
              >
                Mensuel
              </button>
              <button
                onClick={() => setBilling('year')}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${billing === 'year' ? 'text-white' : 'text-white/50'}`}
                style={billing === 'year' ? { background: AFRO.gradient } : {}}
              >
                Annuel
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Offre Utilisateur (pro) */}
            {proVisible && (
              <Card className="relative border-white/10 bg-white/5 backdrop-blur-sm">
                <CardHeader className="text-center pb-2">
                  <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)' }}>
                    <Coins className="w-6 h-6 text-white" />
                  </div>
                  <CardTitle className="text-white">{proLabel}</CardTitle>
                  <CardDescription className="text-white/50">{proCredits} sessions / mois</CardDescription>
                </CardHeader>
                <CardContent className="text-center">
                  <div className="mb-2">
                    <span className="text-4xl font-bold text-white">{proPrice.toFixed(2)}</span>
                    <span className="text-white/50 text-sm ml-1">CHF / {billing === 'month' ? 'mois' : 'an'}</span>
                  </div>
                  <p className="text-white/40 text-xs mb-6">{trialDays} jours gratuits, puis débit auto</p>
                  <ul className="space-y-3 mb-6 text-left">
                    <li className="flex items-center gap-2 text-white/70 text-sm"><Check size={16} style={{ color: AFRO.pink }} className="flex-shrink-0" />{proCredits} sessions/mois (rejoindre ou animer)</li>
                    <li className="flex items-center gap-2 text-white/70 text-sm"><Check size={16} style={{ color: AFRO.pink }} className="flex-shrink-0" />Accès illimité pendant l'essai</li>
                    <li className="flex items-center gap-2 text-white/70 text-sm"><Check size={16} style={{ color: AFRO.pink }} className="flex-shrink-0" />Sans engagement, résiliable à tout moment</li>
                  </ul>
                  <Button onClick={() => handleSubscribe('pro')} disabled={subscribingPlan === 'pro'} className="w-full text-white border-0" style={{ background: AFRO.gradient }}>
                    {subscribingPlan === 'pro' ? (<><Loader2 size={16} className="mr-2 animate-spin" /> Redirection…</>) : (<>Commencer l'essai gratuit</>)}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Offre Coach (enterprise) — illimité */}
            {entVisible && (
              <Card className="relative border-white/10 bg-white/5 backdrop-blur-sm ring-2 scale-[1.02]" style={{ borderColor: AFRO.magenta }}>
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="px-3 py-1 text-white border-0" style={{ background: AFRO.gradient }}>Illimité</Badge>
                </div>
                <CardHeader className="text-center pb-2">
                  <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: AFRO.gradient }}>
                    <Star className="w-6 h-6 text-white" />
                  </div>
                  <CardTitle className="text-white">{entLabel}</CardTitle>
                  <CardDescription className="text-white/50">Sessions illimitées + 0% commission</CardDescription>
                </CardHeader>
                <CardContent className="text-center">
                  <div className="mb-2">
                    <span className="text-4xl font-bold text-white">{entPrice.toFixed(2)}</span>
                    <span className="text-white/50 text-sm ml-1">CHF / {billing === 'month' ? 'mois' : 'an'}</span>
                  </div>
                  <p className="text-white/40 text-xs mb-6">{trialDays} jours gratuits, puis débit auto</p>
                  <ul className="space-y-3 mb-6 text-left">
                    <li className="flex items-center gap-2 text-white/70 text-sm"><Check size={16} style={{ color: AFRO.pink }} className="flex-shrink-0" />Crédits / sessions illimités</li>
                    <li className="flex items-center gap-2 text-white/70 text-sm"><Check size={16} style={{ color: AFRO.pink }} className="flex-shrink-0" />0% de commission sur tes élèves</li>
                    <li className="flex items-center gap-2 text-white/70 text-sm"><Check size={16} style={{ color: AFRO.pink }} className="flex-shrink-0" />Enregistrement + transcription IA offerts</li>
                  </ul>
                  <Button onClick={() => handleSubscribe('enterprise')} disabled={subscribingPlan === 'enterprise'} className="w-full text-white border-0" style={{ background: AFRO.gradient }}>
                    {subscribingPlan === 'enterprise' ? (<><Loader2 size={16} className="mr-2 animate-spin" /> Redirection…</>) : (<>Commencer l'essai gratuit</>)}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          <p className="text-center text-white/40 text-xs mt-4 max-w-2xl mx-auto flex items-center justify-center gap-1.5">
            <CreditCard size={13} /> Débit auto à la fin de l'essai. Sans engagement, résiliable à tout moment.{' '}
            <span className="text-white/60 font-semibold">Non remboursable.</span>
          </p>
        </div>
      )}

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

      {/* 🔴 Option premium : Enregistrement complet + Transcription IA */}
      <div className="max-w-4xl mx-auto mt-2 mb-8 px-1">
        <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-white" style={{ background: AFRO.gradient }}>
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-white font-semibold">Option premium — Enregistrement + Transcription IA</h3>
            <p className="text-white/60 text-sm mt-1">
              Enregistre toute la session (toutes les voix + la musique) et reçois une transcription en français
              + un résumé / notes de cours, téléchargeables depuis ton Espace Coach.
              {config?.cost_record_transcribe ? ` Coût : ${config.cost_record_transcribe} crédit${config.cost_record_transcribe > 1 ? 's' : ''} par session (offert pour les coachs abonnés).` : ' Quelques crédits par session (offert pour les coachs abonnés).'}
            </p>
          </div>
        </div>
      </div>

      {/* 💎 Section COACHS — abonnement illimité (point d'entrée visible) */}
      <div className="max-w-4xl mx-auto mt-6 mb-10 px-1">
        <div
          className="rounded-2xl border p-6 sm:p-8 text-center"
          style={{ borderColor: 'rgba(217,28,210,0.4)', background: 'linear-gradient(135deg, rgba(217,28,210,0.14), rgba(255,45,170,0.10))' }}
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-3" style={{ background: AFRO.gradient, color: '#fff' }}>
            <Star size={14} /> Espace Coach
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2" style={{ fontFamily: theme.fonts.heading }}>
            Tu es coach ou animateur&nbsp;?
          </h2>
          <p className="text-white/70 max-w-2xl mx-auto mb-1">
            Anime tes propres sessions sur BoostTribe : modes Ouverte (crédits), Payante (billet CHF) ou Privée (lien/QR).
          </p>
          <p className="text-white/60 text-sm max-w-2xl mx-auto mb-5">
            <span className="font-semibold text-white">Abonnement Illimité</span> : crédits illimités + 0% de commission —
            tu encaisses tes élèves toi-même via ton lien/QR privé. (Sur demande, l'admin peut t'activer le mode
            commission : billets payants encaissés via la plateforme, virements par IBAN.)
          </p>
          <div className="flex flex-col items-center gap-3">
            <div className="text-white">
              <span className="text-4xl font-bold">{coachSubPrice.toFixed(2)}</span>
              <span className="text-white/60 text-base ml-1">CHF / mois</span>
            </div>
            <button
              onClick={() => handleSubscribe('enterprise')}
              disabled={subscribingPlan === 'enterprise'}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white font-semibold transition-transform hover:scale-[1.02] w-full sm:w-auto disabled:opacity-60"
              style={{ background: AFRO.gradient }}
              data-testid="become-coach-cta"
            >
              {subscribingPlan === 'enterprise' ? <Loader2 size={18} className="animate-spin" /> : <Star size={18} />}
              {isAuthenticated ? 'Devenir Coach — essai 7 jours' : 'Devenir Coach'}
            </button>
            <p className="text-white/40 text-xs">
              {trialDays} jours d'essai illimité, puis débit auto. Sans engagement, résiliable à tout moment.{' '}
              <span className="text-white/60 font-semibold">Non remboursable.</span>
            </p>
          </div>
        </div>
      </div>

      {/* CGU Modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1f] border border-white/10 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-white/10">
              <h2 className="text-xl font-bold text-white">Conditions Générales d'Utilisation</h2>
            </div>
            {/* Texte complet REPLIÉ par défaut — ouvert uniquement via le lien « CGU » de la case. */}
            {showFullTerms && (
            <div className="p-6 overflow-y-auto max-h-[50vh] text-white/70 text-sm space-y-4">
              <h3 className="text-white font-semibold">1. Acceptation des conditions</h3>
              <p>En utilisant BoostTribe, vous acceptez les présentes conditions générales d'utilisation.</p>
              <h3 className="text-white font-semibold">2. Crédits</h3>
              <p>BoostTribe fonctionne avec des crédits : 1 crédit donne accès à un live (rejoindre ou animer). Les crédits achetés sont valables {validityMonths} mois.</p>
              <h3 className="text-white font-semibold">3. Paiements</h3>
              <p>Les achats de crédits sont des paiements uniques traités de manière sécurisée via Stripe, en CHF.</p>
              <h3 className="text-white font-semibold">4. Abonnements &amp; essai gratuit</h3>
              <p>
                L'essai gratuit donne un accès illimité pendant {trialDays} jours. Une carte est demandée dès l'inscription :
                aucun montant n'est débité aujourd'hui, puis le plan choisi est{' '}
                <span className="text-white font-semibold">débité automatiquement à la fin de l'essai</span>, et à chaque échéance.
                L'abonnement est <span className="text-white font-semibold">résiliable à tout moment</span> (arrêt des renouvellements)
                mais <span className="text-white font-semibold">non remboursable</span> : aucune période déjà payée n'est remboursée.
              </p>
              <h3 className="text-white font-semibold">5. Propriété intellectuelle</h3>
              <p>Les utilisateurs sont responsables des contenus qu'ils partagent et doivent disposer des droits nécessaires.</p>
              <h3 className="text-white font-semibold">6. Protection des données</h3>
              <p>Nous collectons uniquement les données nécessaires au fonctionnement du service.</p>
            </div>
            )}
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
                <span className="text-white/80 text-sm">
                  J'ai lu et j'accepte les{' '}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowFullTerms((v) => !v); }}
                    className="text-purple-400 hover:text-purple-300 underline font-medium"
                  >
                    CGU
                  </button>
                  , le débit automatique à la fin de l'essai et le caractère non remboursable de l'abonnement.
                </span>
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
                    else if (pendingPlan) { const pl = pendingPlan; setPendingPlan(null); await startSubscribe(pl); }
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
