import React, { useEffect } from 'react';
import {
  X, User, Users, Columns2, PictureInPicture2, Monitor, Camera, Video,
  ArrowRightToLine, Scissors, ChevronDown,
} from 'lucide-react';
import {
  PIP_POSITIONS, SCENES_AVEC_PIP,
  type SceneIcon, type StudioLike, type StudioZone,
} from '@/components/session/StudioTypes';

/**
 * 🎬 Studio (Phase 2) — mini régie PREVIEW / PROGRAMME / scènes. UI PURE.
 *
 * Règle absolue (Bassi, 17/09) : la vidéo reste l'élément principal. Fermé, ce panneau ne
 * rend RIEN ; ouvert, il se referme d'un geste (✕, Échap) sans perdre l'état — l'état vit
 * dans `useStudio`, pas ici.
 *
 * - Desktop (≥ lg) : trois zones — Sources | PREVIEW · PROGRAMME | Scènes — sous la vidéo.
 * - Mobile (`mobile`) : tiroir plein écran léger, PROGRAMME ou PREVIEW en onglet (jamais
 *   côte à côte), scènes en liste, Passer au programme / Cut en icônes rondes.
 *
 * Le PROGRAMME reste le flux live existant tant que rien n'est passé à l'antenne
 * (`state.program === null`) : on l'écrit à l'écran plutôt que de faire croire à une régie
 * qui n'existe pas encore (Phase 3 = programStream).
 *
 * Ce panneau ne gère AUCUN appareil : le tiroir Sources existant reste la seule entrée
 * pour brancher/choisir caméras et micros. Aucun prompteur, chat ou minuteur ne passe ici.
 */
export interface StudioParticipant { identity: string; name: string }

export interface StudioPanelProps {
  studio: StudioLike;
  /** Rendu d'une zone (Preview ou Programme) — fourni par l'intégration (SceneRenderer). */
  renderScene: (zone: StudioZone) => React.ReactNode;
  participants: StudioParticipant[];
  open: boolean;
  onClose: () => void;
  mobile?: boolean;
}

const ICONES: Record<SceneIcon, React.ReactNode> = {
  user: <User className="w-4 h-4" />,
  users: <Users className="w-4 h-4" />,
  'columns-2': <Columns2 className="w-4 h-4" />,
  'picture-in-picture-2': <PictureInPicture2 className="w-4 h-4" />,
  monitor: <Monitor className="w-4 h-4" />,
  camera: <Camera className="w-4 h-4" />,
  video: <Video className="w-4 h-4" />,
};

const ROUND = 'w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors';
const DARK = 'bg-black/50 text-white/90 hover:bg-black/70';
const ACCENT = 'bg-[rgb(var(--bt-accent-rgb)/0.4)] text-[var(--bt-accent)] hover:bg-[rgb(var(--bt-accent-rgb)/0.5)]';
const TITRE = 'text-[11px] uppercase tracking-wider text-white/50';

/** Étiquette de zone + cadre 16:9. Programme : liseré accent quand une scène est à l'antenne. */
const Zone: React.FC<{ zone: StudioZone; aAntenne: boolean; vide: boolean; children: React.ReactNode }> = ({ zone, aAntenne, vide, children }) => (
  <div className="min-w-0 flex-1 space-y-1" data-testid={`studio-${zone}`} data-studio-antenne={zone === 'program' ? String(aAntenne) : undefined}>
    <div className="flex items-center justify-between px-0.5">
      <span className={`${TITRE} ${zone === 'program' && aAntenne ? 'text-[var(--bt-accent)]' : ''}`}>
        {zone === 'preview' ? 'Preview' : 'Programme'}
      </span>
      {zone === 'program' && !aAntenne && <span className="text-[10px] text-white/35" data-testid="studio-program-live">Flux live actuel</span>}
    </div>
    <div className={`relative aspect-video w-full overflow-hidden rounded-xl bg-black/60 border ${zone === 'program' && aAntenne ? 'border-[rgb(var(--bt-accent-rgb)/0.7)]' : 'border-white/10'}`}>
      {vide ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/35 px-4 text-center">
          {zone === 'preview' ? 'Choisis une scène' : 'Le flux live tel que les participants le voient'}
        </div>
      ) : children}
    </div>
  </div>
);

/** Sélecteur de participant — un simple <select>, rien de plus (aucune gestion d'appareil). */
const Participant: React.FC<{ studio: StudioLike; participants: StudioParticipant[] }> = ({ studio, participants }) => {
  if (participants.length === 0) return null;
  return (
    <label className="relative flex items-center gap-2 text-sm text-white/85">
      <Users className="w-4 h-4 text-white/60 shrink-0" />
      <select
        value={studio.state.selectedParticipant ?? ''}
        onChange={(e) => studio.setParticipant(e.target.value || null)}
        aria-label="Participant utilisé dans la scène"
        className="w-full appearance-none pl-2 pr-7 py-1.5 rounded-lg text-sm bg-white/10 text-white/85 border border-white/15 focus:outline-none focus:border-[rgb(var(--bt-accent-rgb)/0.5)] cursor-pointer"
        data-testid="studio-participant"
      >
        <option value="" className="bg-[#15151b] text-white">Participant…</option>
        {participants.map((p) => (
          <option key={p.identity} value={p.identity} className="bg-[#15151b] text-white">{p.name}</option>
        ))}
      </select>
      <ChevronDown className="w-3.5 h-3.5 text-white/50 absolute right-2 pointer-events-none" />
    </label>
  );
};

/** Liste des sources DISPONIBLES (lecture seule) — ce que la régie peut placer dans une scène. */
const Sources: React.FC<{ studio: StudioLike; participants: StudioParticipant[] }> = ({ studio, participants }) => (
  <section className="space-y-2" data-testid="studio-sources" aria-label="Sources de la régie">
    <span className={TITRE}>Sources</span>
    <ul className="space-y-1">
      {studio.sources.filter((s) => s.kind !== 'participant').map((s) => (
        <li key={`${s.kind}:${s.id ?? ''}`} className="flex items-center gap-2 px-2 py-1 rounded-lg text-sm text-white/80" data-studio-source-kind={s.kind}>
          <span className="w-4 h-4 text-white/55 flex items-center justify-center">
            {s.kind === 'screen' ? <Monitor className="w-4 h-4" /> : s.kind === 'coach2' ? <Camera className="w-4 h-4" /> : <User className="w-4 h-4" />}
          </span>
          <span className="truncate">{s.label}</span>
        </li>
      ))}
    </ul>
    <Participant studio={studio} participants={participants} />
  </section>
);

/** Modèles de scènes — icône + nom court ; clic = PREVIEW (jamais l'antenne directement). */
const Scenes: React.FC<{ studio: StudioLike; vertical?: boolean }> = ({ studio, vertical = false }) => {
  const typePreview = studio.state.preview?.type ?? null;
  const typeProgram = studio.state.program?.type ?? null;
  return (
    <section className="space-y-2" data-testid="studio-scenes" aria-label="Scènes">
      <span className={TITRE}>Scènes</span>
      <ul className={vertical ? 'space-y-1' : 'space-y-1'} role="listbox" aria-label="Choisir une scène pour la preview">
        {studio.scenes.map((t) => {
          const enPreview = t.type === typePreview;
          const aAntenne = t.type === typeProgram;
          return (
            <li key={t.type}>
              <button
                type="button"
                role="option"
                aria-selected={enPreview}
                onClick={() => studio.preview(t.type, studio.state.selectedParticipant ? { participantId: studio.state.selectedParticipant, pip: studio.state.pip } : { pip: studio.state.pip })}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition-colors ${
                  enPreview ? 'bg-[rgb(var(--bt-accent-rgb)/0.18)] text-[var(--bt-accent)]' : 'text-white/85 hover:bg-white/10'
                }`}
                data-testid={`studio-scene-${t.type}`}
              >
                <span className="w-5 h-5 flex items-center justify-center shrink-0">{ICONES[t.icon]}</span>
                <span className="flex-1 truncate">{t.label}</span>
                {aAntenne && <span className="w-1.5 h-1.5 rounded-full bg-[var(--bt-accent)]" aria-label="À l'antenne" title="À l'antenne" />}
              </button>
            </li>
          );
        })}
      </ul>
      {typePreview && SCENES_AVEC_PIP.has(typePreview) && (
        <div className="pt-1" data-testid="studio-pip">
          <span className="text-[10px] uppercase tracking-wider text-white/40">Vignette</span>
          <div className="mt-1 grid grid-cols-2 gap-1 w-[72px]">
            {PIP_POSITIONS.map(({ pos, label }) => {
              const actif = studio.state.pip === pos;
              return (
                <button
                  key={pos}
                  type="button"
                  onClick={() => studio.setPip(pos)}
                  aria-label={`Vignette ${label.toLowerCase()}`}
                  aria-pressed={actif}
                  title={label}
                  className={`relative h-8 rounded-md border transition-colors ${actif ? 'border-[rgb(var(--bt-accent-rgb)/0.7)] bg-[rgb(var(--bt-accent-rgb)/0.18)]' : 'border-white/15 bg-white/5 hover:bg-white/10'}`}
                  data-testid={`studio-pip-${pos}`}
                >
                  <span
                    className={`absolute w-2.5 h-2 rounded-[2px] ${actif ? 'bg-[var(--bt-accent)]' : 'bg-white/50'} ${
                      pos === 'tl' ? 'top-1 left-1' : pos === 'tr' ? 'top-1 right-1' : pos === 'bl' ? 'bottom-1 left-1' : 'bottom-1 right-1'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

/** Passer au programme (take) + Cut (immédiat) — deux icônes, tooltips, jamais de texte. */
const Antenne: React.FC<{ studio: StudioLike; vertical?: boolean }> = ({ studio, vertical = true }) => {
  const preview = studio.state.preview;
  const opts = studio.state.selectedParticipant ? { participantId: studio.state.selectedParticipant, pip: studio.state.pip } : { pip: studio.state.pip };
  return (
    <div className={`flex ${vertical ? 'flex-col' : 'flex-row'} items-center justify-center gap-3`} data-testid="studio-antenne">
      <button
        type="button"
        onClick={() => studio.take()}
        disabled={!preview}
        className={`${ROUND} ${preview ? ACCENT : `${DARK} opacity-40 cursor-not-allowed`}`}
        title="Passer au programme"
        aria-label="Passer au programme"
        data-testid="studio-take"
      >
        <ArrowRightToLine className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={() => { if (preview) studio.cut(preview.type, opts); }}
        disabled={!preview}
        className={`${ROUND} ${preview ? DARK : `${DARK} opacity-40 cursor-not-allowed`}`}
        title="Cut (immédiat)"
        aria-label="Cut : passer immédiatement au programme"
        data-testid="studio-cut"
      >
        <Scissors className="w-5 h-5" />
      </button>
    </div>
  );
};

export const StudioPanel: React.FC<StudioPanelProps> = ({ studio, renderScene, participants, open, onClose, mobile = false }) => {
  // Échap referme — sans toucher à l'état de la régie.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const [onglet, setOnglet] = React.useState<StudioZone>('program');

  if (!open) return null;

  const aAntenne = studio.state.program !== null;
  const previewVide = studio.state.preview === null;

  const fermer = (
    <button type="button" onClick={onClose} aria-label="Fermer le studio" className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10" data-testid="studio-close">
      <X className="w-4 h-4" />
    </button>
  );

  if (mobile) {
    // 📱 Tiroir plein écran léger : une zone à la fois (onglet), scènes en liste, antenne au pouce.
    return (
      <div className="fixed inset-0 z-[135] flex flex-col bg-[#0b0b10] text-white" role="dialog" aria-modal="true" aria-label="Studio" data-testid="studio-panel" data-studio-mode="mobile">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-1 rounded-lg bg-white/5 p-0.5" role="tablist" aria-label="Zone affichée">
            {(['program', 'preview'] as StudioZone[]).map((z) => (
              <button
                key={z}
                type="button"
                role="tab"
                aria-selected={onglet === z}
                onClick={() => setOnglet(z)}
                className={`px-3 py-1 rounded-md text-[11px] uppercase tracking-wider transition-colors ${onglet === z ? 'bg-white/10 text-white' : 'text-white/50'}`}
                data-testid={`studio-onglet-${z}`}
              >
                {z === 'program' ? 'Programme' : 'Preview'}
              </button>
            ))}
          </div>
          {fermer}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <Zone zone={onglet} aAntenne={aAntenne} vide={onglet === 'preview' ? previewVide : !aAntenne}>{renderScene(onglet)}</Zone>
          <Participant studio={studio} participants={participants} />
          <Scenes studio={studio} vertical />
        </div>
        <div className="px-4 py-3 border-t border-white/10 bg-black/30" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <Antenne studio={studio} vertical={false} />
        </div>
      </div>
    );
  }

  // 🖥️ Desktop : trois zones sous la vidéo ; refermable immédiatement.
  return (
    <div className="border-t border-white/10 bg-black/40 px-3 py-3" role="dialog" aria-label="Studio" data-testid="studio-panel" data-studio-mode="desktop">
      <div className="flex items-center justify-between mb-2">
        <span className={TITRE}>Studio</span>
        {fermer}
      </div>
      <div className="grid grid-cols-[minmax(150px,1fr)_minmax(0,4fr)_minmax(170px,1fr)] gap-4 items-start">
        <Sources studio={studio} participants={participants} />
        <div className="flex items-stretch gap-3 min-w-0">
          <Zone zone="preview" aAntenne={aAntenne} vide={previewVide}>{renderScene('preview')}</Zone>
          <div className="flex items-center pt-5"><Antenne studio={studio} /></div>
          <Zone zone="program" aAntenne={aAntenne} vide={!aAntenne}>{renderScene('program')}</Zone>
        </div>
        <Scenes studio={studio} />
      </div>
    </div>
  );
};

export default StudioPanel;
