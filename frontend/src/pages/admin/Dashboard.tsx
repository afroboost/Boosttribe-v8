import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { LanguageSelector } from "@/context/I18nContext";
import { refreshSiteSettings } from "@/hooks/useSiteSettings";
import { syncPlan, listUsers, AdminUser, getStripeKeys, saveStripeKeys, getAiKeys, saveAiKey, getPawapayKeys, savePawapayKeys, type PawapayKeysState } from "@/lib/paymentApi";
import {
  offerCredits, listCreditOffers, getCreditAdminConfig, saveCreditPack, deleteCreditPack, savePricingSettings,
  type CreditOfferRow, type CreditPack, type PricingSettings,
} from "@/lib/paymentApi";
import {
  getCommissionConfig, saveCommissionSettings, getBilletterieSales,
  getAdminPayouts, markPayoutPaid, rejectPayout,
  getAdminCoaches, setCoachPaymentType,
  type CommissionSettings, type TicketRow, type PayoutRow, type AdminCoach,
} from "@/lib/paymentApi";
import {
  listCreditGrants, updateCreditGrant, deleteCreditGrant,
  getTrialConfig, saveTrialConfig,
  type CreditGrant, type TrialConfig,
} from "@/lib/adminCreditsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { MobileMenu } from "@/components/layout/MobileMenu";
import supabase, { isSupabaseConfigured, uploadHomeImage } from "@/lib/supabaseClient";
import {
  KeyRound,
  ShieldCheck,
  Settings,
  CreditCard,
  Palette, 
  Type,
  Save,
  RefreshCw,
  ExternalLink,
  Zap,
  Building2,
  ArrowLeft,
  Eye,
  EyeOff,
  Check,
  X,
  Image,
  Video,
  DollarSign,
  Globe,
  Gift,
  Trash2,
  Crown,
  Users,
  Search,
  Download,
  Coins,
  Plus,
  Ticket,
  Percent,
  Upload,
  ChevronUp,
  ChevronDown,
  Loader2
} from "lucide-react";

// Textes ALT par défaut du carrousel d'accueil (appliqués si l'admin laisse vide).
const HOME_CAROUSEL_DEFAULT_ALTS = [
  "Deux sportifs en plein effort, chacun avec son propre casque, connectés à la même musique sur BoostTribe.",
  "Un duo qui s'entraîne en rythme, chacun ses écouteurs, la même playlist partagée en direct.",
  "Deux danseurs sur le même son, casques différents, expérience musicale synchronisée BoostTribe.",
];

// Site settings interface - matches Supabase table
interface SiteSettings {
  id?: string;
  site_name: string;
  site_slogan: string;
  site_description: string;
  site_badge: string;
  favicon_url: string;
  home_carousel: { url: string; alt?: string }[]; // 🖼️ carrousel d'accueil (max 3)
  hero_video_url: string; // 🎬 vidéo de fond du hero plein écran (mp4/webm)
  hero_poster_url: string; // 🖼️ image poster/secours de la vidéo hero
  color_primary: string;
  color_secondary: string;
  color_background: string;
  btn_login: string;
  btn_start: string;
  btn_join: string;
  btn_explore: string;
  stat_creators: string;
  stat_beats: string;
  stat_countries: string;
  stripe_pro_monthly: string;
  stripe_pro_yearly: string;
  stripe_enterprise_monthly: string;
  stripe_enterprise_yearly: string;
  // Plan visibility & pricing
  plan_pro_visible: boolean;
  plan_enterprise_visible: boolean;
  plan_pro_price_monthly: string;
  plan_pro_price_yearly: string;
  plan_enterprise_price_monthly: string;
  plan_enterprise_price_yearly: string;
  plan_pro_label: string;
  plan_enterprise_label: string;
  // Language
  default_language: string;
  updated_at?: string;
}

const DEFAULT_SETTINGS: SiteSettings = {
  site_name: 'Boosttribe',
  site_slogan: 'Unite Through Rhythm',
  site_description: 'Rejoignez la communauté des beatmakers et producteurs.',
  site_badge: 'La communauté des créateurs',
  favicon_url: '',
  home_carousel: [],
  hero_video_url: '',
  hero_poster_url: '',
  color_primary: '#7A5CFF',
  color_secondary: '#E24A9E',
  color_background: '#000000',
  btn_login: 'Connexion',
  btn_start: 'Commencer',
  btn_join: 'Rejoindre la tribu',
  btn_explore: 'Explorer les beats',
  stat_creators: '50K+',
  stat_beats: '1M+',
  stat_countries: '120+',
  stripe_pro_monthly: '',
  stripe_pro_yearly: '',
  stripe_enterprise_monthly: '',
  stripe_enterprise_yearly: '',
  // Plan visibility & pricing
  plan_pro_visible: true,
  plan_enterprise_visible: true,
  plan_pro_price_monthly: '9.99',
  plan_pro_price_yearly: '99.99',
  plan_enterprise_price_monthly: '29.99',
  plan_enterprise_price_yearly: '299.99',
  plan_pro_label: 'Utilisateur',
  plan_enterprise_label: 'Coach',
  // Language
  default_language: 'fr',
};

// Color validation
const isValidHex = (color: string): boolean => /^#([A-Fa-f0-9]{6})$/.test(color);

// Editable Field Component
interface EditableFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isColor?: boolean;
  icon?: React.ReactNode;
  hint?: string;
}

const EditableField: React.FC<EditableFieldProps> = ({ 
  label, value, onChange, placeholder, isColor, icon, hint
}) => {
  const [localValue, setLocalValue] = useState(value);
  const isValid = !isColor || isValidHex(localValue);

  useEffect(() => setLocalValue(value), [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    if (!isColor || isValidHex(newValue)) {
      onChange(newValue);
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-white/70 flex items-center gap-2">
        {icon}
        {label}
      </Label>
      <div className="flex items-center gap-2">
        {isColor && (
          <div 
            className="w-10 h-10 rounded-lg border-2 border-white/20 flex-shrink-0"
            style={{ background: isValid ? localValue : '#333' }}
          />
        )}
        <Input 
          value={localValue}
          onChange={handleChange}
          placeholder={placeholder}
          className={`bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[var(--bt-accent)] ${
            isColor && !isValid ? 'border-red-500' : ''
          }`}
        />
      </div>
      {hint && <p className="text-white/40 text-xs">{hint}</p>}
      {isColor && !isValid && (
        <p className="text-red-400 text-xs">Format invalide. Utilisez #RRGGBB</p>
      )}
    </div>
  );
};

// Main Dashboard Component
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { theme, updateConfig } = useTheme();
  const { isAdmin, user, isLoading: authLoading } = useAuth();
  const { showToast } = useToast();
  
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [originalSettings, setOriginalSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [activeTab, setActiveTab] = useState<'identity' | 'colors' | 'buttons' | 'stripe' | 'plans' | 'credits' | 'billetterie' | 'access' | 'users'>('identity');

  // D : liste de tous les utilisateurs
  const [usersList, setUsersList] = useState<AdminUser[]>([]);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);

  // PARTIE C : clés API Stripe (publique en clair, secrète chiffrée côté serveur)
  const [stripePubKey, setStripePubKey] = useState('');
  const [stripeSecretInput, setStripeSecretInput] = useState('');
  const [stripeSecretConfigured, setStripeSecretConfigured] = useState(false);
  const [stripeSecretLast4, setStripeSecretLast4] = useState('');
  const [stripeSecretSource, setStripeSecretSource] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysSaving, setKeysSaving] = useState(false);

  const loadStripeKeys = useCallback(async () => {
    setKeysLoading(true);
    const { data, error } = await getStripeKeys(false);
    if (data) {
      setStripePubKey(data.public_key || '');
      setStripeSecretConfigured(!!data.secret_configured);
      setStripeSecretLast4(data.secret_last4 || '');
      setStripeSecretSource(data.secret_source || '');
    } else if (error) {
      showToast(error, 'error');
    }
    setKeysLoading(false);
  }, [showToast]);

  const handleSaveStripeKeys = useCallback(async () => {
    setKeysSaving(true);
    const payload: { public_key?: string; secret_key?: string } = { public_key: stripePubKey.trim() };
    if (stripeSecretInput.trim()) payload.secret_key = stripeSecretInput.trim();
    const { ok, error } = await saveStripeKeys(payload);
    if (ok) {
      showToast('Clés Stripe enregistrées', 'success');
      setStripeSecretInput('');
      setRevealedSecret(null);
      await loadStripeKeys();
    } else {
      showToast(error || 'Échec de l\'enregistrement des clés', 'error');
    }
    setKeysSaving(false);
  }, [stripePubKey, stripeSecretInput, showToast, loadStripeKeys]);

  const handleRevealSecret = useCallback(async () => {
    if (revealedSecret) { setRevealedSecret(null); return; }
    const { data, error } = await getStripeKeys(true);
    if (data?.secret_key) setRevealedSecret(data.secret_key);
    else showToast(error || 'Clé secrète non configurée', 'warning');
  }, [revealedSecret, showToast]);

  // 📱 PawaPay (mobile money) — token chiffré + base URL sandbox/prod + table de taux CHF→local.
  const [ppTokenInput, setPpTokenInput] = useState('');
  const [ppBaseUrl, setPpBaseUrl] = useState('');
  const [ppState, setPpState] = useState<PawapayKeysState | null>(null);
  const [ppFxText, setPpFxText] = useState('');
  const [ppSaving, setPpSaving] = useState(false);

  const loadPawapayKeys = useCallback(async () => {
    const { data } = await getPawapayKeys();
    if (data) {
      setPpState(data);
      setPpBaseUrl(data.base_url || '');
      setPpFxText(JSON.stringify(data.fx_rates || {}, null, 2));
    }
  }, []);

  const handleSavePawapayKeys = useCallback(async () => {
    setPpSaving(true);
    const payload: { api_token?: string; base_url?: string; fx_rates?: Record<string, number> } = {};
    if (ppBaseUrl.trim()) payload.base_url = ppBaseUrl.trim();
    if (ppTokenInput.trim()) payload.api_token = ppTokenInput.trim();
    if (ppFxText.trim()) {
      try {
        const parsed = JSON.parse(ppFxText);
        if (parsed && typeof parsed === 'object') payload.fx_rates = parsed;
      } catch {
        showToast('Taux FX : JSON invalide', 'error');
        setPpSaving(false);
        return;
      }
    }
    const { ok, error } = await savePawapayKeys(payload);
    if (ok) {
      showToast('Réglages PawaPay enregistrés', 'success');
      setPpTokenInput('');
      await loadPawapayKeys();
    } else {
      showToast(error || 'Échec de l\'enregistrement', 'error');
    }
    setPpSaving(false);
  }, [ppBaseUrl, ppTokenInput, ppFxText, showToast, loadPawapayKeys]);

  // Clé IA (OpenAI) — transcription + résumé. Chiffrée côté serveur, jamais exposée.
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [aiKeyConfigured, setAiKeyConfigured] = useState(false);
  const [aiKeyLast4, setAiKeyLast4] = useState('');
  const [aiKeySource, setAiKeySource] = useState('');
  const [aiKeySaving, setAiKeySaving] = useState(false);

  const loadAiKey = useCallback(async () => {
    const { configured, last4, source, error } = await getAiKeys();
    if (error) { showToast(error, 'error'); return; }
    setAiKeyConfigured(configured);
    setAiKeyLast4(last4);
    setAiKeySource(source);
  }, [showToast]);

  const handleSaveAiKey = useCallback(async () => {
    if (!aiKeyInput.trim()) return;
    setAiKeySaving(true);
    const { ok, error } = await saveAiKey(aiKeyInput.trim());
    if (ok) { showToast('Clé IA enregistrée', 'success'); setAiKeyInput(''); await loadAiKey(); }
    else showToast(error || 'Échec de l\'enregistrement de la clé IA', 'error');
    setAiKeySaving(false);
  }, [aiKeyInput, showToast, loadAiKey]);

  // ===========================================================================
  // 💳 CRÉDITS OFFERTS (admin) — remplace "Accès offerts"
  // ===========================================================================
  const [offerEmail, setOfferEmail] = useState('');
  const [offerAmount, setOfferAmount] = useState(1);
  const [offerNote, setOfferNote] = useState('');
  const [offering, setOffering] = useState(false);
  const [creditOffers, setCreditOffers] = useState<CreditOfferRow[]>([]);

  const refreshCreditOffers = useCallback(async () => {
    const { offers, error } = await listCreditOffers();
    if (error) { showToast(`Historique crédits : ${error}`, 'error'); return; }
    setCreditOffers(offers);
  }, [showToast]);

  const handleOfferCredits = useCallback(async () => {
    const email = offerEmail.trim().toLowerCase();
    if (!email) { showToast('Renseignez un email', 'warning'); return; }
    if (!offerAmount || offerAmount <= 0) { showToast('Nombre de crédits invalide', 'warning'); return; }
    setOffering(true);
    try {
      const { ok, error } = await offerCredits({ email, credits: offerAmount, note: offerNote.trim() || undefined });
      if (ok) {
        showToast(`${offerAmount} crédit(s) offert(s) à ${email}`, 'success');
        setOfferEmail(''); setOfferNote(''); setOfferAmount(1);
        await refreshCreditOffers();
      } else {
        showToast(error || "Échec de l'attribution", 'error');
      }
    } finally {
      setOffering(false);
    }
  }, [offerEmail, offerAmount, offerNote, refreshCreditOffers, showToast]);

  // ===========================================================================
  // 3a) Historique « Crédits offerts » ÉDITABLE — MODIFIER / SUPPRIMER (grants)
  // ===========================================================================
  const [grants, setGrants] = useState<CreditGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [editGrantId, setEditGrantId] = useState<number | null>(null);
  const [editGrantAmount, setEditGrantAmount] = useState(1);
  const [editGrantNote, setEditGrantNote] = useState('');
  const [savingGrant, setSavingGrant] = useState(false);

  const refreshGrants = useCallback(async () => {
    setGrantsLoading(true);
    try {
      const { grants: list, error } = await listCreditGrants();
      if (error) { showToast(`Historique crédits offerts : ${error}`, 'error'); return; }
      setGrants(list);
    } finally {
      setGrantsLoading(false);
    }
  }, [showToast]);

  const startEditGrant = useCallback((g: CreditGrant) => {
    setEditGrantId(g.id);
    setEditGrantAmount(g.amount);
    setEditGrantNote(g.note || '');
  }, []);

  const cancelEditGrant = useCallback(() => {
    setEditGrantId(null);
    setEditGrantNote('');
    setEditGrantAmount(1);
  }, []);

  const handleUpdateGrant = useCallback(async (id: number) => {
    if (!editGrantAmount || editGrantAmount <= 0) { showToast('Nombre de crédits invalide', 'warning'); return; }
    setSavingGrant(true);
    try {
      const { ok, error } = await updateCreditGrant(id, { amount: editGrantAmount, note: editGrantNote.trim() });
      if (ok) {
        showToast('Crédit offert mis à jour', 'success');
        cancelEditGrant();
        await refreshGrants();
      } else {
        showToast(error || 'Échec de la mise à jour', 'error');
      }
    } finally {
      setSavingGrant(false);
    }
  }, [editGrantAmount, editGrantNote, cancelEditGrant, refreshGrants, showToast]);

  const handleDeleteGrant = useCallback(async (id: number) => {
    if (!window.confirm('Supprimer définitivement ce crédit offert ?')) return;
    const { ok, error } = await deleteCreditGrant(id);
    if (ok) {
      showToast('Crédit offert supprimé', 'success');
      if (editGrantId === id) cancelEditGrant();
      await refreshGrants();
    } else {
      showToast(error || 'Échec de la suppression', 'error');
    }
  }, [editGrantId, cancelEditGrant, refreshGrants, showToast]);

  // ===========================================================================
  // 3b) Essai gratuit → paiement automatique (prépare le flux Stripe récurrent)
  // ===========================================================================
  const [trialConfig, setTrialConfig] = useState<TrialConfig>({ trial_days: 0, auto_charge_enabled: false });
  const [trialLoading, setTrialLoading] = useState(false);
  const [savingTrial, setSavingTrial] = useState(false);

  const refreshTrialConfig = useCallback(async () => {
    setTrialLoading(true);
    try {
      const { data, error } = await getTrialConfig();
      if (error) { showToast(`Essai gratuit : ${error}`, 'error'); return; }
      if (data) setTrialConfig(data);
    } finally {
      setTrialLoading(false);
    }
  }, [showToast]);

  const handleSaveTrialConfig = useCallback(async () => {
    if (trialConfig.trial_days < 0) { showToast("Durée d'essai invalide", 'warning'); return; }
    setSavingTrial(true);
    try {
      const { ok, error } = await saveTrialConfig(trialConfig);
      if (ok) showToast('Réglage de l\'essai gratuit enregistré', 'success');
      else showToast(error || "Échec de l'enregistrement", 'error');
    } finally {
      setSavingTrial(false);
    }
  }, [trialConfig, showToast]);

  // ===========================================================================
  // 💳 CRÉDITS & TARIFS (admin) — packs + réglages (coûts, validité, offres, services)
  // ===========================================================================
  const [creditPacks, setCreditPacks] = useState<CreditPack[]>([]);
  const [pricingSettings, setPricingSettings] = useState<PricingSettings | null>(null);
  const [creditCfgLoading, setCreditCfgLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const blankPack: Partial<CreditPack> = { name: '', credits: 1, price_chf: 9, is_highlighted: false, audience: 'participant', sort: 0, active: true };
  const [packDraft, setPackDraft] = useState<Partial<CreditPack>>(blankPack);

  // 🎟️ Billetterie & Commission + Virements
  const [commission, setCommission] = useState<CommissionSettings | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [savingCommission, setSavingCommission] = useState(false);
  const [sales, setSales] = useState<TicketRow[]>([]);
  const [salesTotals, setSalesTotals] = useState<{ count_paid: number; gross_chf: number; commission_chf: number }>({ count_paid: 0, gross_chf: 0, commission_chf: 0 });
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [payoutsPending, setPayoutsPending] = useState(0);
  const [coaches, setCoaches] = useState<AdminCoach[]>([]);
  const [coachQuery, setCoachQuery] = useState('');

  const refreshBilletterie = useCallback(async () => {
    setBillLoading(true);
    try {
      const [cfg, sale, pay, co] = await Promise.all([getCommissionConfig(), getBilletterieSales(), getAdminPayouts(), getAdminCoaches()]);
      if (cfg.settings) setCommission(cfg.settings);
      if (cfg.error) showToast(`Commission : ${cfg.error}`, 'error');
      setSales(sale.sales || []);
      setSalesTotals({ count_paid: sale.count_paid, gross_chf: sale.gross_chf, commission_chf: sale.commission_chf });
      setPayouts(pay.payouts || []);
      setPayoutsPending(pay.pending_total_chf || 0);
      setCoaches(co.coaches || []);
    } finally {
      setBillLoading(false);
    }
  }, [showToast]);

  const handleSetCoachType = useCallback(async (c: AdminCoach, type: 'subscription' | 'commission') => {
    const { ok, error } = await setCoachPaymentType(c.id, type);
    if (ok) { showToast('Type de paiement mis à jour', 'success'); setCoaches((prev) => prev.map((x) => x.id === c.id ? { ...x, coach_payment_type: type } : x)); }
    else showToast(error || 'Échec', 'error');
  }, [showToast]);

  const handleSaveCommission = useCallback(async () => {
    if (!commission) return;
    setSavingCommission(true);
    try {
      const { ok, settings, error } = await saveCommissionSettings(commission);
      if (ok) { if (settings) setCommission(settings); showToast('Réglages billetterie enregistrés', 'success'); }
      else showToast(error || 'Échec', 'error');
    } finally {
      setSavingCommission(false);
    }
  }, [commission, showToast]);

  const handleMarkPayoutPaid = useCallback(async (p: PayoutRow) => {
    if (!window.confirm(`Marquer comme PAYÉ le virement de ${p.amount_chf} CHF à ${p.coach_email || p.user_id} ?\nLe solde du coach sera déduit d'autant.`)) return;
    const { ok, error } = await markPayoutPaid(p.id);
    if (ok) { showToast('Virement marqué payé', 'success'); await refreshBilletterie(); }
    else showToast(error || 'Échec', 'error');
  }, [refreshBilletterie, showToast]);

  const handleRejectPayout = useCallback(async (p: PayoutRow) => {
    if (!window.confirm(`Rejeter la demande de virement de ${p.amount_chf} CHF ?`)) return;
    const { ok, error } = await rejectPayout(p.id);
    if (ok) { showToast('Demande rejetée', 'success'); await refreshBilletterie(); }
    else showToast(error || 'Échec', 'error');
  }, [refreshBilletterie, showToast]);

  const refreshCreditConfig = useCallback(async () => {
    setCreditCfgLoading(true);
    try {
      const { packs, settings, error } = await getCreditAdminConfig();
      if (error) { showToast(`Config crédits : ${error}`, 'error'); return; }
      setCreditPacks(packs);
      setPricingSettings(settings);
    } finally {
      setCreditCfgLoading(false);
    }
  }, [showToast]);

  const handleSavePack = useCallback(async () => {
    const d = packDraft;
    if (!d.name || !d.name.trim()) { showToast('Nom du pack requis', 'warning'); return; }
    if (!d.credits || d.credits <= 0) { showToast('Crédits invalides', 'warning'); return; }
    const { ok, error } = await saveCreditPack({
      id: d.id, name: d.name.trim(), credits: Number(d.credits), price_chf: Number(d.price_chf),
      is_highlighted: !!d.is_highlighted, audience: (d.audience as any) || 'participant',
      sort: Number(d.sort) || 0, active: d.active !== false,
    });
    if (ok) {
      showToast(d.id ? 'Pack mis à jour' : 'Pack créé', 'success');
      setPackDraft(blankPack);
      await refreshCreditConfig();
    } else {
      showToast(error || 'Échec', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packDraft, refreshCreditConfig, showToast]);

  const handleDeletePack = useCallback(async (pack: CreditPack) => {
    if (!window.confirm(`Supprimer le pack « ${pack.name} » ?`)) return;
    const { ok, error } = await deleteCreditPack(pack.id);
    if (ok) { showToast('Pack supprimé', 'success'); await refreshCreditConfig(); }
    else showToast(error || 'Échec', 'error');
  }, [refreshCreditConfig, showToast]);

  const handleSavePricingSettings = useCallback(async () => {
    if (!pricingSettings) return;
    setSavingSettings(true);
    try {
      const { ok, error, settings } = await savePricingSettings({
        cost_join: pricingSettings.cost_join,
        cost_host: pricingSettings.cost_host,
        credit_validity_months: pricingSettings.credit_validity_months,
        signup_free_credits: pricingSettings.signup_free_credits,
        cost_record_transcribe: pricingSettings.cost_record_transcribe,
        plan_pro_monthly_credits: pricingSettings.plan_pro_monthly_credits,
        services_shown: pricingSettings.services_shown,
        offers: pricingSettings.offers,
      });
      if (ok) { showToast('Réglages enregistrés', 'success'); if (settings) setPricingSettings(settings); }
      else showToast(error || 'Échec', 'error');
    } finally {
      setSavingSettings(false);
    }
  }, [pricingSettings, showToast]);

  const ALL_SERVICES: { key: string; label: string }[] = [
    { key: 'live', label: 'Lives audio' },
    { key: 'visio', label: 'Live Visio' },
    { key: 'stage', label: 'Scène / co-animation' },
    { key: 'chat', label: 'Chat en direct' },
  ];
  const toggleService = (key: string) => {
    if (!pricingSettings) return;
    const cur = pricingSettings.services_shown || [];
    const next = cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key];
    setPricingSettings({ ...pricingSettings, services_shown: next });
  };
  const toggleOffer = (key: string) => {
    if (!pricingSettings) return;
    const offers = { ...(pricingSettings.offers || {}) };
    const cur = offers[key] || {};
    offers[key] = { ...cur, enabled: !cur.enabled };
    setPricingSettings({ ...pricingSettings, offers });
  };

  // D : charger tous les utilisateurs
  const refreshUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const { users, error } = await listUsers();
      if (error) { showToast(`Utilisateurs : ${error}`, 'error'); return; }
      setUsersList(users);
    } finally {
      setUsersLoading(false);
    }
  }, [showToast]);

  // Filtre par nom OU email
  const filteredUsers = useMemo(() => {
    const q = usersSearch.trim().toLowerCase();
    if (!q) return usersList;
    return usersList.filter(u =>
      (u.email || '').toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q)
    );
  }, [usersList, usersSearch]);

  // Export CSV
  const handleExportCsv = useCallback(() => {
    const header = ['email', 'nom', 'plan', 'acces_offert', 'expiration_acces', 'inscription'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = filteredUsers.map(u => [
      u.email, u.full_name || '', u.subscription_status || '', u.comp_access_plan || '',
      u.comp_access_until || '', u.created_at || '',
    ].map(esc).join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boosttribe-utilisateurs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredUsers]);

  // Charger la liste quand on ouvre les onglets concernés
  useEffect(() => {
    if (activeTab === 'access') { refreshCreditOffers(); refreshUsers(); refreshGrants(); }
    if (activeTab === 'credits') refreshCreditConfig();
    if (activeTab === 'billetterie') refreshBilletterie();
    if (activeTab === 'users') refreshUsers();
    if (activeTab === 'stripe') { loadStripeKeys(); loadAiKey(); loadPawapayKeys(); }
    if (activeTab === 'plans') refreshTrialConfig();
  }, [activeTab, refreshCreditOffers, refreshCreditConfig, refreshBilletterie, refreshUsers, loadStripeKeys, loadAiKey, loadPawapayKeys, refreshGrants, refreshTrialConfig]);
  const [dbStatus, setDbStatus] = useState<'connected' | 'offline' | 'checking'>('checking');
  // Note: No dbError state - we use "auto-healing" mode

  // ADMIN BYPASS: Check email directly for instant access
  const userEmail = user?.email?.toLowerCase() || '';
  const isAdminByEmail = userEmail === 'contact.artboost@gmail.com';
  const hasAdminAccess = isAdminByEmail || isAdmin;

  // Redirect if not admin
  useEffect(() => {
    if (authLoading && !isAdminByEmail) return;
    if (!hasAdminAccess && !authLoading) {
      console.log('[CMS] Access denied, redirecting...');
      showToast('Accès refusé - Admin uniquement', 'error');
      navigate('/');
    }
  }, [hasAdminAccess, authLoading, navigate, showToast, isAdminByEmail]);

  // Update favicon in document head — preview immédiat ; vide = favicon par défaut
  useEffect(() => {
    const url = settings.favicon_url?.trim() || '/icon-192x192.png';
    let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = url;
  }, [settings.favicon_url]);

  // Load settings from Supabase with AUTO-HEALING mode (auto-insert if empty)
  useEffect(() => {
    let isMounted = true;
    
    const loadSettings = async () => {
      if (!isMounted) return;
      
      console.log('[CMS] Loading site settings...');
      setDbStatus('checking');
      
      // If Supabase is not configured, silently use defaults
      if (!isSupabaseConfigured || !supabase) {
        console.log('[CMS] Supabase not configured - using defaults (auto-healing)');
        if (isMounted) {
          setDbStatus('offline');
          setSettings(DEFAULT_SETTINGS);
          setOriginalSettings(DEFAULT_SETTINGS);
          setIsLoadingSettings(false);
        }
        return;
      }

      try {
        // Query Supabase - use maybeSingle() to avoid errors on empty results
        const { data, error } = await supabase
          .from('site_settings')
          .select('*')
          .limit(1)
          .maybeSingle();
        
        if (!isMounted) return;
        
        // AUTO-HEALING: If table is empty (no data, no error), insert default row
        if (!data && !error) {
          console.log('[CMS] Table empty, auto-inserting default row...');
          const { data: insertedData, error: insertError } = await supabase
            .from('site_settings')
            .insert([{
              site_name: DEFAULT_SETTINGS.site_name,
              site_slogan: DEFAULT_SETTINGS.site_slogan,
              site_description: DEFAULT_SETTINGS.site_description,
              site_badge: DEFAULT_SETTINGS.site_badge,
              favicon_url: DEFAULT_SETTINGS.favicon_url,
              color_primary: DEFAULT_SETTINGS.color_primary,
              color_secondary: DEFAULT_SETTINGS.color_secondary,
              color_background: DEFAULT_SETTINGS.color_background,
              btn_login: DEFAULT_SETTINGS.btn_login,
              btn_start: DEFAULT_SETTINGS.btn_start,
              btn_join: DEFAULT_SETTINGS.btn_join,
              btn_explore: DEFAULT_SETTINGS.btn_explore,
              stat_creators: DEFAULT_SETTINGS.stat_creators,
              stat_beats: DEFAULT_SETTINGS.stat_beats,
              stat_countries: DEFAULT_SETTINGS.stat_countries,
              stripe_pro_monthly: DEFAULT_SETTINGS.stripe_pro_monthly,
              stripe_pro_yearly: DEFAULT_SETTINGS.stripe_pro_yearly,
              stripe_enterprise_monthly: DEFAULT_SETTINGS.stripe_enterprise_monthly,
              stripe_enterprise_yearly: DEFAULT_SETTINGS.stripe_enterprise_yearly,
            }])
            .select()
            .single();

          if (insertError) {
            console.warn('[CMS] Auto-insert failed:', insertError.message);
            setDbStatus('offline');
            setSettings(DEFAULT_SETTINGS);
            setOriginalSettings(DEFAULT_SETTINGS);
          } else if (insertedData) {
            console.log('[CMS] ✅ Default row auto-inserted successfully');
            setSettings(insertedData as SiteSettings);
            setOriginalSettings(insertedData as SiteSettings);
            setDbStatus('connected');
          }
        } else if (error) {
          // Table doesn't exist or other error
          console.log('[CMS] Query error (auto-healing):', error.message);
          setDbStatus('offline');
          setSettings(DEFAULT_SETTINGS);
          setOriginalSettings(DEFAULT_SETTINGS);
        } else {
          // Data exists
          console.log('[CMS] ✅ DB Synchro: OK - Settings loaded from Supabase:', data.site_name);
          setSettings(data as SiteSettings);
          setOriginalSettings(data as SiteSettings);
          setDbStatus('connected');
        }
      } catch (err) {
        // Silently fallback to defaults
        console.log('[CMS] Exception, using defaults (auto-healing):', err);
        if (isMounted) {
          setDbStatus('offline');
          setSettings(DEFAULT_SETTINGS);
          setOriginalSettings(DEFAULT_SETTINGS);
        }
      } finally {
        if (isMounted) {
          setIsLoadingSettings(false);
        }
      }
    };

    if (hasAdminAccess || isAdminByEmail) {
      loadSettings();
    } else {
      setIsLoadingSettings(false);
    }
    
    return () => {
      isMounted = false;
    };
  }, [hasAdminAccess, isAdminByEmail]);

  // Update field
  const handleUpdate = useCallback((key: keyof SiteSettings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  // 🖼️ Carrousel d'accueil (max 3 images) — upload/remplacement, texte alt, ordre.
  const [carouselUploading, setCarouselUploading] = useState<number | null>(null);
  const setCarousel = useCallback((next: { url: string; alt?: string }[]) => {
    setSettings(prev => ({ ...prev, home_carousel: next }));
    setHasChanges(true);
  }, []);
  const handleCarouselUpload = useCallback(async (slot: number, file: File) => {
    setCarouselUploading(slot);
    const { url, error } = await uploadHomeImage(file);
    setCarouselUploading(null);
    if (error || !url) { showToast(error || 'Upload échoué', 'error'); return; }
    setSettings(prev => {
      const arr = [...(prev.home_carousel || [])];
      arr[slot] = { url, alt: arr[slot]?.alt || '' };
      return { ...prev, home_carousel: arr.filter(Boolean) };
    });
    setHasChanges(true);
    showToast('Image téléversée — pensez à Enregistrer', 'success');
  }, [showToast]);
  const updateCarouselAlt = useCallback((slot: number, alt: string) => {
    setSettings(prev => {
      const arr = [...(prev.home_carousel || [])];
      if (arr[slot]) arr[slot] = { ...arr[slot], alt };
      return { ...prev, home_carousel: arr };
    });
    setHasChanges(true);
  }, []);
  const moveCarousel = useCallback((slot: number, dir: -1 | 1) => {
    setSettings(prev => {
      const arr = [...(prev.home_carousel || [])];
      const t = slot + dir;
      if (t < 0 || t >= arr.length) return prev;
      [arr[slot], arr[t]] = [arr[t], arr[slot]];
      return { ...prev, home_carousel: arr };
    });
    setHasChanges(true);
  }, []);
  const removeCarousel = useCallback((slot: number) => {
    setSettings(prev => ({ ...prev, home_carousel: (prev.home_carousel || []).filter((_, i) => i !== slot) }));
    setHasChanges(true);
  }, []);

  // Save settings - SDK SUPABASE UNIQUEMENT (SANS FETCH)
  const handleSave = useCallback(async () => {
    if (!supabase) { 
      alert('Supabase non configuré'); 
      return; 
    }
    
    setIsSaving(true);
    
    try {
      // Construire l'objet de données MANUELLEMENT (pas de spread)
      const dataToSave = {
        id: 1,
        site_name: 'Boosttribe',
        site_slogan: settings.site_slogan,
        site_description: settings.site_description,
        site_badge: settings.site_badge,
        favicon_url: settings.favicon_url || '',
        home_carousel: settings.home_carousel || [],
        hero_video_url: settings.hero_video_url || '',
        hero_poster_url: settings.hero_poster_url || '',
        color_primary: settings.color_primary,
        color_secondary: settings.color_secondary,
        color_background: settings.color_background,
        btn_login: settings.btn_login,
        btn_start: settings.btn_start,
        btn_join: settings.btn_join,
        btn_explore: settings.btn_explore,
        stat_creators: settings.stat_creators,
        stat_beats: settings.stat_beats,
        stat_countries: settings.stat_countries,
        stripe_pro_monthly: settings.stripe_pro_monthly || '',
        stripe_pro_yearly: settings.stripe_pro_yearly || '',
        stripe_enterprise_monthly: settings.stripe_enterprise_monthly || '',
        stripe_enterprise_yearly: settings.stripe_enterprise_yearly || '',
        plan_pro_visible: settings.plan_pro_visible,
        plan_enterprise_visible: settings.plan_enterprise_visible,
        plan_pro_price_monthly: settings.plan_pro_price_monthly,
        plan_pro_price_yearly: settings.plan_pro_price_yearly,
        plan_enterprise_price_monthly: settings.plan_enterprise_price_monthly,
        plan_enterprise_price_yearly: settings.plan_enterprise_price_yearly,
        plan_pro_label: settings.plan_pro_label,
        plan_enterprise_label: settings.plan_enterprise_label,
      };

      const { error } = await supabase.from('site_settings').upsert(dataToSave);

      if (error) {
        alert("ERREUR DB : " + error.message);
        return;
      }

      // 💳 Synchronisation des prix Stripe (création/maj des Price via le backend).
      // Ne bloque pas la sauvegarde CMS : si le backend est injoignable, on avertit seulement.
      const num = (v: string) => {
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };
      const stripeMessages: string[] = [];
      for (const plan of ['pro', 'enterprise'] as const) {
        const monthly = num(plan === 'pro' ? settings.plan_pro_price_monthly : settings.plan_enterprise_price_monthly);
        const annual = num(plan === 'pro' ? settings.plan_pro_price_yearly : settings.plan_enterprise_price_yearly);
        const res = await syncPlan({ plan, monthly_price: monthly, annual_price: annual, currency: 'chf' });
        stripeMessages.push(res.ok ? `Stripe ${plan} : OK` : `Stripe ${plan} : ${res.error}`);
      }

      alert(
        "✅ Réglages enregistrés (" + new Date().toLocaleTimeString() + ")\n" +
        stripeMessages.join("\n")
      );
      // Rafraîchir le cache global des settings pour tous les composants
      refreshSiteSettings();
      // Recharger la page pour appliquer les changements visuels
      window.location.reload();
    } catch (err) {
      alert("EXCEPTION : " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSaving(false);
    }
  }, [settings]);


  // Reset to original
  const handleReset = useCallback(() => {
    setSettings(originalSettings);
    setHasChanges(false);
    showToast('Modifications annulées', 'warning');
  }, [originalSettings, showToast]);

  // Reset to defaults
  const handleResetDefaults = useCallback(() => {
    if (window.confirm('Réinitialiser tous les paramètres par défaut ?')) {
      setSettings({ ...DEFAULT_SETTINGS, id: settings.id });
      setHasChanges(true);
      showToast('Paramètres réinitialisés (sauvegardez pour appliquer)', 'warning');
    }
  }, [settings.id, showToast]);

  // Show loading
  if ((authLoading || isLoadingSettings) && !isAdminByEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[var(--bt-accent)] border-t-transparent rounded-full animate-spin" />
          <span className="text-white/50">Chargement du CMS...</span>
        </div>
      </div>
    );
  }

  if (!hasAdminAccess && !isAdminByEmail) return null;

  return (
    <div className="min-h-screen" style={{ background: '#0a0a0f' }}>
      {/* Header */}
      <header 
        className="sticky top-0 z-50 border-b border-white/10"
        style={{ background: "rgba(0, 0, 0, 0.9)", backdropFilter: "blur(20px)" }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-2">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <Link to="/" className="flex items-center gap-2 min-w-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)` }}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                </div>
                <span
                  className="text-lg sm:text-xl font-bold truncate"
                  style={{
                    fontFamily: theme.fonts.heading,
                    backgroundImage: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)`,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {settings.site_name}
                </span>
              </Link>
              <Separator orientation="vertical" className="h-6 bg-white/20 hidden md:block" />
              <Badge className="bg-[rgb(var(--bt-accent-rgb)/0.2)] text-[var(--bt-accent)] border-[rgb(var(--bt-accent-rgb)/0.3)] hidden md:inline-flex">
                ⚙️ CMS Admin
              </Badge>

              {/* DB Status — masqué sur petit écran pour éviter le débordement */}
              <span className="hidden lg:inline-flex">
                {dbStatus === 'connected' ? (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    <Check size={12} className="mr-1" /> Supabase
                  </Badge>
                ) : dbStatus === 'offline' ? (
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                    💾 Mode local
                  </Badge>
                ) : (
                  <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                    <RefreshCw size={12} className="mr-1 animate-spin" /> Connexion...
                  </Badge>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {hasChanges && (
                <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hidden sm:inline-flex">
                  ⚠️ Non sauvegardé
                </Badge>
              )}
              {/* Language Selector - Visible en mode Admin */}
              <LanguageSelector className="flex" />
              {/* Actions desktop : masquées sur mobile (disponibles via le menu hamburger) */}
              <Link to="/" target="_blank" className="hidden md:block">
                <Button variant="outline" size="sm" className="border-white/20 text-white/70 hover:bg-white/10">
                  <Eye size={16} className="mr-2" />
                  Prévisualiser
                </Button>
              </Link>
              <Link to="/" className="hidden md:block">
                <Button variant="outline" size="sm" className="border-white/20 text-white/70 hover:bg-white/10">
                  <ArrowLeft size={16} className="mr-2" />
                  Retour
                </Button>
              </Link>
              {/* 📱 Menu hamburger réutilisé (mobile) — barre admin h-16 → dropdown top-16 */}
              <MobileMenu dropdownTopClass="top-16" />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Info banner for offline mode (soft, non-blocking) */}
        {dbStatus === 'offline' && (
          <div className="mb-6 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-3">
            <span className="text-yellow-400/80 text-sm">
              💡 Mode local actif - Les modifications ne seront pas persistées. 
              <Link to="/" className="underline ml-1 hover:text-yellow-300">
                Configurez Supabase
              </Link> pour la sauvegarde.
            </span>
          </div>
        )}

        {/* Page Title */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2" style={{ fontFamily: theme.fonts.heading }}>
              👑 Gestion du Site (CMS)
            </h1>
            <p className="text-white/60 text-sm sm:text-base">
              Modifiez l'identité, les couleurs et les textes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-3 sm:flex-shrink-0">
            <Button
              variant="outline"
              onClick={handleResetDefaults}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              size="sm"
            >
              <X size={14} className="mr-2" />
              Défaut
            </Button>
            {hasChanges && (
              <Button
                variant="outline"
                onClick={handleReset}
                className="border-white/20 text-white/70 hover:bg-white/10"
                size="sm"
              >
                Annuler
              </Button>
            )}
            <PrimaryButton
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              size="sm"
            >
              {isSaving ? (
                <RefreshCw size={14} className="mr-2 animate-spin" />
              ) : (
                <Save size={14} className="mr-2" />
              )}
              {isSaving ? 'Sauvegarde...' : 'Enregistrer'}
            </PrimaryButton>
          </div>
        </div>

        {/* Live Preview Card */}
        <Card className="border-white/10 bg-white/5 mb-8">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
              <div className="flex items-center gap-4 min-w-0">
                <div
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)` }}
                >
                  {settings.favicon_url ? (
                    <img src={settings.favicon_url} alt="Favicon" className="w-8 h-8" onError={(e) => e.currentTarget.style.display = 'none'} />
                  ) : (
                    <svg viewBox="0 0 24 24" className="w-8 h-8 text-white" fill="currentColor">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                    </svg>
                  )}
                </div>
                <div className="min-w-0 sm:flex-1">
                  <h2
                    className="text-xl sm:text-2xl font-bold truncate"
                    style={{
                      backgroundImage: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)`,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {settings.site_name}
                  </h2>
                  <p className="text-white/70 text-sm sm:text-base truncate">{settings.site_slogan}</p>
                  <Badge className="mt-2 bg-white/10 text-white/60">{settings.site_badge}</Badge>
                </div>
              </div>
              <div className="flex gap-2 sm:ml-auto flex-shrink-0">
                <Button
                  className="text-white"
                  style={{ background: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)` }}
                  size="sm"
                >
                  {settings.btn_start}
                </Button>
                <Button variant="outline" className="border-white/20 text-white/70" size="sm">
                  {settings.btn_login}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {[
            { id: 'identity', label: 'Identité', icon: <Type size={16} /> },
            { id: 'colors', label: 'Couleurs', icon: <Palette size={16} /> },
            { id: 'buttons', label: 'Boutons & Stats', icon: <Settings size={16} /> },
            { id: 'stripe', label: 'Clés Stripe', icon: <CreditCard size={16} /> },
            { id: 'credits', label: 'Crédits & Tarifs', icon: <Coins size={16} /> },
            { id: 'billetterie', label: 'Billetterie & Virements', icon: <Ticket size={16} /> },
            { id: 'access', label: 'Crédits offerts', icon: <Gift size={16} /> },
            { id: 'users', label: 'Utilisateurs', icon: <Users size={16} /> },
          ].map(tab => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? 'default' : 'outline'}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={activeTab === tab.id 
                ? 'bg-[var(--bt-accent)] text-white hover:bg-[var(--bt-accent)]' 
                : 'border-white/20 text-white/70 hover:bg-white/10'
              }
            >
              {tab.icon}
              <span className="ml-2">{tab.label}</span>
            </Button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'identity' && (
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Type size={20} />
                Identité du Site
              </CardTitle>
              <CardDescription className="text-white/50">
                Nom, slogan, description et favicon de votre plateforme
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <EditableField
                  label="Nom du site"
                  value={settings.site_name}
                  onChange={(v) => handleUpdate('site_name', v)}
                  placeholder="Boosttribe"
                />
                <EditableField
                  label="Slogan"
                  value={settings.site_slogan}
                  onChange={(v) => handleUpdate('site_slogan', v)}
                  placeholder="Unite Through Rhythm"
                />
              </div>
              <EditableField
                label="Description"
                value={settings.site_description}
                onChange={(v) => handleUpdate('site_description', v)}
                placeholder="Description de votre plateforme..."
              />
              <EditableField
                label="Badge (Hero Section)"
                value={settings.site_badge}
                onChange={(v) => handleUpdate('site_badge', v)}
                placeholder="La communauté des créateurs"
              />
              {/* Favicon paramétrable — vide = favicon par défaut (icône note de musique) */}
              <div className="space-y-1">
                <EditableField
                  label="Favicon (lien)"
                  value={settings.favicon_url}
                  onChange={(v) => handleUpdate('favicon_url', v)}
                  placeholder="https://… .png / .svg / .ico (vide = favicon par défaut)"
                />
                <p className="text-white/30 text-[11px]">Collez l'URL d'une image (png/svg/ico). Laissez vide pour utiliser le favicon par défaut du site.</p>
              </div>
              <Separator className="my-4 bg-white/10" />
              <EditableField
                label="URL du Favicon"
                value={settings.favicon_url}
                onChange={(v) => handleUpdate('favicon_url', v)}
                placeholder="https://example.com/favicon.ico"
                icon={<Image size={14} />}
                hint="URL directe vers une image .ico, .png ou .svg (32x32 ou 64x64 recommandé)"
              />
              {settings.favicon_url && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                  <span className="text-white/50 text-sm">Aperçu :</span>
                  <img 
                    src={settings.favicon_url} 
                    alt="Favicon preview" 
                    className="w-8 h-8"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  <span className="hidden text-red-400 text-xs">Image non chargée</span>
                </div>
              )}

              <Separator className="my-4 bg-white/10" />

              {/* 🖼️ Images d'accueil (carrousel) — upload / remplacer / ordonner (max 3) */}
              <div className="space-y-3">
                <div>
                  <Label className="text-white/80 flex items-center gap-2"><Image size={14} /> Images d'accueil (carrousel)</Label>
                  <p className="text-white/30 text-[11px] mt-0.5">Jusqu'à 3 images défilant sur la page d'accueil. JPEG/PNG/WebP/GIF. Sans image → la section est masquée.</p>
                </div>

                {(settings.home_carousel || []).map((img, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/5 border border-white/10">
                    <div className="w-16 h-10 rounded overflow-hidden bg-black/40 flex-shrink-0">
                      {img.url ? <img src={img.url} alt="" className="w-full h-full object-cover" /> : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Input
                        value={img.alt || ''}
                        onChange={(e) => updateCarouselAlt(i, e.target.value)}
                        placeholder={HOME_CAROUSEL_DEFAULT_ALTS[i] || 'Texte alternatif (optionnel)'}
                        className="h-8 text-xs bg-black/30 border-white/15 text-white"
                      />
                    </div>
                    <div className="flex flex-col flex-shrink-0">
                      <button onClick={() => moveCarousel(i, -1)} disabled={i === 0} className="p-0.5 text-white/50 hover:text-white disabled:opacity-20" title="Monter"><ChevronUp size={15} /></button>
                      <button onClick={() => moveCarousel(i, 1)} disabled={i === (settings.home_carousel?.length || 0) - 1} className="p-0.5 text-white/50 hover:text-white disabled:opacity-20" title="Descendre"><ChevronDown size={15} /></button>
                    </div>
                    <label className="flex-shrink-0 cursor-pointer p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10" title="Remplacer">
                      {carouselUploading === i ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCarouselUpload(i, f); e.currentTarget.value = ''; }} />
                    </label>
                    <button onClick={() => removeCarousel(i)} className="flex-shrink-0 p-1.5 rounded text-red-400 hover:text-white hover:bg-red-500/30" title="Retirer"><Trash2 size={15} /></button>
                  </div>
                ))}

                {(settings.home_carousel?.length || 0) < 3 && (
                  <label className="flex items-center justify-center gap-2 cursor-pointer p-2.5 rounded-lg border border-dashed border-white/20 text-white/60 hover:text-white hover:border-white/40 text-sm">
                    {carouselUploading === (settings.home_carousel?.length || 0) ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                    Ajouter une image
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCarouselUpload(settings.home_carousel?.length || 0, f); e.currentTarget.value = ''; }} />
                  </label>
                )}
              </div>

              <Separator className="my-4 bg-white/10" />

              {/* 🎬 Hero plein écran (vidéo) — URL vidéo + image poster/secours (façon Apple) */}
              <div className="space-y-3">
                <div>
                  <Label className="text-white/80 flex items-center gap-2"><Video size={14} /> Hero plein écran (vidéo)</Label>
                  <p className="text-white/30 text-[11px] mt-0.5">
                    URL d'une vidéo (mp4/webm) affichée en plein écran sur l'accueil (autoplay, muet, en boucle).
                    <strong className="text-white/50"> Vide</strong> → la 1ʳᵉ image du carrousel sert de fond (zoom lent).
                  </p>
                </div>
                <div>
                  <Label className="text-white/60 text-xs">URL de la vidéo (mp4/webm)</Label>
                  <Input
                    value={settings.hero_video_url || ''}
                    onChange={(e) => setSettings(prev => ({ ...prev, hero_video_url: e.target.value }))}
                    placeholder="https://…/hero.mp4"
                    className="h-9 text-sm bg-black/30 border-white/15 text-white"
                    data-testid="hero-video-url"
                  />
                </div>
                <div>
                  <Label className="text-white/60 text-xs">Image poster / secours (optionnelle)</Label>
                  <Input
                    value={settings.hero_poster_url || ''}
                    onChange={(e) => setSettings(prev => ({ ...prev, hero_poster_url: e.target.value }))}
                    placeholder="https://…/hero-poster.jpg"
                    className="h-9 text-sm bg-black/30 border-white/15 text-white"
                    data-testid="hero-poster-url"
                  />
                  <p className="text-white/30 text-[11px] mt-0.5">Affichée pendant le chargement de la vidéo et en cas d'échec.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'colors' && (
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Palette size={20} />
                Palette de Couleurs
              </CardTitle>
              <CardDescription className="text-white/50">
                Couleurs principales de l'interface (format hexadécimal #RRGGBB)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <EditableField
                  label="Couleur Primaire"
                  value={settings.color_primary}
                  onChange={(v) => handleUpdate('color_primary', v)}
                  placeholder="#7A5CFF"
                  isColor
                />
                <EditableField
                  label="Couleur Secondaire"
                  value={settings.color_secondary}
                  onChange={(v) => handleUpdate('color_secondary', v)}
                  placeholder="#E24A9E"
                  isColor
                />
                <EditableField
                  label="Arrière-plan"
                  value={settings.color_background}
                  onChange={(v) => handleUpdate('color_background', v)}
                  placeholder="#000000"
                  isColor
                />
              </div>
              <Separator className="my-6 bg-white/10" />
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <h4 className="text-white/70 text-sm mb-3">Aperçu du dégradé</h4>
                <div 
                  className="h-16 rounded-lg"
                  style={{ background: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)` }}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'buttons' && (
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Settings size={20} />
                Boutons & Statistiques
              </CardTitle>
              <CardDescription className="text-white/50">
                Textes des boutons et statistiques affichées
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="text-white font-medium mb-4">Labels des boutons</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <EditableField label="Login" value={settings.btn_login} onChange={(v) => handleUpdate('btn_login', v)} placeholder="Connexion" />
                  <EditableField label="Commencer" value={settings.btn_start} onChange={(v) => handleUpdate('btn_start', v)} placeholder="Commencer" />
                  <EditableField label="Rejoindre" value={settings.btn_join} onChange={(v) => handleUpdate('btn_join', v)} placeholder="Rejoindre la tribu" />
                  <EditableField label="Explorer" value={settings.btn_explore} onChange={(v) => handleUpdate('btn_explore', v)} placeholder="Explorer les beats" />
                </div>
              </div>
              <Separator className="bg-white/10" />
              <div>
                <h4 className="text-white font-medium mb-4">Statistiques Hero</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <EditableField label="Créateurs" value={settings.stat_creators} onChange={(v) => handleUpdate('stat_creators', v)} placeholder="50K+" />
                  <EditableField label="Beats partagés" value={settings.stat_beats} onChange={(v) => handleUpdate('stat_beats', v)} placeholder="1M+" />
                  <EditableField label="Pays" value={settings.stat_countries} onChange={(v) => handleUpdate('stat_countries', v)} placeholder="120+" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'stripe' && (
          <>
          {/* PARTIE C : Clés API Stripe (publique + secrète chiffrée serveur) */}
          <Card className="border-white/10 bg-white/5 mb-6">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <KeyRound size={20} className="text-[var(--bt-accent)]" />
                Clés API Stripe
              </CardTitle>
              <CardDescription className="text-white/50">
                La clé publique (pk_…) est utilisée par le site. La clé secrète (sk_…) est chiffrée et stockée
                côté serveur — jamais exposée au navigateur.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Clé publique */}
              <div className="space-y-2">
                <Label className="text-white/70">Clé publique (pk_…)</Label>
                <Input
                  value={stripePubKey}
                  onChange={(e) => setStripePubKey(e.target.value)}
                  placeholder="pk_live_..."
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30 font-mono text-sm"
                />
              </div>

              {/* Clé secrète */}
              <div className="space-y-2">
                <Label className="text-white/70 flex items-center gap-2">
                  Clé secrète (sk_…)
                  {stripeSecretConfigured && (
                    <span className="flex items-center gap-1 text-green-400 text-xs"><ShieldCheck size={13} /> Configurée{stripeSecretSource === 'env' ? ' (env)' : ''}</span>
                  )}
                </Label>
                <Input
                  type="password"
                  value={stripeSecretInput}
                  onChange={(e) => setStripeSecretInput(e.target.value)}
                  placeholder={stripeSecretConfigured ? `sk_live_••••${stripeSecretLast4}` : 'sk_live_...'}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30 font-mono text-sm"
                  autoComplete="off"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline" size="sm"
                    onClick={handleRevealSecret}
                    disabled={!stripeSecretConfigured}
                    className="border-white/20 text-white/70"
                  >
                    {revealedSecret ? <EyeOff size={14} className="mr-1" /> : <Eye size={14} className="mr-1" />}
                    {revealedSecret ? 'Masquer' : 'Révéler'}
                  </Button>
                  {revealedSecret && (
                    <code className="px-2 py-1 rounded bg-black/40 text-green-300 text-xs font-mono break-all">{revealedSecret}</code>
                  )}
                </div>
                <p className="text-white/30 text-[11px]">La clé secrète n'est jamais stockée dans le navigateur. « Révéler » la récupère ponctuellement via le backend (token admin).</p>
              </div>

              <Button
                onClick={handleSaveStripeKeys}
                disabled={keysSaving || keysLoading}
                className="text-white border-none"
                style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
              >
                <Save size={16} className="mr-1.5" />
                {keysSaving ? 'Enregistrement…' : 'Enregistrer les clés'}
              </Button>
            </CardContent>
          </Card>

          {/* 📱 PawaPay — Mobile Money (Orange, MTN, Moov, Wave, M-Pesa, Airtel…). En PARALLÈLE de Stripe. */}
          <Card className="border-white/10 bg-white/5 mb-6">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <KeyRound size={20} className="text-[#F5A524]" />
                PawaPay — Mobile Money
              </CardTitle>
              <CardDescription className="text-white/50">
                Paiement mobile money (Afrique) en parallèle de Stripe. Le token API est chiffré côté serveur.
                Bascule sandbox/prod via la base URL. Callback à déclarer dans le dashboard PawaPay :
                <span className="text-white/70 font-mono"> {`{BACKEND_URL}`}/pawapay/callback</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-white/70 flex items-center gap-2">
                  Token API
                  {ppState?.token_configured && (
                    <span className="flex items-center gap-1 text-green-400 text-xs"><ShieldCheck size={13} /> Configuré{ppState.token_source === 'env' ? ' (env)' : ''} ••••{ppState.token_last4}</span>
                  )}
                </Label>
                <Input type="password" value={ppTokenInput} onChange={(e) => setPpTokenInput(e.target.value)} placeholder={ppState?.token_configured ? `••••${ppState.token_last4}` : 'token PawaPay (sandbox ou prod)'} className="bg-white/5 border-white/10 text-white placeholder:text-white/30 font-mono text-sm" autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label className="text-white/70 flex items-center gap-2">
                  Base URL
                  {ppState && <span className={`text-xs ${ppState.is_sandbox ? 'text-amber-400' : 'text-green-400'}`}>{ppState.is_sandbox ? 'sandbox' : 'production'}</span>}
                </Label>
                <Input value={ppBaseUrl} onChange={(e) => setPpBaseUrl(e.target.value)} placeholder="https://api.sandbox.pawapay.io" className="bg-white/5 border-white/10 text-white placeholder:text-white/30 font-mono text-sm" />
                <p className="text-white/30 text-[11px]">Sandbox : <span className="font-mono">https://api.sandbox.pawapay.io</span> · Prod : <span className="font-mono">https://api.pawapay.io</span> (le token diffère entre les deux).</p>
              </div>
              <div className="space-y-2">
                <Label className="text-white/70">Taux de change CHF → devise locale (JSON)</Label>
                <textarea
                  value={ppFxText}
                  onChange={(e) => setPpFxText(e.target.value)}
                  rows={6}
                  spellCheck={false}
                  placeholder={'{\n  "XOF": 655,\n  "GHS": 16\n}'}
                  className="w-full rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/30 font-mono text-xs p-3"
                />
                <p className="text-white/30 text-[11px]">⚠️ Taux indicatifs par défaut — mets tes taux réels avant d'encaisser. XOF/XAF sans décimales.</p>
              </div>
              <Button
                onClick={handleSavePawapayKeys}
                disabled={ppSaving}
                className="text-white border-none"
                style={{ background: 'linear-gradient(135deg, #F5A524 0%, #FF7A00 100%)' }}
              >
                <Save size={16} className="mr-1.5" />
                {ppSaving ? 'Enregistrement…' : 'Enregistrer PawaPay'}
              </Button>
            </CardContent>
          </Card>

          {/* Clé IA (OpenAI) — transcription + résumé des enregistrements */}
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <KeyRound size={20} />
                Clé IA (OpenAI) — Transcription
              </CardTitle>
              <CardDescription className="text-white/50">
                Utilisée pour transcrire et résumer les sessions enregistrées. La clé (sk-…) est chiffrée et
                stockée côté serveur — jamais exposée au navigateur.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-white/70 flex items-center gap-2">
                  Clé OpenAI (sk-…)
                  {aiKeyConfigured && (
                    <span className="flex items-center gap-1 text-green-400 text-xs"><ShieldCheck size={13} /> Configurée{aiKeySource === 'env' ? ' (env)' : ''}{aiKeyLast4 ? ` ••••${aiKeyLast4}` : ''}</span>
                  )}
                </Label>
                <Input
                  type="password"
                  value={aiKeyInput}
                  onChange={(e) => setAiKeyInput(e.target.value)}
                  placeholder={aiKeyConfigured ? `sk-••••${aiKeyLast4}` : 'sk-...'}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30 font-mono text-sm"
                  autoComplete="off"
                />
                <p className="text-white/30 text-[11px]">La clé n'est jamais stockée dans le navigateur ni renvoyée en clair.</p>
              </div>
              <Button
                onClick={handleSaveAiKey}
                disabled={aiKeySaving || !aiKeyInput.trim()}
                className="text-white border-none"
                style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
              >
                <Save size={16} className="mr-1.5" />
                {aiKeySaving ? 'Enregistrement…' : 'Enregistrer la clé IA'}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <CreditCard size={20} />
                Liens de Paiement Stripe
              </CardTitle>
              <CardDescription className="text-white/50">
                Configurez vos liens Stripe Payment Links
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Pro Plan */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-4">
                  <Zap size={20} className="text-green-400" />
                  <h3 className="text-white font-semibold">Plan Pro</h3>
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">9.99€/mois</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white/70">Lien Mensuel</Label>
                    <div className="flex gap-2">
                      <Input 
                        value={settings.stripe_pro_monthly}
                        onChange={(e) => handleUpdate('stripe_pro_monthly', e.target.value)}
                        placeholder="https://buy.stripe.com/..."
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                      />
                      {settings.stripe_pro_monthly && (
                        <Button variant="outline" size="icon" onClick={() => window.open(settings.stripe_pro_monthly, '_blank')} className="border-white/20 text-white/70">
                          <ExternalLink size={16} />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/70">Lien Annuel</Label>
                    <div className="flex gap-2">
                      <Input 
                        value={settings.stripe_pro_yearly}
                        onChange={(e) => handleUpdate('stripe_pro_yearly', e.target.value)}
                        placeholder="https://buy.stripe.com/..."
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                      />
                      {settings.stripe_pro_yearly && (
                        <Button variant="outline" size="icon" onClick={() => window.open(settings.stripe_pro_yearly, '_blank')} className="border-white/20 text-white/70">
                          <ExternalLink size={16} />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Enterprise Plan */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 size={20} className="text-[var(--bt-accent)]" />
                  <h3 className="text-white font-semibold">Plan Enterprise</h3>
                  <Badge className="bg-[rgb(var(--bt-accent-rgb)/0.2)] text-[var(--bt-accent)] border-[rgb(var(--bt-accent-rgb)/0.3)]">29.99€/mois</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white/70">Lien Mensuel</Label>
                    <div className="flex gap-2">
                      <Input 
                        value={settings.stripe_enterprise_monthly}
                        onChange={(e) => handleUpdate('stripe_enterprise_monthly', e.target.value)}
                        placeholder="https://buy.stripe.com/..."
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                      />
                      {settings.stripe_enterprise_monthly && (
                        <Button variant="outline" size="icon" onClick={() => window.open(settings.stripe_enterprise_monthly, '_blank')} className="border-white/20 text-white/70">
                          <ExternalLink size={16} />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/70">Lien Annuel</Label>
                    <div className="flex gap-2">
                      <Input 
                        value={settings.stripe_enterprise_yearly}
                        onChange={(e) => handleUpdate('stripe_enterprise_yearly', e.target.value)}
                        placeholder="https://buy.stripe.com/..."
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                      />
                      {settings.stripe_enterprise_yearly && (
                        <Button variant="outline" size="icon" onClick={() => window.open(settings.stripe_enterprise_yearly, '_blank')} className="border-white/20 text-white/70">
                          <ExternalLink size={16} />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          </>
        )}

        {/* Plans & Prix Tab */}
        {activeTab === 'plans' && (
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <DollarSign size={20} />
                Plans & Prix
              </CardTitle>
              <CardDescription className="text-white/50">
                Gérez la visibilité et les prix de vos plans d'abonnement.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Plan Pro */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Zap size={20} className="text-yellow-400" />
                    <h3 className="text-white font-semibold">{settings.plan_pro_label || 'Utilisateur'}</h3>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-white/70 text-sm">Visible</span>
                    <button
                      type="button"
                      onClick={() => {
                        handleUpdate('plan_pro_visible', !settings.plan_pro_visible ? 'true' : 'false');
                        setSettings(prev => ({ ...prev, plan_pro_visible: !prev.plan_pro_visible }));
                      }}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        settings.plan_pro_visible ? 'bg-green-500' : 'bg-white/20'
                      }`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        settings.plan_pro_visible ? 'translate-x-6' : ''
                      }`} />
                    </button>
                    {settings.plan_pro_visible ? (
                      <Eye size={16} className="text-green-400" />
                    ) : (
                      <EyeOff size={16} className="text-white/40" />
                    )}
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-white/70">Libellé affiché</Label>
                    <Input
                      value={settings.plan_pro_label}
                      onChange={(e) => handleUpdate('plan_pro_label', e.target.value)}
                      placeholder="Utilisateur"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/70">Prix Mensuel (€)</Label>
                    <Input
                      value={settings.plan_pro_price_monthly}
                      onChange={(e) => handleUpdate('plan_pro_price_monthly', e.target.value)}
                      placeholder="9.99"
                      type="number"
                      step="0.01"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/70">Prix Annuel (€)</Label>
                    <Input
                      value={settings.plan_pro_price_yearly}
                      onChange={(e) => handleUpdate('plan_pro_price_yearly', e.target.value)}
                      placeholder="99.99"
                      type="number"
                      step="0.01"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                    />
                  </div>
                </div>
              </div>

              {/* Plan Enterprise */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Building2 size={20} className="text-[var(--bt-accent)]" />
                    <h3 className="text-white font-semibold">{settings.plan_enterprise_label || 'Coach'}</h3>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-white/70 text-sm">Visible</span>
                    <button
                      type="button"
                      onClick={() => {
                        handleUpdate('plan_enterprise_visible', !settings.plan_enterprise_visible ? 'true' : 'false');
                        setSettings(prev => ({ ...prev, plan_enterprise_visible: !prev.plan_enterprise_visible }));
                      }}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        settings.plan_enterprise_visible ? 'bg-green-500' : 'bg-white/20'
                      }`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        settings.plan_enterprise_visible ? 'translate-x-6' : ''
                      }`} />
                    </button>
                    {settings.plan_enterprise_visible ? (
                      <Eye size={16} className="text-green-400" />
                    ) : (
                      <EyeOff size={16} className="text-white/40" />
                    )}
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-white/70">Libellé affiché</Label>
                    <Input
                      value={settings.plan_enterprise_label}
                      onChange={(e) => handleUpdate('plan_enterprise_label', e.target.value)}
                      placeholder="Coach"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/70">Prix Mensuel (€)</Label>
                    <Input
                      value={settings.plan_enterprise_price_monthly}
                      onChange={(e) => handleUpdate('plan_enterprise_price_monthly', e.target.value)}
                      placeholder="29.99"
                      type="number"
                      step="0.01"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/70">Prix Annuel (€)</Label>
                    <Input
                      value={settings.plan_enterprise_price_yearly}
                      onChange={(e) => handleUpdate('plan_enterprise_price_yearly', e.target.value)}
                      placeholder="299.99"
                      type="number"
                      step="0.01"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                    />
                  </div>
                </div>
              </div>

              {/* Language */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-4">
                  <Globe size={20} className="text-blue-400" />
                  <h3 className="text-white font-semibold">Langue par défaut</h3>
                </div>
                <div className="flex gap-2">
                  {[
                    { code: 'fr', label: '🇫🇷 Français' },
                    { code: 'en', label: '🇬🇧 English' },
                    { code: 'de', label: '🇩🇪 Deutsch' },
                  ].map(lang => (
                    <Button
                      key={lang.code}
                      variant={settings.default_language === lang.code ? 'default' : 'outline'}
                      onClick={() => {
                        handleUpdate('default_language', lang.code);
                        setSettings(prev => ({ ...prev, default_language: lang.code }));
                      }}
                      className={settings.default_language === lang.code 
                        ? 'bg-blue-500 text-white' 
                        : 'border-white/20 text-white/70'
                      }
                    >
                      {lang.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* 3b) Essai gratuit → paiement automatique (Stripe récurrent) */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <CreditCard size={20} style={{ color: 'var(--bt-accent)' }} />
                  <h3 className="text-white font-semibold">Essai gratuit → paiement automatique</h3>
                </div>
                <p className="text-white/50 text-sm mb-4">
                  Essai gratuit ILLIMITÉ pendant la durée choisie, puis débit automatique de l'offre
                  sélectionnée (Utilisateur ou Coach). La carte bancaire est demandée dès l'inscription.
                </p>
                {trialLoading ? (
                  <p className="text-white/40 text-sm py-2">Chargement…</p>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-white/70">Durée de l'essai (jours)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={trialConfig.trial_days}
                          onChange={(e) => setTrialConfig((prev) => ({ ...prev, trial_days: parseInt(e.target.value) || 0 }))}
                          placeholder="14"
                          className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-white/70">Paiement automatique après l'essai</Label>
                        <label className="flex items-center gap-3 cursor-pointer h-10">
                          <button
                            type="button"
                            onClick={() => setTrialConfig((prev) => ({ ...prev, auto_charge_enabled: !prev.auto_charge_enabled }))}
                            className="relative w-12 h-6 rounded-full transition-colors"
                            style={{ background: trialConfig.auto_charge_enabled ? 'var(--bt-accent)' : 'rgba(255,255,255,0.2)' }}
                          >
                            <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${trialConfig.auto_charge_enabled ? 'translate-x-6' : ''}`} />
                          </button>
                          <span className="text-white/70 text-sm">
                            {trialConfig.auto_charge_enabled ? 'Activé (Stripe)' : 'Désactivé'}
                          </span>
                        </label>
                      </div>
                    </div>
                    <p className="text-white/40 text-xs">
                      Essai gratuit ILLIMITÉ de {trialConfig.trial_days} jours, puis débit automatique
                      de l'offre choisie (carte demandée à l'inscription) si l'option est activée.
                    </p>
                    <Button
                      onClick={handleSaveTrialConfig}
                      disabled={savingTrial}
                      className="text-white border-none"
                      style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                    >
                      <Save size={16} className="mr-2" />
                      {savingTrial ? 'Enregistrement…' : "Enregistrer l'essai gratuit"}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* POINT 6 : Accès offerts Tab */}
        {/* 💳 Crédits & Tarifs : packs + réglages (tout éditable) */}
        {activeTab === 'credits' && (
          <div className="space-y-6">
            {/* Réglages globaux */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Settings size={20} style={{ color: 'var(--bt-accent-2)' }} />
                  Réglages des crédits
                </CardTitle>
                <CardDescription className="text-white/50">
                  Coût d'un accès, validité, 1er cours offert, offres et services affichés. 1 crédit = 1 accès à un live.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {creditCfgLoading || !pricingSettings ? (
                  <p className="text-white/40 text-sm py-4 text-center">Chargement…</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div>
                        <Label className="text-white/70">Coût rejoindre</Label>
                        <Input type="number" min={0} value={pricingSettings.cost_join}
                          onChange={(e) => setPricingSettings({ ...pricingSettings, cost_join: parseInt(e.target.value) || 0 })}
                          className="bg-white/5 border-white/10 text-white" />
                      </div>
                      <div>
                        <Label className="text-white/70">Coût animer</Label>
                        <Input type="number" min={0} value={pricingSettings.cost_host}
                          onChange={(e) => setPricingSettings({ ...pricingSettings, cost_host: parseInt(e.target.value) || 0 })}
                          className="bg-white/5 border-white/10 text-white" />
                      </div>
                      <div>
                        <Label className="text-white/70">Validité (mois)</Label>
                        <Input type="number" min={1} value={pricingSettings.credit_validity_months}
                          onChange={(e) => setPricingSettings({ ...pricingSettings, credit_validity_months: parseInt(e.target.value) || 1 })}
                          className="bg-white/5 border-white/10 text-white" />
                      </div>
                      <div>
                        <Label className="text-white/70">1er cours offert</Label>
                        <Input type="number" min={0} value={pricingSettings.signup_free_credits}
                          onChange={(e) => setPricingSettings({ ...pricingSettings, signup_free_credits: parseInt(e.target.value) || 0 })}
                          className="bg-white/5 border-white/10 text-white" />
                      </div>
                      <div>
                        <Label className="text-white/70">Enregistrement + IA (crédits)</Label>
                        <Input type="number" min={0} value={pricingSettings.cost_record_transcribe}
                          onChange={(e) => setPricingSettings({ ...pricingSettings, cost_record_transcribe: parseInt(e.target.value) || 0 })}
                          className="bg-white/5 border-white/10 text-white" />
                      </div>
                      <div>
                        <Label className="text-white/70">Crédits/mois offre Utilisateur</Label>
                        <Input type="number" min={0} value={pricingSettings?.plan_pro_monthly_credits ?? 20}
                          onChange={(e) => setPricingSettings(s => s ? { ...s, plan_pro_monthly_credits: Number(e.target.value) } : s)}
                          className="bg-white/5 border-white/10 text-white" />
                        <p className="text-white/40 text-xs mt-1">Crédités à chaque facture payée (× 12 si annuel)</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-white/70">Services affichés sur la page tarifaire</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {ALL_SERVICES.map((s) => {
                          const on = (pricingSettings.services_shown || []).includes(s.key);
                          return (
                            <Button key={s.key} size="sm" variant={on ? 'default' : 'outline'}
                              onClick={() => toggleService(s.key)}
                              className={on ? 'text-white border-0' : 'border-white/20 text-white/70'}
                              style={on ? { background: 'linear-gradient(135deg,var(--bt-accent),var(--bt-accent-2))' } : {}}>
                              {on ? <Check size={14} className="mr-1" /> : null}{s.label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <Label className="text-white/70">Offres affichées</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {Object.entries(pricingSettings.offers || {}).map(([key, o]: [string, any]) => (
                          <Button key={key} size="sm" variant={o?.enabled ? 'default' : 'outline'}
                            onClick={() => toggleOffer(key)}
                            className={o?.enabled ? 'text-white border-0' : 'border-white/20 text-white/70'}
                            style={o?.enabled ? { background: 'linear-gradient(135deg,var(--bt-accent),var(--bt-accent-2))' } : {}}>
                            {o?.enabled ? <Check size={14} className="mr-1" /> : null}{o?.title || key}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <Button onClick={handleSavePricingSettings} disabled={savingSettings}
                      className="text-white border-0" style={{ background: 'linear-gradient(135deg,var(--bt-accent),var(--bt-accent-2))' }}>
                      <Save size={16} className="mr-2" />{savingSettings ? 'Enregistrement…' : 'Enregistrer les réglages'}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Packs */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Coins size={20} style={{ color: 'var(--bt-accent-2)' }} />
                  Packs de crédits
                </CardTitle>
                <CardDescription className="text-white/50">
                  Crée, modifie, supprime et ordonne les packs proposés sur la page tarifaire (en CHF).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Éditeur de pack */}
                <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-4">
                  <h3 className="text-white font-medium">{packDraft.id ? 'Modifier le pack' : 'Nouveau pack'}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-white/70">Nom</Label>
                      <Input value={packDraft.name || ''} onChange={(e) => setPackDraft({ ...packDraft, name: e.target.value })}
                        placeholder="Découverte" className="bg-white/5 border-white/10 text-white" />
                    </div>
                    <div>
                      <Label className="text-white/70">Audience</Label>
                      <div className="flex gap-2 mt-1">
                        {(['participant', 'creator'] as const).map((a) => (
                          <Button key={a} size="sm" variant={packDraft.audience === a ? 'default' : 'outline'}
                            onClick={() => setPackDraft({ ...packDraft, audience: a })}
                            className={packDraft.audience === a ? 'bg-[var(--bt-accent)] text-white' : 'border-white/20 text-white/70'}>
                            {a === 'participant' ? 'Participer' : 'Animer'}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label className="text-white/70">Crédits</Label>
                      <Input type="number" min={1} value={packDraft.credits ?? 1}
                        onChange={(e) => setPackDraft({ ...packDraft, credits: parseInt(e.target.value) || 1 })}
                        className="bg-white/5 border-white/10 text-white" />
                    </div>
                    <div>
                      <Label className="text-white/70">Prix (CHF)</Label>
                      <Input type="number" min={0} step="0.5" value={packDraft.price_chf ?? 0}
                        onChange={(e) => setPackDraft({ ...packDraft, price_chf: parseFloat(e.target.value) || 0 })}
                        className="bg-white/5 border-white/10 text-white" />
                    </div>
                    <div>
                      <Label className="text-white/70">Ordre</Label>
                      <Input type="number" value={packDraft.sort ?? 0}
                        onChange={(e) => setPackDraft({ ...packDraft, sort: parseInt(e.target.value) || 0 })}
                        className="bg-white/5 border-white/10 text-white" />
                    </div>
                    <div className="flex items-end gap-4">
                      <label className="flex items-center gap-2 text-white/70 text-sm cursor-pointer">
                        <input type="checkbox" checked={!!packDraft.is_highlighted}
                          onChange={(e) => setPackDraft({ ...packDraft, is_highlighted: e.target.checked })} />
                        Populaire
                      </label>
                      <label className="flex items-center gap-2 text-white/70 text-sm cursor-pointer">
                        <input type="checkbox" checked={packDraft.active !== false}
                          onChange={(e) => setPackDraft({ ...packDraft, active: e.target.checked })} />
                        Actif
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleSavePack} className="text-white border-0"
                      style={{ background: 'linear-gradient(135deg,var(--bt-accent),var(--bt-accent-2))' }}>
                      <Plus size={16} className="mr-2" />{packDraft.id ? 'Mettre à jour' : 'Créer le pack'}
                    </Button>
                    {packDraft.id && (
                      <Button variant="outline" onClick={() => setPackDraft(blankPack)} className="border-white/20 text-white/70">
                        Annuler
                      </Button>
                    )}
                  </div>
                </div>

                {/* Liste des packs */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-white font-medium">Packs ({creditPacks.length})</h3>
                    <Button size="sm" variant="outline" onClick={refreshCreditConfig} className="border-white/20 text-white/70">
                      <RefreshCw size={14} className="mr-1" /> Actualiser
                    </Button>
                  </div>
                  {creditPacks.length === 0 ? (
                    <p className="text-white/40 text-sm py-4 text-center">Aucun pack. Créez-en un ci-dessus.</p>
                  ) : (
                    <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                      {creditPacks.map((p) => (
                        <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                          <div className="min-w-0">
                            <p className="text-white text-sm truncate">
                              {p.name} {p.is_highlighted && <span className="text-xs" style={{ color: 'var(--bt-accent-2)' }}>★</span>}
                              {!p.active && <span className="text-white/30 text-xs ml-1">(inactif)</span>}
                            </p>
                            <p className="text-white/50 text-xs">
                              {p.credits} crédit(s) · {Number(p.price_chf).toFixed(2)} CHF · {p.audience === 'creator' ? 'Animer' : 'Participer'} · ordre {p.sort}
                            </p>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <Button size="sm" variant="outline" onClick={() => setPackDraft(p)} className="border-white/20 text-white/70">
                              Modifier
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleDeletePack(p)}
                              className="border-red-500/30 text-red-400 hover:bg-red-500/10">
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 🎟️ Billetterie & Commission + Virements (admin) */}
        {activeTab === 'billetterie' && (
          <div className="space-y-6">
            {/* Réglages commission */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Percent size={20} style={{ color: 'var(--bt-accent-2)' }} /> Billetterie & Commission
                </CardTitle>
                <CardDescription className="text-white/60">
                  Réglages des sessions payantes. Modifiable sans code — s'applique en direct.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {billLoading && !commission ? (
                  <p className="text-white/50 text-sm">Chargement…</p>
                ) : commission ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-white/80">Commission plateforme (%)</Label>
                        <Input type="number" min={0} max={100} step={0.5}
                          value={commission.commission_percent}
                          onChange={(e) => setCommission({ ...commission, commission_percent: Number(e.target.value) })}
                          className="bg-black/30 border-white/15 text-white" />
                      </div>
                      <div>
                        <Label className="text-white/80">Devise</Label>
                        <Input value={commission.currency || 'CHF'} disabled
                          className="bg-black/20 border-white/10 text-white/60" />
                      </div>
                      <div>
                        <Label className="text-white/80">Prix minimum (CHF)</Label>
                        <Input type="number" min={0} step={1}
                          value={commission.price_min_chf}
                          onChange={(e) => setCommission({ ...commission, price_min_chf: Number(e.target.value) })}
                          className="bg-black/30 border-white/15 text-white" />
                      </div>
                      <div>
                        <Label className="text-white/80">Prix maximum (CHF)</Label>
                        <Input type="number" min={0} step={1}
                          value={commission.price_max_chf}
                          onChange={(e) => setCommission({ ...commission, price_max_chf: Number(e.target.value) })}
                          className="bg-black/30 border-white/15 text-white" />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-white/80">Abonnement « Coach Illimité » (CHF / mois)</Label>
                        <Input type="number" min={0} step={0.01}
                          value={commission.coach_sub_price_chf ?? 99.99}
                          onChange={(e) => setCommission({ ...commission, coach_sub_price_chf: Number(e.target.value) })}
                          className="bg-black/30 border-white/15 text-white" />
                        <p className="text-white/40 text-xs mt-1">Crédits illimités + 0% de commission pour les coachs abonnés.</p>
                      </div>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={commission.fees_included}
                        onChange={(e) => setCommission({ ...commission, fees_included: e.target.checked })}
                        className="w-4 h-4 accent-[var(--bt-accent)]" />
                      <span className="text-white/80 text-sm">
                        « Tout compris » — les frais Stripe sont absorbés par la commission (le coach reçoit prix − commission)
                      </span>
                    </label>

                    {/* Offre de lancement */}
                    <div className="rounded-xl border border-white/10 p-4 space-y-3" style={{ background: 'rgba(217,28,210,0.06)' }}>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={commission.launch_offer?.active}
                          onChange={(e) => setCommission({ ...commission, launch_offer: { ...commission.launch_offer, active: e.target.checked } })}
                          className="w-4 h-4 accent-[var(--bt-accent)]" />
                        <span className="text-white font-medium text-sm">Offre de lancement (commission réduite pour les nouveaux coachs)</span>
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-white/80">Commission pendant l'offre (%)</Label>
                          <Input type="number" min={0} max={100} step={0.5}
                            value={commission.launch_offer?.percent ?? 0}
                            onChange={(e) => setCommission({ ...commission, launch_offer: { ...commission.launch_offer, percent: Number(e.target.value) } })}
                            className="bg-black/30 border-white/15 text-white" />
                        </div>
                        <div>
                          <Label className="text-white/80">Durée (jours depuis la 1re vente)</Label>
                          <Input type="number" min={1} step={1}
                            value={commission.launch_offer?.days ?? 30}
                            onChange={(e) => setCommission({ ...commission, launch_offer: { ...commission.launch_offer, days: Number(e.target.value) } })}
                            className="bg-black/30 border-white/15 text-white" />
                        </div>
                      </div>
                    </div>

                    <PrimaryButton onClick={handleSaveCommission} disabled={savingCommission}>
                      <Save size={16} className="mr-2" />
                      {savingCommission ? 'Enregistrement…' : 'Enregistrer les réglages'}
                    </PrimaryButton>
                  </>
                ) : (
                  <p className="text-white/50 text-sm">Réglages indisponibles.</p>
                )}
              </CardContent>
            </Card>

            {/* Coachs — type de paiement (par coach) */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Crown size={20} style={{ color: 'var(--bt-accent-2)' }} /> Coachs — type de paiement
                </CardTitle>
                <CardDescription className="text-white/60">
                  Défaut : Abonnement (crédits illimités + 0% commission). « Commission » = billetterie IBAN avec commission.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-3">
                  <Input
                    value={coachQuery}
                    onChange={(e) => setCoachQuery(e.target.value)}
                    placeholder="Rechercher un coach (email)…"
                    className="bg-black/30 border-white/15 text-white"
                  />
                </div>
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {coaches
                    .filter((c) => !coachQuery || (c.email || '').toLowerCase().includes(coachQuery.toLowerCase()))
                    .slice(0, 100)
                    .map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
                        <div className="min-w-0">
                          <p className="text-white text-sm font-medium truncate">{c.email || c.id}</p>
                          <p className="text-white/50 text-xs">
                            {c.coach_payment_type === 'subscription'
                              ? (c.subscription_active ? '💎 Abo actif (illimité)' : 'Abo — non actif')
                              : 'Commission'}
                            {c.current_period_end && c.subscription_active ? ` · jusqu'au ${new Date(c.current_period_end).toLocaleDateString('fr-CH')}` : ''}
                          </p>
                        </div>
                        <select
                          value={c.coach_payment_type}
                          onChange={(e) => handleSetCoachType(c, e.target.value as 'subscription' | 'commission')}
                          className="bg-black/40 border border-white/15 text-white text-sm rounded-lg px-2 py-1.5"
                        >
                          <option value="subscription">Abonnement (illimité)</option>
                          <option value="commission">Commission (IBAN)</option>
                        </select>
                      </div>
                    ))}
                  {coaches.length === 0 && <p className="text-white/50 text-sm">Aucun compte.</p>}
                </div>
              </CardContent>
            </Card>

            {/* Virements demandés */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <DollarSign size={20} style={{ color: 'var(--bt-accent-2)' }} /> Virements demandés
                  {payoutsPending > 0 && (
                    <Badge className="ml-2" style={{ background: 'var(--bt-accent)', color: '#fff' }}>
                      {payoutsPending.toFixed(2)} CHF en attente
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-white/60">
                  « Marquer comme payé » déduit le solde du coach après votre virement bancaire manuel.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {payouts.length === 0 ? (
                  <p className="text-white/50 text-sm">Aucune demande de virement.</p>
                ) : (
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {payouts.map((p) => (
                      <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
                        <div className="min-w-0">
                          <p className="text-white text-sm font-medium truncate">{p.coach_email || p.coach_name || p.user_id}</p>
                          <p className="text-white/50 text-xs">
                            {new Date(p.created_at).toLocaleString('fr-CH')} · IBAN {p.iban || '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-white font-semibold">{Number(p.amount_chf).toFixed(2)} CHF</span>
                          {p.status === 'requested' ? (
                            <>
                              <Button size="sm" onClick={() => handleMarkPayoutPaid(p)}
                                className="bg-green-600 hover:bg-green-700 text-white">
                                <Check size={14} className="mr-1" /> Payé
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleRejectPayout(p)}
                                className="border-white/20 text-white/70 hover:bg-red-500/20 hover:text-red-300">
                                <X size={14} />
                              </Button>
                            </>
                          ) : (
                            <Badge className={p.status === 'paid' ? 'bg-green-600 text-white' : 'bg-white/15 text-white/70'}>
                              {p.status === 'paid' ? `Payé${p.paid_at ? ' · ' + new Date(p.paid_at).toLocaleDateString('fr-CH') : ''}` : 'Rejeté'}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Ventes & commissions encaissées */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Ticket size={20} style={{ color: 'var(--bt-accent-2)' }} /> Ventes & commissions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-center">
                    <p className="text-2xl font-bold text-white">{salesTotals.count_paid}</p>
                    <p className="text-white/50 text-xs">Billets vendus</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-center">
                    <p className="text-2xl font-bold text-white">{salesTotals.gross_chf.toFixed(0)}</p>
                    <p className="text-white/50 text-xs">CHF encaissés</p>
                  </div>
                  <div className="rounded-xl border border-white/10 p-3 text-center" style={{ background: 'rgba(217,28,210,0.10)' }}>
                    <p className="text-2xl font-bold" style={{ color: 'var(--bt-accent-2)' }}>{salesTotals.commission_chf.toFixed(0)}</p>
                    <p className="text-white/50 text-xs">CHF commissions</p>
                  </div>
                </div>
                {sales.length === 0 ? (
                  <p className="text-white/50 text-sm">Aucune vente pour l'instant.</p>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-2">
                    {sales.map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="text-white truncate">{t.buyer_email_resolved || t.buyer_user_id || '—'}</p>
                          <p className="text-white/50 text-xs truncate">
                            {new Date(t.created_at).toLocaleDateString('fr-CH')} · coach {t.coach_email || '—'} · session {t.session_id}
                          </p>
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <span className={t.status === 'refunded' ? 'text-white/40 line-through' : 'text-white'}>
                            {Number(t.amount_chf).toFixed(2)} CHF
                          </span>
                          <span className="text-white/40 text-xs block">comm. {Number(t.commission_chf).toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* 💳 Crédits offerts (admin) */}
        {activeTab === 'access' && (
          <div className="space-y-6">
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Gift size={20} className="text-[var(--bt-accent)]" />
                Crédits offerts
              </CardTitle>
              <CardDescription className="text-white/50">
                Créditez gratuitement le compte d'un utilisateur (email + nombre de crédits + note).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Formulaire */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-4">
                <div>
                  <Label className="text-white/70">Compte (recherche par nom ou email)</Label>
                  <Input
                    value={offerEmail}
                    onChange={(e) => setOfferEmail(e.target.value)}
                    placeholder="utilisateur@email.com"
                    type="text"
                    list="offer-users-datalist"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  />
                  <datalist id="offer-users-datalist">
                    {usersList.map((u) => (
                      <option key={u.id} value={u.email}>{u.full_name ? `${u.full_name} — ${u.email}` : u.email}</option>
                    ))}
                  </datalist>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <Label className="text-white/70">Nombre de crédits</Label>
                    <Input type="number" min={1} value={offerAmount}
                      onChange={(e) => setOfferAmount(parseInt(e.target.value) || 1)}
                      className="bg-white/5 border-white/10 text-white" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-white/70">Note (optionnel)</Label>
                    <Input value={offerNote} onChange={(e) => setOfferNote(e.target.value)}
                      placeholder="Cadeau de bienvenue…"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
                  </div>
                </div>

                <Button
                  onClick={handleOfferCredits}
                  disabled={offering}
                  className="w-full text-white border-none"
                  style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}
                >
                  <Coins size={16} className="mr-2" />
                  {offering ? 'Attribution…' : 'Offrir les crédits'}
                </Button>
              </div>

              {/* Historique des crédits offerts */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-white font-medium">Historique ({creditOffers.length})</h3>
                  <Button size="sm" variant="outline" onClick={refreshCreditOffers} className="border-white/20 text-white/70">
                    <RefreshCw size={14} className="mr-1" /> Actualiser
                  </Button>
                </div>
                {creditOffers.length === 0 ? (
                  <p className="text-white/40 text-sm py-4 text-center">Aucun crédit offert pour le moment.</p>
                ) : (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                    {creditOffers.map((o) => (
                      <div key={o.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                        <div className="min-w-0">
                          <p className="text-white text-sm truncate">{o.email || o.user_id}</p>
                          <p className="text-white/50 text-xs">
                            +{o.delta} crédit(s) · {new Date(o.created_at).toLocaleDateString()}
                            {o.note ? ` · ${o.note}` : ''}
                          </p>
                        </div>
                        <Badge className="bg-white/10 text-white border-white/20 flex-shrink-0">+{o.delta}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 3a) Historique « Crédits offerts » — éditable (MODIFIER / SUPPRIMER) */}
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-white flex items-center gap-2">
                  <Coins size={20} style={{ color: 'var(--bt-accent-2)' }} />
                  Historique des crédits offerts ({grants.length})
                </CardTitle>
                <Button size="sm" variant="outline" onClick={refreshGrants} className="border-white/20 text-white/70">
                  <RefreshCw size={14} className="mr-1" /> Actualiser
                </Button>
              </div>
              <CardDescription className="text-white/50">
                Modifiez le montant / la note d'un crédit offert, ou supprimez-le.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {grantsLoading ? (
                <p className="text-white/40 text-sm py-4 text-center">Chargement…</p>
              ) : grants.length === 0 ? (
                <p className="text-white/40 text-sm py-4 text-center">Aucun crédit offert pour le moment.</p>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                  {grants.map((g) => (
                    <div key={g.id} className="p-3 rounded-lg bg-white/5 border border-white/10">
                      {editGrantId === g.id ? (
                        <div className="space-y-3">
                          <p className="text-white text-sm font-medium truncate">{g.email}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <Label className="text-white/70 text-xs">Crédits</Label>
                              <Input type="number" min={1} value={editGrantAmount}
                                onChange={(e) => setEditGrantAmount(parseInt(e.target.value) || 1)}
                                className="bg-white/5 border-white/10 text-white" />
                            </div>
                            <div className="sm:col-span-2">
                              <Label className="text-white/70 text-xs">Note</Label>
                              <Input value={editGrantNote} onChange={(e) => setEditGrantNote(e.target.value)}
                                placeholder="Note…"
                                className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" disabled={savingGrant} onClick={() => handleUpdateGrant(g.id)}
                              className="text-white border-none"
                              style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}>
                              <Check size={14} className="mr-1" /> {savingGrant ? 'Enregistrement…' : 'Enregistrer'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={cancelEditGrant} className="border-white/20 text-white/70">
                              <X size={14} className="mr-1" /> Annuler
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-white text-sm truncate">{g.email}</p>
                            <p className="text-white/50 text-xs">
                              +{g.amount} crédit(s) · {new Date(g.created_at).toLocaleDateString()}
                              {g.note ? ` · ${g.note}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge className="bg-white/10 text-white border-white/20">+{g.amount}</Badge>
                            <Button size="sm" variant="outline" onClick={() => startEditGrant(g)}
                              className="border-white/20" style={{ color: 'var(--bt-accent-2)' }}>
                              Modifier
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleDeleteGrant(g.id)}
                              className="border-red-500/30 text-red-400 hover:bg-red-500/10">
                              <Trash2 size={14} className="mr-1" /> Supprimer
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          </div>
        )}

        {/* D : Utilisateurs Tab */}
        {activeTab === 'users' && (
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-white flex items-center gap-2">
                  <Users size={20} className="text-[var(--bt-accent)]" />
                  Utilisateurs ({filteredUsers.length})
                </CardTitle>
                <Button size="sm" onClick={handleExportCsv} className="text-white border-none" style={{ background: 'linear-gradient(135deg, var(--bt-accent) 0%, var(--bt-accent-2) 100%)' }}>
                  <Download size={14} className="mr-1" /> Télécharger la liste
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <Input
                  value={usersSearch}
                  onChange={(e) => setUsersSearch(e.target.value)}
                  placeholder="Rechercher par nom ou email…"
                  className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30"
                />
              </div>

              {usersLoading ? (
                <p className="text-white/40 text-sm py-4 text-center">Chargement…</p>
              ) : filteredUsers.length === 0 ? (
                <p className="text-white/40 text-sm py-4 text-center">Aucun utilisateur.</p>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                  {filteredUsers.map((u) => {
                    const compActive = u.comp_access_until && new Date(u.comp_access_until).getTime() > Date.now();
                    return (
                      <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-white/50 text-xs">{(u.full_name || u.email || '?').slice(0, 2).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-white text-sm truncate">{u.full_name || '—'}</p>
                          <p className="text-white/50 text-xs truncate">{u.email}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-white/70 text-xs">{u.subscription_status || 'none'}</p>
                          {compActive && (
                            <p className="text-[var(--bt-accent)] text-[11px]">offert {u.comp_access_plan} · {new Date(u.comp_access_until as string).toLocaleDateString()}</p>
                          )}
                          <p className="text-white/30 text-[11px]">{u.created_at ? new Date(u.created_at).toLocaleDateString() : ''}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-white/10 text-center">
          <p className="text-white/40 text-sm">
            {dbStatus === 'connected' 
              ? '✅ Données synchronisées avec Supabase (table: site_settings)'
              : '⚠️ Mode hors ligne - Configurez Supabase pour la persistance'
            }
          </p>
          {settings.updated_at && (
            <p className="text-white/30 text-xs mt-1">
              Dernière mise à jour : {new Date(settings.updated_at).toLocaleString('fr-FR')}
            </p>
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
