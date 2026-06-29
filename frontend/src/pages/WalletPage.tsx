import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Footer } from '@/components/layout/Footer';
import { MobileMenu } from '@/components/layout/MobileMenu';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import {
  getCoachWallet, saveCoachBank, requestPayout, getCoachPlan, subscribeCoach, getRecordings,
  type CoachWallet, type CoachPlan, type RecordingRow,
} from '@/lib/paymentApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import {
  ArrowLeft, Wallet, TrendingUp, Send, CheckCircle2, Landmark, Loader2, Crown, Infinity as InfinityIcon,
  Radio, Download, FileText,
} from 'lucide-react';

// 🎨 Couleurs Afroboost
const AFRO = {
  magenta: '#D91CD2',
  pink: '#FF2DAA',
  dark: '#0A0A0F',
  white: '#FFFFFF',
  gradient: 'linear-gradient(135deg, #D91CD2 0%, #FF2DAA 100%)',
};

const STATUS_LABEL: Record<string, string> = {
  requested: 'Demandé', paid: 'Payé', rejected: 'Rejeté',
};

// 💰 Portefeuille coach (style Spordateur) — solde, revenus, IBAN, demande de virement.
const WalletPage: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const [wallet, setWallet] = useState<CoachWallet | null>(null);
  const [plan, setPlan] = useState<CoachPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [iban, setIban] = useState('');
  const [holder, setHolder] = useState('');
  const [savingBank, setSavingBank] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [recordings, setRecordings] = useState<RecordingRow[]>([]);

  const refresh = useCallback(async () => {
    const [w, p, rec] = await Promise.all([getCoachWallet(), getCoachPlan(), getRecordings()]);
    if (w.error) { showToast(w.error, 'error'); }
    if (w.data) {
      setWallet(w.data);
      setIban(w.data.iban || '');
      setHolder(w.data.holder || '');
    }
    if (p.data) setPlan(p.data);
    setRecordings(rec.recordings || []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { refresh(); }, [refresh]);

  // 💎 Retour de Stripe après abonnement → re-vérifier (le webhook peut avoir un léger délai).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('coach_sub') !== 'success') return;
    showToast('Abonnement reçu — activation en cours…', 'success');
    let tries = 0;
    const tick = async () => {
      tries += 1;
      const { data } = await getCoachPlan();
      if (data) { setPlan(data); if (data.subscription_active) return; }
      if (tries < 6) setTimeout(tick, 1500);
    };
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubscribe = useCallback(async () => {
    setSubscribing(true);
    try {
      const { url, error } = await subscribeCoach();
      if (url) { window.location.href = url; return; }
      showToast(error || 'Abonnement impossible', 'error');
    } finally {
      setSubscribing(false);
    }
  }, [showToast]);

  const handleSaveBank = useCallback(async () => {
    if (!iban.trim() || !holder.trim()) { showToast('IBAN et titulaire requis', 'warning'); return; }
    setSavingBank(true);
    try {
      const { ok, error } = await saveCoachBank(iban.trim(), holder.trim());
      if (ok) { showToast('IBAN enregistré', 'success'); await refresh(); }
      else showToast(error || 'Échec', 'error');
    } finally {
      setSavingBank(false);
    }
  }, [iban, holder, refresh, showToast]);

  const handleRequestPayout = useCallback(async () => {
    setRequesting(true);
    try {
      const { ok, amount_chf, error } = await requestPayout();
      if (ok) { showToast(`Virement de ${amount_chf?.toFixed(2)} CHF demandé`, 'success'); await refresh(); }
      else showToast(error || 'Échec', 'error');
    } finally {
      setRequesting(false);
    }
  }, [refresh, showToast]);

  const available = wallet?.available_chf ?? 0;
  const canRequest = wallet?.has_iban && available > 0;
  // 💳 Le solde / IBAN / virement n'ont de sens qu'en mode COMMISSION (argent via la plateforme).
  //    En « abonnement » (défaut), le coach encaisse ses élèves lui-même → on masque ces blocs.
  const isCommission = plan?.payment_type === 'commission';

  return (
    <div className="min-h-screen py-12 px-4" style={{ background: AFRO.dark }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-2 mb-8">
          <Link to="/session" className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors">
            <ArrowLeft size={20} />
            Retour
          </Link>
          <MobileMenu dropdownTopClass="top-0" />
        </div>

        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 flex items-center gap-3" style={{ fontFamily: 'inherit' }}>
            <Wallet style={{ color: AFRO.pink }} /> Portefeuille
          </h1>
          <p className="text-white/60">{isCommission
            ? 'Gère tes revenus et tes virements vers ton compte bancaire.'
            : 'Gère ton abonnement coach et retrouve tes enregistrements.'}</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-white/50">
            <Loader2 className="animate-spin mr-2" /> Chargement…
          </div>
        ) : !isAuthenticated ? (
          <p className="text-white/60">Connecte-toi pour accéder à ton portefeuille.</p>
        ) : (
          <>
            {/* 3 cartes — uniquement en mode commission (revenus encaissés via la plateforme) */}
            {isCommission && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <Card className="border-white/10" style={{ background: AFRO.gradient }}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 text-white/80 text-sm mb-1">
                    <Wallet size={16} /> Solde disponible
                  </div>
                  <p className="text-3xl font-bold text-white">{available.toFixed(2)} <span className="text-lg">CHF</span></p>
                  {(wallet?.pending_chf ?? 0) > 0 && (
                    <p className="text-white/70 text-xs mt-1">dont {wallet?.pending_chf.toFixed(2)} CHF en cours de virement</p>
                  )}
                </CardContent>
              </Card>
              <Card className="bg-white/5 border-white/10">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 text-white/60 text-sm mb-1">
                    <TrendingUp size={16} style={{ color: AFRO.pink }} /> Revenus totaux
                  </div>
                  <p className="text-3xl font-bold text-white">{(wallet?.total_revenue_chf ?? 0).toFixed(2)} <span className="text-lg text-white/50">CHF</span></p>
                </CardContent>
              </Card>
              <Card className="bg-white/5 border-white/10">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 text-white/60 text-sm mb-1">
                    <Send size={16} style={{ color: AFRO.pink }} /> Virements demandés
                  </div>
                  <p className="text-3xl font-bold text-white">{wallet?.payout_count ?? 0}</p>
                </CardContent>
              </Card>
            </div>
            )}

            {/* 💎 Abonnement « Coach Illimité » / modèle commission */}
            {plan && (
              <Card className="border-white/10 mb-6" style={{ background: plan.unlimited ? 'linear-gradient(135deg, rgba(217,28,210,0.18), rgba(255,45,170,0.12))' : 'rgba(255,255,255,0.05)' }}>
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Crown size={20} style={{ color: '#FF2DAA' }} />
                    {plan.payment_type === 'subscription' ? 'Abonnement Coach Illimité' : 'Modèle commission'}
                    {plan.unlimited && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                        <InfinityIcon size={12} /> Illimité actif
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {plan.payment_type === 'subscription' ? (
                    <>
                    {plan.subscription_active ? (
                      <div className="text-white/70 text-sm space-y-1">
                        <p className="flex items-center gap-2 text-green-400"><CheckCircle2 size={16} /> Crédits illimités + 0% de commission sur tes ventes.</p>
                        {plan.current_period_end && (
                          <p className="text-white/50 text-xs">Renouvellement le {new Date(plan.current_period_end).toLocaleDateString('fr-CH')}</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <p className="text-white/70 text-sm">Crédits illimités + 0% de commission.</p>
                          <p className="text-2xl font-bold text-white">{plan.sub_price_chf.toFixed(2)} <span className="text-base text-white/60">CHF / mois</span></p>
                        </div>
                        <PrimaryButton onClick={handleSubscribe} disabled={subscribing}>
                          {subscribing ? <Loader2 size={16} className="animate-spin mr-2" /> : <Crown size={16} className="mr-2" />}
                          S'abonner
                        </PrimaryButton>
                      </div>
                    )}
                    <p className="mt-3 text-white/50 text-xs border-t border-white/10 pt-3">
                      💡 Tu encaisses tes élèves toi-même (hors plateforme), via ton lien/QR privé.
                      Aucun solde ni virement à gérer ici.
                    </p>
                    </>
                  ) : (
                    <p className="text-white/70 text-sm">
                      Tu es en <strong>modèle commission</strong> : commission de {plan.commission_percent}% sur tes ventes,
                      versée sur ton solde, virements via IBAN ci-dessous.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Coordonnées bancaires — uniquement en mode commission */}
            {isCommission && (
            <Card className="bg-white/5 border-white/10 mb-6">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Landmark size={20} style={{ color: AFRO.pink }} /> Coordonnées bancaires
                  {wallet?.has_iban && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                      <CheckCircle2 size={12} /> IBAN enregistré
                    </span>
                  )}
                </CardTitle>
                <p className="text-white/50 text-sm">Indispensable pour recevoir tes virements.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/80">IBAN</Label>
                    <Input value={iban} onChange={(e) => setIban(e.target.value)}
                      placeholder="CH00 0000 0000 0000 0000 0"
                      className="bg-black/30 border-white/15 text-white" />
                  </div>
                  <div>
                    <Label className="text-white/80">Titulaire du compte</Label>
                    <Input value={holder} onChange={(e) => setHolder(e.target.value)}
                      placeholder="Prénom Nom"
                      className="bg-black/30 border-white/15 text-white" />
                  </div>
                </div>
                <Button onClick={handleSaveBank} disabled={savingBank}
                  className="text-white border-0" style={{ background: AFRO.gradient }}>
                  {savingBank ? <Loader2 size={16} className="animate-spin mr-2" /> : <Landmark size={16} className="mr-2" />}
                  Mettre à jour mon IBAN
                </Button>
              </CardContent>
            </Card>
            )}

            {/* Demande de virement — uniquement en mode commission */}
            {isCommission && (
            <Card className="bg-white/5 border-white/10 mb-6">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Send size={20} style={{ color: AFRO.pink }} /> Demande de virement
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-white/60 text-sm">Montant disponible à virer</p>
                    <p className="text-2xl font-bold text-white">{available.toFixed(2)} CHF</p>
                  </div>
                  <PrimaryButton onClick={handleRequestPayout} disabled={!canRequest || requesting}>
                    {requesting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Send size={16} className="mr-2" />}
                    {available <= 0 ? 'Aucun solde à virer' : !wallet?.has_iban ? 'Renseigne ton IBAN d\'abord' : 'Demander le virement'}
                  </PrimaryButton>
                </div>
                {!wallet?.has_iban && (
                  <p className="text-amber-400/80 text-xs mt-3">Renseigne ton IBAN ci-dessus pour pouvoir demander un virement.</p>
                )}
              </CardContent>
            </Card>
            )}

            {/* Historique des virements — uniquement en mode commission */}
            {isCommission && wallet && wallet.requests.length > 0 && (
              <Card className="bg-white/5 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-lg">Historique des virements</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-72 overflow-y-auto space-y-2">
                    {wallet.requests.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
                        <div>
                          <p className="text-white font-medium">{Number(r.amount_chf).toFixed(2)} CHF</p>
                          <p className="text-white/50 text-xs">{new Date(r.created_at).toLocaleString('fr-CH')}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          r.status === 'paid' ? 'bg-green-500/20 text-green-400'
                          : r.status === 'rejected' ? 'bg-red-500/20 text-red-300'
                          : 'bg-white/15 text-white/70'
                        }`}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 🔴 Mes enregistrements + transcriptions IA */}
            {recordings.length > 0 && (
              <Card className="bg-white/5 border-white/10 mt-6">
                <CardHeader>
                  <CardTitle className="text-white text-lg flex items-center gap-2">
                    <Radio size={20} style={{ color: AFRO.pink }} /> Mes enregistrements
                  </CardTitle>
                  <p className="text-white/50 text-sm">Audio complet (toutes les voix) + transcription FR et résumé.</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {recordings.map((r) => (
                    <details key={r.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <summary className="flex items-center justify-between gap-3 cursor-pointer text-sm">
                        <span className="text-white/80">{new Date(r.created_at).toLocaleString('fr-CH')}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          r.status === 'done' ? 'bg-green-500/20 text-green-400'
                          : r.status === 'error' ? 'bg-red-500/20 text-red-300'
                          : 'bg-white/15 text-white/70'
                        }`}>
                          {r.status === 'done' ? 'Prêt' : r.status === 'error' ? 'Erreur' : 'En cours…'}
                        </span>
                      </summary>
                      <div className="mt-3 space-y-3">
                        {r.audio_url && (
                          <div className="flex flex-wrap items-center gap-3">
                            <audio controls src={r.audio_url} className="max-w-full" />
                            <a href={r.audio_url} download
                              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/80 hover:bg-white/10">
                              <Download size={14} /> Télécharger l'audio
                            </a>
                          </div>
                        )}
                        {r.summary && (
                          <div>
                            <p className="text-[#FF2DAA] text-xs font-semibold mb-1 flex items-center gap-1"><FileText size={13} /> Résumé / notes</p>
                            <p className="text-white/80 text-sm whitespace-pre-wrap">{r.summary}</p>
                          </div>
                        )}
                        {r.transcript && (
                          <div>
                            <p className="text-white/60 text-xs font-semibold mb-1">Transcription complète</p>
                            <p className="text-white/70 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">{r.transcript}</p>
                            <button
                              onClick={() => {
                                const blob = new Blob([(r.summary ? `RÉSUMÉ\n\n${r.summary}\n\n---\n\n` : '') + (r.transcript || '')], { type: 'text/plain;charset=utf-8' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url; a.download = `transcription-${r.id}.txt`;
                                document.body.appendChild(a); a.click(); a.remove();
                                setTimeout(() => URL.revokeObjectURL(url), 2000);
                              }}
                              className="mt-2 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/80 hover:bg-white/10"
                            >
                              <Download size={14} /> Télécharger la transcription
                            </button>
                          </div>
                        )}
                        {r.status === 'error' && r.error && (
                          <p className="text-red-300/80 text-xs">{r.error}</p>
                        )}
                      </div>
                    </details>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default WalletPage;
