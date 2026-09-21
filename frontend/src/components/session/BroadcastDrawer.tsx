import React, { useEffect, useState } from 'react';
import { Instagram, Facebook, Youtube, Radio, RotateCw, Square, ExternalLink, X, Settings2, AlertTriangle, FlaskConical } from 'lucide-react';
import type { BroadcastDestination, BroadcastLike, BroadcastPlatform, BroadcastStatus } from '@/components/session/BroadcastTypes';
import { BroadcastConfigForm } from '@/components/session/BroadcastConfigForm';
import { libelleStatut, selectionnable, nbSelectionnes, formatDuree, actionPour, diagnosticConfig } from '@/lib/broadcastUi';

/**
 * 📡 « Diffuser en direct » — le tiroir des RÉSEAUX.
 *
 * Règles (Bassi, 17/09 puis 21/09) :
 * - rien sur l'écran principal : tout vit ici, derrière l'icône Radio de la barre ;
 * - AUCUN réseau présélectionné : l'hôte décide, réseau par réseau ;
 * - aucun secret : ni clé, ni URL, ni jeton — seulement des statuts et des rappels ;
 * - PLUS JAMAIS un « Non connecté » générique derrière un bouton mort : chaque plateforme affiche SON état
 *   et SA seule action possible (Connecter / Reconnecter = vrai OAuth ; Configurer = URL RTMPS + clé ;
 *   Configuration requise = diagnostic avec les NOMS des variables serveur) ;
 * - une panne isolée (TikTok) n'arrête pas les autres : « Réessayer » ne touche qu'elle ;
 * - « Arrêter tout » demande confirmation ; l'arrêt d'une seule destination, non ;
 * - tant que le serveur simule (`directAutorise` faux), un bandeau le dit et le bouton principal parle de simulation ;
 * - desktop = petit panneau ancré (fixed, borné) ; mobile = tiroir plein écran léger,
 *   quatre plateformes en colonne, bouton principal en bas (zone sûre).
 */
interface BroadcastDrawerProps {
  broadcast: BroadcastLike;
  open: boolean;
  onClose: () => void;
  mobile?: boolean;
}

const ORDRE: BroadcastPlatform[] = ['instagram', 'facebook', 'youtube', 'tiktok'];

/** TikTok n'existe pas dans Lucide : glyphe monochrome minimal, en ligne (pas d'emoji, pas d'image). */
const TikTokIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4v9.5a3.5 3.5 0 1 1-3.5-3.5" />
    <path d="M14 4c0 2.8 2.2 5 5 5" />
  </svg>
);

const ICONES: Record<BroadcastPlatform, React.ReactNode> = {
  instagram: <Instagram className="w-5 h-5" />,
  facebook: <Facebook className="w-5 h-5" />,
  youtube: <Youtube className="w-5 h-5" />,
  tiktok: <TikTokIcon />,
};

const TON: Record<BroadcastStatus, string> = {
  live: 'text-[var(--bt-accent)]',
  starting: 'text-white/70',
  error: 'text-red-300',
  reauth: 'text-amber-300',
  unavailable: 'text-white/35',
  not_connected: 'text-white/45',
  config_required: 'text-amber-300',
  not_configured: 'text-white/45',
  configured: 'text-emerald-300',
  off: 'text-white/40',
  connected: 'text-emerald-300',
};

/** Une ligne = une plateforme : icône, nom, statut, et la seule action pertinente. */
const Ligne: React.FC<{ d: BroadcastDestination; b: BroadcastLike; ouvert: boolean; onOuvrir: (on: boolean) => void }> = ({ d, b, ouvert, onOuvrir }) => {
  const pendantLive = b.live;
  const action = actionPour(d);
  const [occupe, setOccupe] = useState(false);
  const connecter = async () => { setOccupe(true); try { await b.connect(d.platform); } finally { setOccupe(false); } };
  return (
    <li className="py-2.5" data-testid={`broadcast-${d.platform}`} data-broadcast-status={d.status} data-broadcast-kind={d.kind}>
      <div className="flex items-center gap-3">
        <span className={`shrink-0 ${d.status === 'live' ? 'text-[var(--bt-accent)]' : 'text-white/80'}`}>{ICONES[d.platform]}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-white/90 leading-tight">{d.label}{d.accountLabel ? <span className="text-white/45"> · {d.accountLabel}</span> : null}</span>
          <span className={`block text-[11px] leading-tight ${TON[d.status]}`} data-testid={`broadcast-status-${d.platform}`}>{libelleStatut(d, pendantLive)}</span>
        </span>
        {/* Hors direct : interrupteur (compte relié / configuré). */}
        {!pendantLive && selectionnable(d.status) && (
          <button
            type="button"
            role="switch"
            aria-checked={d.selected}
            aria-label={`${d.selected ? 'Retirer' : 'Diffuser sur'} ${d.label}`}
            onClick={() => b.select(d.platform, !d.selected)}
            data-testid={`broadcast-switch-${d.platform}`}
            className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${d.selected ? 'bg-[var(--bt-accent)]' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${d.selected ? 'left-0.5 translate-x-4' : 'left-0.5'}`} />
          </button>
        )}
        {/* Hors direct : Connecter / Reconnecter = VRAI parcours OAuth (Facebook, YouTube). */}
        {!pendantLive && action.kind === 'oauth' && (
          <button
            type="button"
            onClick={connecter}
            disabled={occupe}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-[var(--bt-accent)] disabled:opacity-40 shrink-0"
            data-testid={`broadcast-connect-${d.platform}`}
          >
            {action.libelle} <ExternalLink className="w-3 h-3" />
          </button>
        )}
        {/* Hors direct : Configurer / Modifier = formulaire URL RTMPS + clé (Instagram, TikTok). */}
        {!pendantLive && (action.kind === 'configure' || action.kind === 'configured') && (
          <button
            type="button"
            onClick={() => onOuvrir(!ouvert)}
            aria-expanded={ouvert}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-[var(--bt-accent)] shrink-0"
            data-testid={`broadcast-configure-${d.platform}`}
          >
            <Settings2 className="w-3 h-3" /> {action.libelle}
          </button>
        )}
        {!pendantLive && d.status === 'unavailable' && <span className="text-[11px] text-white/30 shrink-0">—</span>}
        {/* Pendant le direct : arrêt individuel, ou réessai isolé. */}
        {pendantLive && d.status === 'error' && (
          <button
            type="button"
            onClick={() => b.retry(d.platform)}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-white/10 text-white/80 hover:bg-white/20 shrink-0"
            title={`Réessayer ${d.label}`}
            aria-label={`Réessayer ${d.label}`}
            data-testid={`broadcast-retry-${d.platform}`}
          >
            <RotateCw className="w-3.5 h-3.5" /> Réessayer
          </button>
        )}
        {pendantLive && (d.status === 'live' || d.status === 'starting') && (
          <button
            type="button"
            onClick={() => b.stop(d.platform)}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-white/10 text-white/70 hover:bg-red-500/30 hover:text-red-100 shrink-0"
            title={`Arrêter ${d.label}`}
            aria-label={`Arrêter ${d.label}`}
            data-testid={`broadcast-stop-${d.platform}`}
          >
            <Square className="w-3 h-3" /> Arrêter
          </button>
        )}
      </div>
      {/* Configuration requise : diagnostic EXACT (noms des variables serveur), aucun bouton mort. */}
      {!pendantLive && action.kind === 'diagnostic' && (
        <p className="mt-1.5 ml-8 flex items-start gap-1.5 text-[11px] leading-snug text-amber-200/80" data-testid={`broadcast-diagnostic-${d.platform}`}>
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
          <span>{diagnosticConfig(action.missing)}</span>
        </p>
      )}
      {!pendantLive && ouvert && (action.kind === 'configure' || action.kind === 'configured') && (
        <BroadcastConfigForm d={d} onSave={(s) => b.configure(d.platform, s)} onForget={() => b.forget(d.platform)} onClose={() => onOuvrir(false)} />
      )}
    </li>
  );
};

export const BroadcastDrawer: React.FC<BroadcastDrawerProps> = ({ broadcast, open, onClose, mobile = false }) => {
  const [confirmerArret, setConfirmerArret] = useState(false);
  const [formulaire, setFormulaire] = useState<BroadcastPlatform | null>(null);
  useEffect(() => { if (!open) { setConfirmerArret(false); setFormulaire(null); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const lignes = ORDRE
    .map((p) => broadcast.destinations.find((d) => d.platform === p))
    .filter((d): d is BroadcastDestination => !!d);
  const nbSelection = nbSelectionnes(broadcast.destinations);

  const entete = (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 ${broadcast.live ? 'text-[var(--bt-accent)]' : 'text-white/80'}`}><Radio className="w-5 h-5" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-white leading-tight">Diffuser en direct</h2>
        {broadcast.live ? (
          <p className="text-xs leading-tight mt-0.5 flex items-center gap-2" data-testid="broadcast-live">
            <span className="inline-flex items-center gap-1 text-[var(--bt-accent)] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--bt-accent)] animate-pulse" aria-hidden="true" /> EN DIRECT
            </span>
            <span className="tabular-nums text-white/70" data-testid="broadcast-elapsed">{formatDuree(broadcast.elapsedSec)}</span>
          </p>
        ) : (
          <p className="text-xs text-white/55 leading-tight mt-0.5">Choisissez où diffuser votre Live Afroboost</p>
        )}
      </div>
      <button type="button" onClick={onClose} aria-label="Fermer" className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10" data-testid="broadcast-close">
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  // Bandeau « simulation » : tant que le serveur n'autorise pas le direct réel, rien ne part vers un réseau.
  const bandeau = !broadcast.directAutorise ? (
    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-[11px] leading-snug text-white/65" data-testid="broadcast-simulation">
      <FlaskConical className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
      <span>Mode test : aucun direct réel n’est envoyé aux réseaux tant que le serveur n’est pas débloqué.</span>
    </p>
  ) : null;

  const avis = broadcast.avis ? (
    <p className="mt-2 text-[11px] leading-snug text-amber-200/90" role="status" data-testid="broadcast-avis">{broadcast.avis}</p>
  ) : null;

  const liste = (
    <ul className="divide-y divide-white/10" data-testid="broadcast-liste">
      {lignes.map((d) => <Ligne key={d.platform} d={d} b={broadcast} ouvert={formulaire === d.platform} onOuvrir={(on) => setFormulaire(on ? d.platform : null)} />)}
    </ul>
  );

  // Bouton principal : « Démarrer le direct » (hors direct), « Arrêter tout » (+ confirmation) en direct.
  const principal = broadcast.live ? (
    confirmerArret ? (
      <div className="flex items-center gap-2" data-testid="broadcast-stop-all-confirm">
        <button type="button" onClick={() => { setConfirmerArret(false); broadcast.stopAll(); }} className="flex-1 h-11 rounded-full bg-red-500/80 text-white text-sm font-semibold hover:bg-red-500" data-testid="broadcast-stop-all-yes">
          Confirmer l’arrêt
        </button>
        <button type="button" onClick={() => setConfirmerArret(false)} className="h-11 px-4 rounded-full bg-white/10 text-white/80 text-sm hover:bg-white/20" data-testid="broadcast-stop-all-no">
          Annuler
        </button>
      </div>
    ) : (
      <button type="button" onClick={() => setConfirmerArret(true)} className="w-full h-11 rounded-full bg-white/10 text-white text-sm font-semibold hover:bg-red-500/30 inline-flex items-center justify-center gap-2" data-testid="broadcast-stop-all">
        <Square className="w-4 h-4" /> Arrêter tout
      </button>
    )
  ) : (
    <button
      type="button"
      onClick={() => broadcast.start()}
      disabled={nbSelection === 0}
      className="w-full h-11 rounded-full bg-[var(--bt-accent)] text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
      data-testid="broadcast-start"
      data-broadcast-simulation={!broadcast.directAutorise}
    >
      <Radio className="w-4 h-4" /> {broadcast.directAutorise ? 'Démarrer le direct' : 'Démarrer (simulation)'}
    </button>
  );

  if (mobile) {
    return (
      <div className="fixed inset-0 z-[135] flex flex-col bg-[#0b0b10] text-white" role="dialog" aria-modal="true" aria-label="Diffuser en direct" data-testid="broadcast-drawer" data-broadcast-mode="mobile">
        <div className="px-4 pt-4 pb-3 border-b border-white/10">{entete}{bandeau}{avis}</div>
        <div className="flex-1 overflow-y-auto px-4">{liste}</div>
        <div className="px-4 py-3 border-t border-white/10 bg-black/30" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>{principal}</div>
      </div>
    );
  }

  // 🖥️ Desktop : petit panneau ancré en bas à droite, au-dessus de la barre — fixed car le
  //    panneau vidéo est overflow-hidden ; borné à la fenêtre, jamais un dashboard.
  return (
    <div
      className="fixed z-[135] w-[min(360px,calc(100vw-2rem))] max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b0b10]/95 backdrop-blur shadow-2xl text-white"
      style={{ right: '1rem', bottom: '5.5rem' }}
      role="dialog"
      aria-label="Diffuser en direct"
      data-testid="broadcast-drawer"
      data-broadcast-mode="desktop"
    >
      <div className="px-4 pt-4 pb-3 border-b border-white/10">{entete}{bandeau}{avis}</div>
      <div className="px-4">{liste}</div>
      <div className="px-4 py-3 border-t border-white/10">{principal}</div>
    </div>
  );
};

export default BroadcastDrawer;
