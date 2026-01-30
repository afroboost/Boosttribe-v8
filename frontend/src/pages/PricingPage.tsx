import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, Crown, Zap, Building2, ArrowLeft, ExternalLink, Sparkles } from 'lucide-react';

// Plan data
interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  features: string[];
  trackLimit: number;
  stripeMonthlyLink?: string;
  stripeYearlyLink?: string;
  isPopular?: boolean;
  isFromSupabase?: boolean; // Témoin : true si le prix vient de Supabase
}

// Base plans (Stripe links will be injected from settings)
const BASE_PLANS: Plan[] = [
  {
    id: 'trial',
    name: 'Essai Gratuit',
    monthlyPrice: 0,
    yearlyPrice: 0,
    currency: 'EUR',
    features: [
      '1 chanson max',
      '1 session active',
      'Participants illimités',
      'Synchronisation temps réel',
    ],
    trackLimit: 1,
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 9.99,
    yearlyPrice: 99.99,
    currency: 'EUR',
    features: [
      '50 chansons',
      'Sessions illimitées',
      'Participants illimités',
      'Voix en temps réel',
      'Support prioritaire',
    ],
    trackLimit: 50,
    isPopular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: 29.99,
    yearlyPrice: 299.99,
    currency: 'EUR',
    features: [
      'Chansons illimitées',
      'Sessions illimitées',
      'API dédiée',
      'Support 24/7',
      'Analytics avancées',
      'Personnalisation marque',
    ],
    trackLimit: -1,
  },
];

const PricingPage: React.FC = () => {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { settings, isLoaded } = useSiteSettings();
  const { 
    isAuthenticated,
    profile, 
    isAdmin, 
    isSubscribed, 
    hasAcceptedTerms, 
    acceptTerms,
  } = useAuth();

  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [termsChecked, setTermsChecked] = useState(hasAcceptedTerms);
  const [isAccepting, setIsAccepting] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  // Inject Stripe links AND dynamic prices from settings into plans
  // Also filter by visibility settings
  // isFromSupabase = true si les prix NE sont PAS les valeurs par défaut hardcodées
  const isProPriceFromDB = settings.plan_pro_price_monthly !== '9.99' || isLoaded;
  const isEnterprisePriceFromDB = settings.plan_enterprise_price_monthly !== '29.99' || isLoaded;
  
  const PLANS: Plan[] = BASE_PLANS.map(plan => {
    if (plan.id === 'pro') {
      return {
        ...plan,
        monthlyPrice: parseFloat(settings.plan_pro_price_monthly || '9.99'),
        yearlyPrice: parseFloat(settings.plan_pro_price_yearly || '99.99'),
        stripeMonthlyLink: settings.stripe_pro_monthly || undefined,
        stripeYearlyLink: settings.stripe_pro_yearly || undefined,
        isFromSupabase: isProPriceFromDB,
      };
    }
    if (plan.id === 'enterprise') {
      return {
        ...plan,
        monthlyPrice: parseFloat(settings.plan_enterprise_price_monthly || '29.99'),
        yearlyPrice: parseFloat(settings.plan_enterprise_price_yearly || '299.99'),
        stripeMonthlyLink: settings.stripe_enterprise_monthly || undefined,
        stripeYearlyLink: settings.stripe_enterprise_yearly || undefined,
        isFromSupabase: isEnterprisePriceFromDB,
      };
    }
    return { ...plan, isFromSupabase: false };
  }).filter(plan => {
    // Filter out hidden plans based on visibility settings
    if (plan.id === 'pro' && settings.plan_pro_visible === false) return false;
    if (plan.id === 'enterprise' && settings.plan_enterprise_visible === false) return false;
    return true;
  });

  // Handle terms acceptance
  const handleAcceptTerms = async () => {
    if (termsChecked && !hasAcceptedTerms) {
      setIsAccepting(true);
      await acceptTerms();
      setIsAccepting(false);
    }
  };

  // Handle plan selection
  const handleSelectPlan = async (plan: Plan) => {
    // If not authenticated, redirect to login
    if (!isAuthenticated && plan.id !== 'trial') {
      navigate('/login', { state: { from: '/pricing' } });
      return;
    }

    // If terms not accepted, require acceptance first
    if (!hasAcceptedTerms && !termsChecked && plan.id !== 'trial') {
      setShowTermsModal(true);
      return;
    }

    // Accept terms if checked but not yet saved
    if (termsChecked && !hasAcceptedTerms) {
      await handleAcceptTerms();
    }

    // If free trial, go to session (or login if not authenticated)
    if (plan.id === 'trial') {
      if (isAuthenticated) {
        navigate('/session');
      } else {
        navigate('/login', { state: { from: '/session' } });
      }
      return;
    }

    // Get Stripe link based on billing period
    const stripeLink = billingPeriod === 'monthly' 
      ? plan.stripeMonthlyLink 
      : plan.stripeYearlyLink;

    // If Stripe link exists, redirect directly to Stripe
    if (stripeLink) {
      // Open Stripe Checkout in new tab
      window.open(stripeLink, '_blank');
    } else {
      // FALLBACK: Use default Stripe links if not configured
      const defaultStripeLinks: Record<string, string> = {
        'pro': 'https://buy.stripe.com/test_beattribe_pro',
        'enterprise': 'https://buy.stripe.com/test_beattribe_enterprise',
      };
      
      const fallbackLink = defaultStripeLinks[plan.id];
      if (fallbackLink) {
        // Open default Stripe link in new tab
        window.open(fallbackLink, '_blank');
      } else {
        // Navigate to pricing for free trial
        if (plan.id === 'trial') {
          navigate('/session');
        } else {
          navigate('/contact');
        }
      }
    }
  };

  // Get icon for plan
  const getPlanIcon = (planId: string) => {
    switch (planId) {
      case 'trial': return <Zap className="w-6 h-6" />;
      case 'pro': return <Crown className="w-6 h-6" />;
      case 'enterprise': return <Building2 className="w-6 h-6" />;
      default: return <Sparkles className="w-6 h-6" />;
    }
  };

  // Get price to display
  const getDisplayPrice = (plan: Plan) => {
    if (plan.monthlyPrice === 0) return 'Gratuit';
    const price = billingPeriod === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;
    return `${price}€`;
  };

  // Get savings for yearly
  const getYearlySavings = (plan: Plan) => {
    if (plan.monthlyPrice === 0) return null;
    const monthlyCost = plan.monthlyPrice * 12;
    const yearlyCost = plan.yearlyPrice;
    const savings = Math.round(((monthlyCost - yearlyCost) / monthlyCost) * 100);
    return savings > 0 ? savings : null;
  };

  return (
    <div 
      className="min-h-screen py-12 px-4"
      style={{ background: theme.colors.background }}
    >
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-12">
        <Link 
          to="/"
          className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft size={20} />
          Retour à l'accueil
        </Link>

        <div className="text-center">
          <h1 
            className="text-4xl md:text-5xl font-bold text-white mb-4"
            style={{ fontFamily: theme.fonts.heading }}
          >
            Choisissez votre plan
          </h1>
          <p className="text-white/60 text-lg max-w-2xl mx-auto mb-8">
            Commencez gratuitement avec l'essai, puis passez à un abonnement pour débloquer toutes les fonctionnalités.
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-3 p-1 rounded-full bg-white/5 border border-white/10">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingPeriod === 'monthly'
                  ? 'bg-white text-black'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Mensuel
            </button>
            <button
              onClick={() => setBillingPeriod('yearly')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                billingPeriod === 'yearly'
                  ? 'bg-white text-black'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Annuel
              <span className="px-2 py-0.5 text-xs bg-green-500 text-white rounded-full">
                -17%
              </span>
            </button>
          </div>

          {/* Admin badge */}
          {isAdmin && (
            <Badge className="mt-6 bg-purple-500/20 text-purple-400 border-purple-500/30 px-4 py-2">
              👑 Mode Admin - Accès illimité gratuit
            </Badge>
          )}

          {/* Current subscription */}
          {profile && !isAdmin && (
            <Badge 
              className={`mt-6 px-4 py-2 ${
                isSubscribed 
                  ? 'bg-green-500/20 text-green-400 border-green-500/30' 
                  : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
              }`}
            >
              {isSubscribed 
                ? `✓ Abonné ${profile.subscription_status}` 
                : '🎵 Version d\'essai'
              }
            </Badge>
          )}
        </div>
      </div>

      {/* CGU Checkbox (if not accepted) */}
      {isAuthenticated && !hasAcceptedTerms && (
        <div className="max-w-xl mx-auto mb-8">
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={termsChecked}
                onChange={(e) => setTermsChecked(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-white/30 bg-transparent text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
              />
              <span className="text-white/80 text-sm">
                J'accepte les{' '}
                <button 
                  onClick={() => setShowTermsModal(true)}
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  Conditions Générales d'Utilisation
                </button>
                {' '}et la{' '}
                <button 
                  onClick={() => setShowTermsModal(true)}
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  Politique de Confidentialité
                </button>
                .
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Plans Grid */}
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        {PLANS.map((plan) => {
          const savings = getYearlySavings(plan);
          
          return (
            <Card 
              key={plan.id}
              className={`relative border-white/10 bg-white/5 backdrop-blur-sm transition-all hover:border-white/20 ${
                plan.isPopular ? 'ring-2 ring-purple-500/50 scale-105' : ''
              }`}
            >
              {/* Popular badge */}
              {plan.isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge 
                    className="px-3 py-1"
                    style={{ background: theme.colors.gradient.primary }}
                  >
                    Plus populaire
                  </Badge>
                </div>
              )}

              {/* Savings badge for yearly */}
              {billingPeriod === 'yearly' && savings && (
                <div className="absolute -top-3 right-4">
                  <Badge className="px-2 py-1 bg-green-500/20 text-green-400 border-green-500/30">
                    -{savings}%
                  </Badge>
                </div>
              )}

              <CardHeader className="text-center pb-2">
                <div 
                  className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
                  style={{ 
                    background: plan.isPopular 
                      ? theme.colors.gradient.primary 
                      : 'rgba(255,255,255,0.1)' 
                  }}
                >
                  {getPlanIcon(plan.id)}
                </div>
                <CardTitle className="text-white">{plan.name}</CardTitle>
                <CardDescription className="text-white/50">
                  {plan.trackLimit === -1 
                    ? 'Chansons illimitées' 
                    : `${plan.trackLimit} chanson${plan.trackLimit > 1 ? 's' : ''}`
                  }
                </CardDescription>
              </CardHeader>

              <CardContent className="text-center">
                {/* Price */}
                <div className="mb-6">
                  <span className="text-4xl font-bold text-white">
                    {getDisplayPrice(plan)}
                  </span>
                  {plan.monthlyPrice > 0 && (
                    <span className="text-white/50 text-sm">
                      /{billingPeriod === 'monthly' ? 'mois' : 'an'}
                    </span>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-3 mb-6 text-left">
                  {plan.features.map((feature: string, idx: number) => (
                    <li key={idx} className="flex items-center gap-2 text-white/70 text-sm">
                      <Check size={16} className="text-green-400 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* CTA Button */}
                <Button
                  onClick={() => handleSelectPlan(plan)}
                  disabled={!termsChecked && !hasAcceptedTerms && plan.id !== 'trial' && isAuthenticated}
                  className={`w-full ${
                    plan.isPopular 
                      ? 'text-white' 
                      : 'bg-white/10 hover:bg-white/20 text-white'
                  }`}
                  style={plan.isPopular ? { background: theme.colors.gradient.primary } : {}}
                >
                  {plan.id === 'trial' ? (
                    isAuthenticated ? 'Commencer gratuitement' : 'Créer un compte'
                  ) : (
                    <>
                      Souscrire <ExternalLink size={14} className="ml-1" />
                    </>
                  )}
                </Button>

                {/* Terms reminder */}
                {isAuthenticated && !termsChecked && !hasAcceptedTerms && plan.id !== 'trial' && (
                  <p className="text-xs text-yellow-400/70 mt-2">
                    Acceptez les CGU pour souscrire
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Admin skip notice */}
      {isAdmin && (
        <div className="max-w-2xl mx-auto mt-12 p-6 rounded-lg bg-purple-500/10 border border-purple-500/30 text-center">
          <Crown className="w-8 h-8 text-purple-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-white mb-2">Mode Administrateur Actif</h3>
          <p className="text-white/60 mb-4">
            Vous avez un accès illimité à toutes les fonctionnalités sans abonnement.
          </p>
          <Button 
            onClick={() => navigate('/session')}
            className="text-white"
            style={{ background: theme.colors.gradient.primary }}
          >
            Créer une session
          </Button>
        </div>
      )}

      {/* Terms Modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1f] border border-white/10 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-white/10">
              <h2 className="text-xl font-bold text-white">Conditions Générales d'Utilisation</h2>
            </div>
            <div className="p-6 overflow-y-auto max-h-[50vh] text-white/70 text-sm space-y-4">
              <h3 className="text-white font-semibold">1. Acceptation des conditions</h3>
              <p>
                En utilisant Boosttribe, vous acceptez les présentes conditions générales d'utilisation. 
                Si vous n'acceptez pas ces conditions, veuillez ne pas utiliser le service.
              </p>

              <h3 className="text-white font-semibold">2. Description du service</h3>
              <p>
                Boosttribe est une plateforme d'écoute musicale synchronisée permettant à un hôte 
                de partager de la musique en temps réel avec des participants.
              </p>

              <h3 className="text-white font-semibold">3. Propriété intellectuelle</h3>
              <p>
                Les utilisateurs sont responsables des contenus musicaux qu'ils uploadent. 
                Assurez-vous d'avoir les droits nécessaires pour partager les fichiers audio.
              </p>

              <h3 className="text-white font-semibold">4. Abonnements et paiements</h3>
              <p>
                Les abonnements sont facturés selon la période choisie (mensuelle ou annuelle). 
                Les paiements sont traités de manière sécurisée via Stripe.
              </p>

              <h3 className="text-white font-semibold">5. Protection des données</h3>
              <p>
                Nous collectons uniquement les données nécessaires au fonctionnement du service. 
                Vos informations ne sont pas partagées avec des tiers sans votre consentement.
              </p>

              <h3 className="text-white font-semibold">6. Résiliation</h3>
              <p>
                Vous pouvez résilier votre abonnement à tout moment. L'accès aux fonctionnalités 
                premium sera maintenu jusqu'à la fin de la période payée.
              </p>
            </div>
            <div className="p-6 border-t border-white/10 flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsChecked}
                  onChange={(e) => setTermsChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-white/30 bg-transparent text-purple-500"
                />
                <span className="text-white/80 text-sm">J'ai lu et j'accepte les CGU</span>
              </label>
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  onClick={() => setShowTermsModal(false)}
                  className="border-white/20 text-white/70"
                >
                  Fermer
                </Button>
                <Button
                  onClick={async () => {
                    if (termsChecked) {
                      await handleAcceptTerms();
                      setShowTermsModal(false);
                    }
                  }}
                  disabled={!termsChecked || isAccepting}
                  className="text-white"
                  style={{ background: theme.colors.gradient.primary }}
                >
                  {isAccepting ? 'Enregistrement...' : 'Accepter et continuer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="max-w-4xl mx-auto mt-16 text-center">
        <p className="text-white/40 text-sm">
          Questions ? Contactez-nous à{' '}
          <a href="mailto:support@beattribe.app" className="text-purple-400 hover:text-purple-300">
            support@beattribe.app
          </a>
        </p>
      </div>
    </div>
  );
};

export default PricingPage;
