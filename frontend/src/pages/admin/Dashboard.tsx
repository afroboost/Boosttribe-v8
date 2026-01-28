import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import supabase, { isSupabaseConfigured } from "@/lib/supabaseClient";
import { refreshSiteSettings } from "@/hooks/useSiteSettings";
import { 
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
  Check,
  X,
  Image
} from "lucide-react";

// Site settings interface - matches Supabase table
interface SiteSettings {
  id?: string;
  site_name: string;
  site_slogan: string;
  site_description: string;
  site_badge: string;
  favicon_url: string;
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
  updated_at?: string;
}

const DEFAULT_SETTINGS: SiteSettings = {
  site_name: 'Beattribe',
  site_slogan: 'Unite Through Rhythm',
  site_description: 'Rejoignez la communauté des beatmakers et producteurs.',
  site_badge: 'La communauté des créateurs',
  favicon_url: '',
  color_primary: '#8A2EFF',
  color_secondary: '#FF2FB3',
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
          className={`bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-purple-500 ${
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
  const [activeTab, setActiveTab] = useState<'identity' | 'colors' | 'buttons' | 'stripe'>('identity');
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

  // Update favicon in document head
  useEffect(() => {
    if (settings.favicon_url) {
      let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = settings.favicon_url;
      console.log('[CMS] Favicon updated:', settings.favicon_url);
    }
  }, [settings.favicon_url]);

  // Load settings from Supabase with AUTO-HEALING mode (no error banners)
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
        
        // Handle result - AUTO-HEALING: no error display, just use defaults
        if (error || !data) {
          console.log('[CMS] No data from Supabase, using defaults (auto-healing)');
          setDbStatus('offline');
          setSettings(DEFAULT_SETTINGS);
          setOriginalSettings(DEFAULT_SETTINGS);
        } else {
          console.log('[CMS] ✅ Settings loaded from Supabase:', data.site_name);
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

  // Save settings to Supabase
  const handleSave = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      showToast('Supabase non configuré', 'error');
      return;
    }

    setIsSaving(true);
    
    try {
      // Prepare update data (exclude id and timestamps)
      const updateData = {
        site_name: settings.site_name,
        site_slogan: settings.site_slogan,
        site_description: settings.site_description,
        site_badge: settings.site_badge,
        favicon_url: settings.favicon_url,
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
        stripe_pro_monthly: settings.stripe_pro_monthly,
        stripe_pro_yearly: settings.stripe_pro_yearly,
        stripe_enterprise_monthly: settings.stripe_enterprise_monthly,
        stripe_enterprise_yearly: settings.stripe_enterprise_yearly,
        updated_by: user?.id,
      };

      let result;
      
      if (settings.id) {
        // Update existing
        result = await supabase
          .from('site_settings')
          .update(updateData)
          .eq('id', settings.id)
          .select()
          .single();
      } else {
        // Insert new (shouldn't happen normally)
        result = await supabase
          .from('site_settings')
          .insert(updateData)
          .select()
          .single();
      }

      if (result.error) {
        console.error('[CMS] Save error:', result.error);
        showToast(`Erreur: ${result.error.message}`, 'error');
        setIsSaving(false);
        return;
      }

      console.log('[CMS] ✅ Settings saved to Supabase');
      
      // Update local state
      const savedData = result.data as SiteSettings;
      setSettings(savedData);
      setOriginalSettings(savedData);
      setHasChanges(false);
      setDbStatus('connected');
      
      // Refresh global settings cache
      refreshSiteSettings();
      
      // Update theme context for live preview
      updateConfig({
        name: settings.site_name,
        slogan: settings.site_slogan,
        description: settings.site_description,
        badge: settings.site_badge,
        colors: {
          primary: settings.color_primary,
          secondary: settings.color_secondary,
          background: settings.color_background,
          gradient: {
            primary: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)`,
          },
        },
        buttons: {
          login: settings.btn_login,
          start: settings.btn_start,
          joinTribe: settings.btn_join,
          exploreBeats: settings.btn_explore,
        },
        stats: [
          { value: settings.stat_creators, label: 'Créateurs' },
          { value: settings.stat_beats, label: 'Beats partagés' },
          { value: settings.stat_countries, label: 'Pays' },
        ],
      });
      
      showToast('✅ Configuration sauvegardée dans Supabase !', 'success');
    } catch (err) {
      console.error('[CMS] Save exception:', err);
      showToast('Erreur lors de la sauvegarde', 'error');
    }
    
    setIsSaving(false);
  }, [settings, user?.id, updateConfig, showToast]);

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
          <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
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
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link to="/" className="flex items-center gap-2">
                <div 
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)` }}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                </div>
                <span 
                  className="text-xl font-bold"
                  style={{
                    fontFamily: theme.fonts.heading,
                    background: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)`,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {settings.site_name}
                </span>
              </Link>
              <Separator orientation="vertical" className="h-6 bg-white/20" />
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                ⚙️ CMS Admin
              </Badge>
              
              {/* DB Status */}
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
            </div>
            
            <div className="flex items-center gap-3">
              {hasChanges && (
                <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                  ⚠️ Non sauvegardé
                </Badge>
              )}
              <Link to="/" target="_blank">
                <Button variant="outline" size="sm" className="border-white/20 text-white/70 hover:bg-white/10">
                  <Eye size={16} className="mr-2" />
                  Prévisualiser
                </Button>
              </Link>
              <Link to="/">
                <Button variant="outline" size="sm" className="border-white/20 text-white/70 hover:bg-white/10">
                  <ArrowLeft size={16} className="mr-2" />
                  Retour
                </Button>
              </Link>
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
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: theme.fonts.heading }}>
              👑 Gestion du Site (CMS)
            </h1>
            <p className="text-white/60">
              Modifiez l'identité, les couleurs et les textes.
            </p>
          </div>
          <div className="flex gap-3">
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
          <CardContent className="p-6">
            <div className="flex items-center gap-6">
              <div 
                className="w-16 h-16 rounded-xl flex items-center justify-center"
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
              <div className="flex-1">
                <h2 
                  className="text-2xl font-bold"
                  style={{
                    background: `linear-gradient(135deg, ${settings.color_primary} 0%, ${settings.color_secondary} 100%)`,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {settings.site_name}
                </h2>
                <p className="text-white/70">{settings.site_slogan}</p>
                <Badge className="mt-2 bg-white/10 text-white/60">{settings.site_badge}</Badge>
              </div>
              <div className="flex gap-2">
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
            { id: 'stripe', label: 'Liens Stripe', icon: <CreditCard size={16} /> },
          ].map(tab => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? 'default' : 'outline'}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={activeTab === tab.id 
                ? 'bg-purple-500 text-white hover:bg-purple-600' 
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
                  placeholder="Beattribe"
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
                  placeholder="#8A2EFF"
                  isColor
                />
                <EditableField
                  label="Couleur Secondaire"
                  value={settings.color_secondary}
                  onChange={(v) => handleUpdate('color_secondary', v)}
                  placeholder="#FF2FB3"
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
                  <Building2 size={20} className="text-purple-400" />
                  <h3 className="text-white font-semibold">Plan Enterprise</h3>
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">29.99€/mois</Badge>
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
