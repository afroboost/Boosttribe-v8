import React, { useEffect } from 'react';
import {
  X, User, Users, Columns2, PictureInPicture2, Monitor, Camera, Video,
  ArrowRightToLine, Scissors, ChevronDown, ChevronRight,
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
 * UNE SEULE COLONNE, desktop comme mobile (correctif terrain, 21/09). L'ancienne grille à trois
 * colonnes (Sources | Preview · Programme | Scènes) vivait dans la colonne droite de la session,
 * large de ~380 px : les minimums des colonnes latérales (150 + 170 px + gouttières) ne laissaient
 * que 8 px au centre → PREVIEW, PROGRAMME, « Flux live actuel » et les boutons Take/Cut passaient
 * PAR-DESSUS les scènes (18 chevauchements mesurés). D'où cette pile, de haut en bas :
 *
 *   STUDIO                          ✕
 *   [ PREVIEW ] [ PROGRAMME ]         ← deux onglets, une zone à la fois
 *   zone 16:9 de l'onglet courant
 *   [ Take ]  [ Cut ]                 ← icônes rondes + libellé DESSOUS, jamais superposé
 *   SOURCES (n)                    ›  ← section repliée : les sources disponibles, rien d'autre
 *   SCÈNES (n)                     ›  ← section repliée : les scènes de `studio.scenes`
 *
 * Choisir une scène l'affiche dans PREVIEW (l'onglet bascule) ; TAKE passe la preview à l'antenne
 * (l'onglet bascule sur PROGRAMME) ; CUT y passe la preview immédiatement, même chemin visuel.
 *
 * Le PROGRAMME reste le flux live existant tant que rien n'est passé à l'antenne
 * (`state.program === null`) : on l'écrit dans la zone plutôt que de faire croire à une régie
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

/** Cadre 16:9 de la zone affichée. Programme : liseré accent quand une scène est à l'antenne. */
const Zone: React.FC<{ zone: StudioZone; aAntenne: boolean; vide: boolean; children: React.ReactNode }> = ({ zone, aAntenne, vide, children }) => (
  <div className="min-w-0 w-full" data-testid={`studio-${zone}`} data-studio-antenne={zone === 'program' ? String(aAntenne) : undefined}>
    <div className={`relative aspect-video w-full overflow-hidden rounded-xl bg-black/60 border ${zone === 'program' && aAntenne ? 'border-[rgb(var(--bt-accent-rgb)/0.7)]' : 'border-white/10'}`}>
      {vide ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-white/35 px-4 text-center">
          {zone === 'preview' ? (
            <span>Choisis une scène</span>
          ) : (
            <>
              <span className="text-white/50" data-testid="studio-program-live">Flux live actuel</span>
              <span>Le flux live tel que les participants le voient</span>
            </>
          )}
        </div>
      ) : children}
    </div>
  </div>
);

/** Sélecteur de participant — un simple <select>, rien de plus (aucune gestion d'appareil). */
const Participant: React.FC<{ studio: StudioLike; participants: StudioParticipant[] }> = ({ studio, participants }) => {
  if (participants.length === 0) return null;
  return (
    <label className="relative flex items-center gap-2 text-sm text-white/85 min-w-0">
      <Users className="w-4 h-4 text-white/60 shrink-0" />
      <select
        value={studio.state.selectedParticipant ?? ''}
        onChange={(e) => studio.setParticipant(e.target.value || null)}
        aria-label="Participant utilisé dans la scène"
        className="w-full min-w-0 appearance-none pl-2 pr-7 py-1.5 rounded-lg text-sm bg-white/10 text-white/85 border border-white/15 focus:outline-none focus:border-[rgb(var(--bt-accent-rgb)/0.5)] cursor-pointer"
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

/** En-tête d'une section repliable : titre + compteur + chevron. Un seul bouton, pleine largeur. */
const Section: React.FC<{ id: string; titre: string; compteur: number; ouvert: boolean; onToggle: () => void; children: React.ReactNode }> = ({ id, titre, compteur, ouvert, onToggle, children }) => (
  <section className="border-t border-white/10" data-testid={`studio-${id}`} aria-label={titre}>
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={ouvert}
      aria-controls={`studio-${id}-liste`}
      className="w-full flex items-center justify-between gap-2 py-2.5 text-left hover:bg-white/5 rounded-lg px-1 transition-colors"
      data-testid={`studio-${id}-toggle`}
    >
      <span className={`${TITRE} truncate`}>{titre} <span className="text-white/35">({compteur})</span></span>
      <ChevronRight className={`w-4 h-4 text-white/50 shrink-0 transition-transform ${ouvert ? 'rotate-90' : ''}`} aria-hidden="true" />
    </button>
    {ouvert && (
      <div id={`studio-${id}-liste`} className="pb-2 px-1 space-y-2" data-testid={`studio-${id}-liste`}>
        {children}
      </div>
    )}
  </section>
);

/** Liste des sources DISPONIBLES (lecture seule) — ce que la régie peut placer dans une scène. */
const Sources: React.FC<{ studio: StudioLike; participants: StudioParticipant[]; ouvert: boolean; onToggle: () => void }> = ({ studio, participants, ouvert, onToggle }) => {
  const liste = studio.sources.filter((s) => s.kind !== 'participant');
  return (
    <Section id="sources" titre="Sources" compteur={liste.length + participants.length} ouvert={ouvert} onToggle={onToggle}>
      {liste.length === 0 && participants.length === 0 && (
        <p className="text-xs text-white/40 px-1">Aucune source : active ta caméra ou un partage d'écran.</p>
      )}
      {liste.length > 0 && (
        <ul className="space-y-0.5">
          {liste.map((s) => (
            <li key={`${s.kind}:${s.id ?? ''}`} className="flex items-center gap-2 px-2 py-1 rounded-lg text-sm text-white/80 min-w-0" data-studio-source-kind={s.kind}>
              <span className="w-4 h-4 text-white/55 flex items-center justify-center shrink-0">
                {s.kind === 'screen' ? <Monitor className="w-4 h-4" /> : s.kind === 'coach2' ? <Camera className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </span>
              <span className="truncate">{s.label}</span>
            </li>
          ))}
        </ul>
      )}
      <Participant studio={studio} participants={participants} />
    </Section>
  );
};

/** Modèles de scènes — icône + nom court ; clic = PREVIEW (jamais l'antenne directement). */
const Scenes: React.FC<{ studio: StudioLike; ouvert: boolean; onToggle: () => void; onChoisir: () => void }> = ({ studio, ouvert, onToggle, onChoisir }) => {
  const typePreview = studio.state.preview?.type ?? null;
  const typeProgram = studio.state.program?.type ?? null;
  return (
    <Section id="scenes" titre="Scènes" compteur={studio.scenes.length} ouvert={ouvert} onToggle={onToggle}>
      <ul className="space-y-0.5" role="listbox" aria-label="Choisir une scène pour la preview">
        {studio.scenes.map((t) => {
          const enPreview = t.type === typePreview;
          const aAntenne = t.type === typeProgram;
          return (
            <li key={t.type}>
              <button
                type="button"
                role="option"
                aria-selected={enPreview}
                onClick={() => { studio.preview(t.type, studio.state.selectedParticipant ? { participantId: studio.state.selectedParticipant, pip: studio.state.pip } : { pip: studio.state.pip }); onChoisir(); }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition-colors min-w-0 ${
                  enPreview ? 'bg-[rgb(var(--bt-accent-rgb)/0.18)] text-[var(--bt-accent)]' : 'text-white/85 hover:bg-white/10'
                }`}
                data-testid={`studio-scene-${t.type}`}
              >
                <span className="w-5 h-5 flex items-center justify-center shrink-0">{ICONES[t.icon]}</span>
                <span className="flex-1 min-w-0 truncate">{t.label}</span>
                {aAntenne && <span className="w-1.5 h-1.5 rounded-full bg-[var(--bt-accent)] shrink-0" aria-label="À l'antenne" title="À l'antenne" />}
              </button>
            </li>
          );
        })}
      </ul>
      {typePreview && SCENES_AVEC_PIP.has(typePreview) && (
        <div className="pt-1 px-1" data-testid="studio-pip">
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
    </Section>
  );
};

/** Passer au programme (take) + Cut (immédiat) — icônes rondes, libellé DESSOUS (jamais superposé). */
const Antenne: React.FC<{ studio: StudioLike; onPasse: () => void }> = ({ studio, onPasse }) => {
  const preview = studio.state.preview;
  const opts = studio.state.selectedParticipant ? { participantId: studio.state.selectedParticipant, pip: studio.state.pip } : { pip: studio.state.pip };
  const libelle = 'text-[10px] uppercase tracking-wider text-white/55 leading-none';
  return (
    <div className="flex flex-row items-start justify-center gap-8 py-1" data-testid="studio-antenne">
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={() => { studio.take(); onPasse(); }}
          disabled={!preview}
          className={`${ROUND} ${preview ? ACCENT : `${DARK} opacity-40 cursor-not-allowed`}`}
          title="Passer au programme"
          aria-label="Passer au programme"
          data-testid="studio-take"
        >
          <ArrowRightToLine className="w-5 h-5" />
        </button>
        <span className={libelle} aria-hidden="true">Take</span>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={() => { if (preview) { studio.cut(preview.type, opts); onPasse(); } }}
          disabled={!preview}
          className={`${ROUND} ${preview ? DARK : `${DARK} opacity-40 cursor-not-allowed`}`}
          title="Cut (immédiat)"
          aria-label="Cut : passer immédiatement au programme"
          data-testid="studio-cut"
        >
          <Scissors className="w-5 h-5" />
        </button>
        <span className={libelle} aria-hidden="true">Cut</span>
      </div>
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
  const [sourcesOuvertes, setSourcesOuvertes] = React.useState(false);
  const [scenesOuvertes, setScenesOuvertes] = React.useState(false);

  if (!open) return null;

  const aAntenne = studio.state.program !== null;
  const previewVide = studio.state.preview === null;

  const fermer = (
    <button type="button" onClick={onClose} aria-label="Fermer le studio" className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 shrink-0" data-testid="studio-close">
      <X className="w-4 h-4" />
    </button>
  );

  // Onglets PREVIEW / PROGRAMME — deux segments de même largeur, jamais superposés.
  const onglets = (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-0.5" role="tablist" aria-label="Zone affichée">
      {(['preview', 'program'] as StudioZone[]).map((z) => (
        <button
          key={z}
          type="button"
          role="tab"
          aria-selected={onglet === z}
          onClick={() => setOnglet(z)}
          className={`min-w-0 px-2 py-1.5 rounded-md text-[11px] uppercase tracking-wider truncate transition-colors ${
            onglet === z ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'
          } ${z === 'program' && aAntenne ? 'text-[var(--bt-accent)]' : ''}`}
          data-testid={`studio-onglet-${z}`}
        >
          {z === 'preview' ? 'Preview' : 'Programme'}
        </button>
      ))}
    </div>
  );

  // LA colonne — identique sur desktop et mobile ; seul le conteneur change.
  const colonne = (
    <div className="flex flex-col gap-3 min-w-0">
      {onglets}
      <Zone zone={onglet} aAntenne={aAntenne} vide={onglet === 'preview' ? previewVide : !aAntenne}>{renderScene(onglet)}</Zone>
      <Antenne studio={studio} onPasse={() => setOnglet('program')} />
      <div className="flex flex-col min-w-0">
        <Sources studio={studio} participants={participants} ouvert={sourcesOuvertes} onToggle={() => setSourcesOuvertes((o) => !o)} />
        <Scenes studio={studio} ouvert={scenesOuvertes} onToggle={() => setScenesOuvertes((o) => !o)} onChoisir={() => setOnglet('preview')} />
      </div>
    </div>
  );

  if (mobile) {
    // 📱 Tiroir plein écran léger : même colonne, défilable, zone sûre iPhone en bas.
    return (
      <div className="fixed inset-0 z-[135] flex flex-col bg-[#0b0b10] text-white" role="dialog" aria-modal="true" aria-label="Studio" data-testid="studio-panel" data-studio-mode="mobile">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10">
          <span className={TITRE}>Studio</span>
          {fermer}
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          {colonne}
        </div>
      </div>
    );
  }

  // 🖥️ Desktop : la même colonne, sous la barre de la visio ; refermable immédiatement.
  return (
    <div className="border-t border-white/10 bg-black/40 px-3 py-3 min-w-0 overflow-x-hidden" role="dialog" aria-label="Studio" data-testid="studio-panel" data-studio-mode="desktop">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className={TITRE}>Studio</span>
        {fermer}
      </div>
      {colonne}
    </div>
  );
};

export default StudioPanel;
