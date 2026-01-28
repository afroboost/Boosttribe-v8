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
import { 
  Settings, 
  CreditCard, 
  Users, 
  Activity, 
  Save,
  RefreshCw,
  ExternalLink,
  Crown,
  Zap,
  Building2,
  ArrowLeft
} from "lucide-react";

// Admin config stored in localStorage
interface AdminConfig {
  stripe: {
    proMonthlyLink: string;
    proYearlyLink: string;
    enterpriseMonthlyLink: string;
    enterpriseYearlyLink: string;
  };
  updatedAt: string;
}

const DEFAULT_CONFIG: AdminConfig = {
  stripe: {
    proMonthlyLink: '',
    proYearlyLink: '',
    enterpriseMonthlyLink: '',
    enterpriseYearlyLink: '',
  },
  updatedAt: new Date().toISOString(),
};

const ADMIN_CONFIG_KEY = 'bt_admin_config';

// Mock stats data
const MOCK_STATS = {
  totalUsers: 247,
  activeSubscriptions: 89,
  activeSessions: 12,
  totalRevenue: '2,450€',
};

// Mock users for display
const MOCK_USERS = [
  { id: '1', email: 'contact.artboost@gmail.com', name: 'Admin', status: 'enterprise', role: 'admin', joinedAt: '2024-01-15' },
  { id: '2', email: 'sarah.k@example.com', name: 'Sarah K.', status: 'pro', role: 'user', joinedAt: '2024-02-20' },
  { id: '3', email: 'alex.m@example.com', name: 'Alex M.', status: 'trial', role: 'user', joinedAt: '2024-03-10' },
  { id: '4', email: 'emma.l@example.com', name: 'Emma L.', status: 'pro', role: 'user', joinedAt: '2024-03-15' },
  { id: '5', email: 'john.d@example.com', name: 'John D.', status: 'trial', role: 'user', joinedAt: '2024-03-18' },
];

// Editable Stripe Link Field
interface StripeLinkFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
}

const StripeLinkField: React.FC<StripeLinkFieldProps> = ({ 
  label, 
  value, 
  onChange, 
  placeholder,
  icon
}) => (
  <div className="space-y-2">
    <Label className="text-white/70 flex items-center gap-2">
      {icon}
      {label}
    </Label>
    <div className="flex gap-2">
      <Input 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "https://buy.stripe.com/..."}
        className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-purple-500"
      />
      {value && (
        <Button
          variant="outline"
          size="icon"
          onClick={() => window.open(value, '_blank')}
          className="border-white/20 text-white/70 hover:bg-white/10 flex-shrink-0"
          title="Tester le lien"
        >
          <ExternalLink size={16} />
        </Button>
      )}
    </div>
  </div>
);

// Stat Card Component
interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, trend }) => (
  <Card className="border-white/10 bg-white/5">
    <CardContent className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/50 text-sm">{label}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {trend && (
            <p className="text-xs text-green-400 mt-1">{trend}</p>
          )}
        </div>
        <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400">
          {icon}
        </div>
      </div>
    </CardContent>
  </Card>
);

// User Row Component
interface UserRowProps {
  user: typeof MOCK_USERS[0];
}

const UserRow: React.FC<UserRowProps> = ({ user }) => {
  const statusColors: Record<string, string> = {
    trial: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    pro: 'bg-green-500/20 text-green-400 border-green-500/30',
    enterprise: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-medium">
          {user.name.split(' ').map(n => n[0]).join('')}
        </div>
        <div>
          <p className="text-white font-medium">{user.name}</p>
          <p className="text-white/50 text-sm">{user.email}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge className={statusColors[user.status] || statusColors.trial}>
          {user.status === 'enterprise' && '👑 '}
          {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
        </Badge>
        {user.role === 'admin' && (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            Admin
          </Badge>
        )}
        <span className="text-white/40 text-xs">{user.joinedAt}</span>
      </div>
    </div>
  );
};

// Main Dashboard Component
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { isAdmin, user, isLoading } = useAuth();
  const { showToast } = useToast();
  
  const [config, setConfig] = useState<AdminConfig>(DEFAULT_CONFIG);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'stripe' | 'users' | 'stats'>('stripe');

  // Check admin access
  useEffect(() => {
    if (!isLoading && !isAdmin) {
      console.log('[ADMIN] Access denied, redirecting...');
      showToast('Accès refusé - Admin uniquement', 'error');
      navigate('/');
    }
  }, [isAdmin, isLoading, navigate, showToast]);

  // Load config from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ADMIN_CONFIG_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AdminConfig;
        setConfig(parsed);
        console.log('[ADMIN] Config loaded from localStorage');
      }
    } catch (err) {
      console.error('[ADMIN] Error loading config:', err);
    }
  }, []);

  // Update Stripe link
  const handleStripeUpdate = useCallback((key: keyof AdminConfig['stripe'], value: string) => {
    setConfig(prev => ({
      ...prev,
      stripe: {
        ...prev.stripe,
        [key]: value,
      },
    }));
    setHasChanges(true);
  }, []);

  // Save config to localStorage
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    
    try {
      const updatedConfig = {
        ...config,
        updatedAt: new Date().toISOString(),
      };
      
      localStorage.setItem(ADMIN_CONFIG_KEY, JSON.stringify(updatedConfig));
      setConfig(updatedConfig);
      setHasChanges(false);
      
      showToast('Configuration sauvegardée !', 'success');
      console.log('[ADMIN] Config saved:', updatedConfig);
    } catch (err) {
      console.error('[ADMIN] Save error:', err);
      showToast('Erreur lors de la sauvegarde', 'error');
    }
    
    setIsSaving(false);
  }, [config, showToast]);

  // Reset config
  const handleReset = useCallback(() => {
    if (window.confirm('Réinitialiser la configuration ?')) {
      localStorage.removeItem(ADMIN_CONFIG_KEY);
      setConfig(DEFAULT_CONFIG);
      setHasChanges(false);
      showToast('Configuration réinitialisée', 'warning');
    }
  }, [showToast]);

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-white/50">Vérification des accès...</span>
        </div>
      </div>
    );
  }

  // Access denied
  if (!isAdmin) {
    return null;
  }

  return (
    <div 
      className="min-h-screen"
      style={{ background: '#0a0a0f' }}
    >
      {/* Admin Header */}
      <header 
        className="sticky top-0 z-50 border-b border-white/10"
        style={{ 
          background: "rgba(0, 0, 0, 0.9)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link to="/" className="flex items-center gap-2">
                <div 
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: theme.colors.gradient.primary }}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                </div>
                <span 
                  className="text-xl font-bold"
                  style={{
                    fontFamily: theme.fonts.heading,
                    background: theme.colors.gradient.primary,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  {theme.name}
                </span>
              </Link>
              <Separator orientation="vertical" className="h-6 bg-white/20" />
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                ⚙️ Gestion du Site
              </Badge>
            </div>
            
            <div className="flex items-center gap-3">
              {hasChanges && (
                <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                  ⚠️ Non sauvegardé
                </Badge>
              )}
              <span className="text-white/50 text-sm hidden sm:block">
                {user?.email}
              </span>
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
        {/* Page Title */}
        <div className="mb-8">
          <h1 
            className="text-3xl font-bold text-white mb-2"
            style={{ fontFamily: theme.fonts.heading }}
          >
            👑 Tableau de Bord Admin
          </h1>
          <p className="text-white/60">
            Gérez les liens Stripe, les utilisateurs et les statistiques de la plateforme.
          </p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard 
            label="Utilisateurs" 
            value={MOCK_STATS.totalUsers} 
            icon={<Users size={24} />}
            trend="+12% ce mois"
          />
          <StatCard 
            label="Abonnements actifs" 
            value={MOCK_STATS.activeSubscriptions} 
            icon={<CreditCard size={24} />}
            trend="+8% ce mois"
          />
          <StatCard 
            label="Sessions en cours" 
            value={MOCK_STATS.activeSessions} 
            icon={<Activity size={24} />}
          />
          <StatCard 
            label="Revenus mensuels" 
            value={MOCK_STATS.totalRevenue} 
            icon={<Crown size={24} />}
            trend="+15% ce mois"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === 'stripe' ? 'default' : 'outline'}
            onClick={() => setActiveTab('stripe')}
            className={activeTab === 'stripe' 
              ? 'bg-purple-500 text-white hover:bg-purple-600' 
              : 'border-white/20 text-white/70 hover:bg-white/10'
            }
          >
            <CreditCard size={16} className="mr-2" />
            Liens Stripe
          </Button>
          <Button
            variant={activeTab === 'users' ? 'default' : 'outline'}
            onClick={() => setActiveTab('users')}
            className={activeTab === 'users' 
              ? 'bg-purple-500 text-white hover:bg-purple-600' 
              : 'border-white/20 text-white/70 hover:bg-white/10'
            }
          >
            <Users size={16} className="mr-2" />
            Utilisateurs
          </Button>
          <Button
            variant={activeTab === 'stats' ? 'default' : 'outline'}
            onClick={() => setActiveTab('stats')}
            className={activeTab === 'stats' 
              ? 'bg-purple-500 text-white hover:bg-purple-600' 
              : 'border-white/20 text-white/70 hover:bg-white/10'
            }
          >
            <Activity size={16} className="mr-2" />
            Statistiques
          </Button>
        </div>

        {/* Tab Content */}
        {activeTab === 'stripe' && (
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white flex items-center gap-2">
                    <CreditCard size={20} />
                    Configuration Stripe
                  </CardTitle>
                  <CardDescription className="text-white/50">
                    Configurez les liens de paiement Stripe pour chaque plan
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                    size="sm"
                  >
                    <RefreshCw size={14} className="mr-2" />
                    Réinitialiser
                  </Button>
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
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Pro Plan */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-4">
                  <Zap size={20} className="text-green-400" />
                  <h3 className="text-white font-semibold">Plan Pro</h3>
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    9.99€/mois
                  </Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <StripeLinkField
                    label="Lien Mensuel"
                    value={config.stripe.proMonthlyLink}
                    onChange={(v) => handleStripeUpdate('proMonthlyLink', v)}
                    placeholder="https://buy.stripe.com/pro-monthly"
                  />
                  <StripeLinkField
                    label="Lien Annuel"
                    value={config.stripe.proYearlyLink}
                    onChange={(v) => handleStripeUpdate('proYearlyLink', v)}
                    placeholder="https://buy.stripe.com/pro-yearly"
                  />
                </div>
              </div>

              {/* Enterprise Plan */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 size={20} className="text-purple-400" />
                  <h3 className="text-white font-semibold">Plan Enterprise</h3>
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                    29.99€/mois
                  </Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <StripeLinkField
                    label="Lien Mensuel"
                    value={config.stripe.enterpriseMonthlyLink}
                    onChange={(v) => handleStripeUpdate('enterpriseMonthlyLink', v)}
                    placeholder="https://buy.stripe.com/enterprise-monthly"
                  />
                  <StripeLinkField
                    label="Lien Annuel"
                    value={config.stripe.enterpriseYearlyLink}
                    onChange={(v) => handleStripeUpdate('enterpriseYearlyLink', v)}
                    placeholder="https://buy.stripe.com/enterprise-yearly"
                  />
                </div>
              </div>

              {/* Last updated */}
              {config.updatedAt && (
                <p className="text-white/40 text-xs text-right">
                  Dernière mise à jour : {new Date(config.updatedAt).toLocaleString('fr-FR')}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'users' && (
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Users size={20} />
                Utilisateurs ({MOCK_USERS.length})
              </CardTitle>
              <CardDescription className="text-white/50">
                Liste des utilisateurs et leurs abonnements
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {MOCK_USERS.map(user => (
                  <UserRow key={user.id} user={user} />
                ))}
              </div>
              <p className="text-white/40 text-xs mt-4 text-center">
                📋 Données de démonstration - Connectez Supabase pour voir les vrais utilisateurs
              </p>
            </CardContent>
          </Card>
        )}

        {activeTab === 'stats' && (
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Activity size={20} />
                Statistiques détaillées
              </CardTitle>
              <CardDescription className="text-white/50">
                Analyses et métriques de la plateforme
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Sessions by day */}
                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <h3 className="text-white font-medium mb-4">Sessions par jour</h3>
                  <div className="flex items-end gap-1 h-32">
                    {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
                      <div 
                        key={i}
                        className="flex-1 rounded-t"
                        style={{ 
                          height: `${h}%`,
                          background: theme.colors.gradient.primary,
                          opacity: 0.7 + (i * 0.04),
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-white/40 mt-2">
                    <span>Lun</span>
                    <span>Mar</span>
                    <span>Mer</span>
                    <span>Jeu</span>
                    <span>Ven</span>
                    <span>Sam</span>
                    <span>Dim</span>
                  </div>
                </div>

                {/* Subscription breakdown */}
                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <h3 className="text-white font-medium mb-4">Répartition abonnements</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-white/70">Essai gratuit</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-yellow-500" style={{ width: '64%' }} />
                        </div>
                        <span className="text-white/50 text-sm">158</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/70">Pro</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500" style={{ width: '32%' }} />
                        </div>
                        <span className="text-white/50 text-sm">79</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/70">Enterprise</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500" style={{ width: '4%' }} />
                        </div>
                        <span className="text-white/50 text-sm">10</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-white/40 text-xs mt-4 text-center">
                📊 Données de démonstration - Les vraies statistiques seront disponibles avec Supabase Analytics
              </p>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-white/10 text-center">
          <p className="text-white/40 text-sm">
            Configuration stockée dans localStorage (clé: <code className="text-purple-400">{ADMIN_CONFIG_KEY}</code>)
          </p>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
