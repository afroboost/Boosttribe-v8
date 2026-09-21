import React, { useEffect } from 'react';
import { Disc, Square, Download, Check, X, AlertTriangle, RotateCw, Loader2 } from 'lucide-react';
import type { RecorderLike, RecQualite } from '@/components/session/RecordTypes';
import { formatDureeRec, formatTaille, libelleFormat, motifIndisponible } from '@/lib/recordUi';

/**
 * ⏺ « Enregistrer le Programme » — mini panneau (desktop) / tiroir plein écran (mobile).
 *
 * Règles (Bassi, Phase 4) :
 * - la vidéo reste dominante : fermé = rien de rendu ; ouvert = un seul geste principal ;
 * - la source est le Programme (compositeur Phase 3) : l'UI ne choisit que la qualité ;
 * - le fichier est LOCAL : ce panneau ne connaît ni serveur, ni upload — seulement le hook ;
 * - « Enregistrement prêt » propose « Enregistrer sur mon appareil », sauf si le fichier a déjà
 *   été écrit directement (File System Access) : alors « Fichier enregistré » + son nom.
 */
interface RecordPanelProps {
  recorder: RecorderLike;
  open: boolean;
  onClose: () => void;
  mobile?: boolean;
}

const QUALITES: RecQualite[] = ['720p', '1080p'];

export const RecordPanel: React.FC<RecordPanelProps> = ({ recorder, open, onClose, mobile = false }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const { etat, capacite, qualite, dureeSec, tailleOctets, resultat, avis } = recorder;
  const indisponible = motifIndisponible(capacite);
  const enCours = etat === 'enregistrement';
  const occupe = etat === 'preparation' || etat === 'finalisation';

  const entete = (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 ${enCours ? 'text-[var(--bt-accent)]' : 'text-white/80'}`}><Disc className="w-5 h-5" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-white leading-tight">Enregistrer le Programme</h2>
        {enCours ? (
          <p className="text-xs leading-tight mt-0.5 flex items-center gap-2" data-testid="record-en-cours">
            <span className="inline-flex items-center gap-1 text-[var(--bt-accent)] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--bt-accent)] animate-pulse" aria-hidden="true" /> Enregistrement
            </span>
            <span className="tabular-nums text-white/70" data-testid="record-duree">{formatDureeRec(dureeSec)}</span>
            <span className="text-white/45" data-testid="record-taille">· {formatTaille(tailleOctets)}</span>
          </p>
        ) : (
          <p className="text-xs text-white/55 leading-tight mt-0.5">Le fichier reste sur votre appareil — rien n’est envoyé.</p>
        )}
      </div>
      <button type="button" onClick={onClose} aria-label="Fermer" className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10" data-testid="record-close">
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  // ── Corps selon l'état ────────────────────────────────────────────────────
  let corps: React.ReactNode;
  let principal: React.ReactNode = null;

  if (indisponible) {
    corps = (
      <p className="py-3 text-sm text-white/70 flex items-start gap-2" data-testid="record-indisponible">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" /> <span>{indisponible}</span>
      </p>
    );
  } else if (etat === 'pret' && resultat) {
    corps = (
      <div className="py-3 space-y-2" data-testid="record-ready">
        <p className="text-sm font-medium text-white flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-300" /> {resultat.dejaEcrit ? 'Fichier enregistré' : 'Enregistrement prêt'}
        </p>
        <dl className="text-xs text-white/70 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-white/45">Nom</dt><dd className="truncate" data-testid="record-nom">{resultat.dejaEcrit && resultat.emplacement ? resultat.emplacement : resultat.nom}</dd>
          <dt className="text-white/45">Durée</dt><dd className="tabular-nums">{formatDureeRec(resultat.dureeSec)}</dd>
          <dt className="text-white/45">Taille</dt><dd>{formatTaille(resultat.tailleOctets)}</dd>
          <dt className="text-white/45">Résolution</dt><dd>{resultat.resolution}</dd>
          <dt className="text-white/45">Format</dt><dd>{resultat.format}</dd>
        </dl>
        {avis && (
          <p className="text-xs text-amber-200/90 flex items-start gap-2" role="status" data-testid="record-avis">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{avis}</span>
          </p>
        )}
      </div>
    );
    principal = resultat.dejaEcrit ? (
      <button type="button" onClick={() => { recorder.fermerResultat(); onClose(); }} className="w-full h-11 rounded-full bg-white/10 text-white text-sm font-semibold hover:bg-white/20" data-testid="record-done">
        Fermer
      </button>
    ) : (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => { void resultat.sauvegarderSurAppareil(); }} className="flex-1 h-11 rounded-full bg-[var(--bt-accent)] text-white text-sm font-semibold inline-flex items-center justify-center gap-2" data-testid="record-save">
          <Download className="w-4 h-4" /> Enregistrer sur mon appareil
        </button>
        <button type="button" onClick={() => { recorder.fermerResultat(); onClose(); }} className="h-11 px-4 rounded-full bg-white/10 text-white/80 text-sm hover:bg-white/20" data-testid="record-done">
          Fermer
        </button>
      </div>
    );
  } else if (etat === 'erreur') {
    corps = (
      <p className="py-3 text-sm text-red-300 flex items-start gap-2" data-testid="record-erreur">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{avis || 'L’enregistrement a échoué.'}</span>
      </p>
    );
    principal = (
      <button type="button" onClick={() => { recorder.fermerResultat(); void recorder.demarrer(); }} className="w-full h-11 rounded-full bg-[var(--bt-accent)] text-white text-sm font-semibold inline-flex items-center justify-center gap-2" data-testid="record-retry">
        <RotateCw className="w-4 h-4" /> Réessayer
      </button>
    );
  } else if (enCours || etat === 'finalisation') {
    corps = (
      <p className="py-3 text-xs text-white/55">
        {etat === 'finalisation' ? 'Finalisation du fichier…' : 'Le Programme est enregistré tel que les participants le voient. Vous pouvez changer de scène : le fichier reste continu.'}
      </p>
    );
    principal = etat === 'finalisation' ? (
      <button type="button" disabled className="w-full h-11 rounded-full bg-white/10 text-white/70 text-sm font-semibold inline-flex items-center justify-center gap-2" data-testid="record-finalisation">
        <Loader2 className="w-4 h-4 animate-spin" /> Finalisation…
      </button>
    ) : (
      <button type="button" onClick={() => { void recorder.arreter(); }} className="w-full h-11 rounded-full bg-[var(--bt-accent)] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90" data-testid="record-stop">
        <Square className="w-4 h-4" /> Arrêter l’enregistrement
      </button>
    );
  } else {
    // inactif / preparation : choix de la qualité + format + avis, puis Démarrer.
    const propositions = QUALITES.filter((q) => capacite.qualites.includes(q));
    corps = (
      <div className="py-3 space-y-3">
        <div>
          <p className="text-xs text-white/45 mb-1.5">Qualité</p>
          <div className="inline-flex rounded-full bg-white/5 p-0.5" role="radiogroup" aria-label="Qualité" data-testid="record-qualites">
            {propositions.map((q) => (
              <button
                key={q}
                type="button"
                role="radio"
                aria-checked={qualite === q}
                onClick={() => recorder.choisirQualite(q)}
                disabled={occupe}
                className={`px-3.5 h-8 rounded-full text-xs font-semibold transition-colors ${qualite === q ? 'bg-[var(--bt-accent)] text-white' : 'text-white/70 hover:bg-white/10'}`}
                data-testid={`record-qualite-${q}`}
              >
                {q === '1080p' ? 'Haute qualité · 1080p' : '720p'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-white/45" data-testid="record-format">Format : {libelleFormat(capacite)} · 30 i/s</p>
        {avis && (
          <p className="text-xs text-amber-200/90 flex items-start gap-2" role="status" data-testid="record-avis">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{avis}</span>
          </p>
        )}
      </div>
    );
    principal = (
      <button
        type="button"
        onClick={() => { void recorder.demarrer(); }}
        disabled={occupe}
        className="w-full h-11 rounded-full bg-[var(--bt-accent)] text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-wait inline-flex items-center justify-center gap-2"
        data-testid="record-start"
      >
        {occupe ? <Loader2 className="w-4 h-4 animate-spin" /> : <Disc className="w-4 h-4" />}
        {occupe ? 'Préparation…' : 'Démarrer l’enregistrement'}
      </button>
    );
  }

  if (mobile) {
    return (
      <div className="fixed inset-0 z-[135] flex flex-col bg-[#0b0b10] text-white" role="dialog" aria-modal="true" aria-label="Enregistrer le Programme" data-testid="record-panel" data-record-mode="mobile">
        <div className="px-4 pt-4 pb-3 border-b border-white/10">{entete}</div>
        <div className="flex-1 overflow-y-auto px-4">{corps}</div>
        {principal && (
          <div className="px-4 py-3 border-t border-white/10 bg-black/30" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>{principal}</div>
        )}
      </div>
    );
  }

  // 🖥️ Desktop : petit panneau ancré bas droite, au-dessus de la barre (fixed : le panneau
  //    vidéo est overflow-hidden), borné à la fenêtre.
  return (
    <div
      className="fixed z-[135] w-[min(360px,calc(100vw-2rem))] max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b0b10]/95 backdrop-blur shadow-2xl text-white"
      style={{ right: '1rem', bottom: '5.5rem' }}
      role="dialog"
      aria-label="Enregistrer le Programme"
      data-testid="record-panel"
      data-record-mode="desktop"
    >
      <div className="px-4 pt-4 pb-3 border-b border-white/10">{entete}</div>
      <div className="px-4">{corps}</div>
      {principal && <div className="px-4 py-3 border-t border-white/10">{principal}</div>}
    </div>
  );
};

export default RecordPanel;
