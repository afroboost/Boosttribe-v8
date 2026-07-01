import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Music, Play, Trash2, Check, ChevronUp, ChevronDown, Pencil, X as XIcon, MoreVertical, EyeOff, Eye, Share2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface Track {
  id: number;
  title: string;
  artist: string;
  src: string;
  coverArt?: string;
  hidden?: boolean; // 🙈 masqué : invisible pour les participants, récupérable côté hôte (stocké dans le JSON)
}

interface SortableTrackItemProps {
  track: Track;
  isSelected: boolean;
  onSelect: (track: Track) => void;
  isHost: boolean;
  isEditMode: boolean;
  isChecked: boolean;
  onToggleCheck: (trackId: number) => void;
  onDeleteSingle: (track: Track) => void;
  // ↕️ Boutons de position (mobile-friendly, alternative au drag) :
  isFirst: boolean;
  isLast: boolean;
  onMove: (trackId: number, dir: -1 | 1) => void;
  onRename: (trackId: number, title: string) => void; // ✏️ renommer un titre
  onToggleHidden: (trackId: number) => void;          // 🙈 masquer / ré-afficher
}

const SortableTrackItem: React.FC<SortableTrackItemProps> = ({
  track,
  isSelected,
  onSelect,
  isHost,
  isEditMode,
  isChecked,
  onToggleCheck,
  onDeleteSingle,
  isFirst,
  isLast,
  onMove,
  onRename,
  onToggleHidden,
}) => {
  // ✏️ Édition inline du nom (local à la ligne).
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // ⋮ menu kebab (Renommer / Supprimer)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (menuOpen) { setMenuOpen(false); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Menu ~220px : aligné à droite du bouton, ouverture vers le bas ; borné à l'écran.
    const top = Math.min(r.bottom + 4, window.innerHeight - 210);
    const left = Math.min(Math.max(8, r.right - 220), window.innerWidth - 228);
    setMenuPos({ top, left });
    setMenuOpen(true);
  };
  // 🔧 Fermeture au clic EXTÉRIEUR — listener attaché au TICK SUIVANT (setTimeout) pour NE PAS capter
  //    le clic d'ouverture (sinon le menu se refermait aussitôt → « ouvert avant = false » à chaque clic).
  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (ev: Event) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) setMenuOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setMenuOpen(false); };
    const t = window.setTimeout(() => {
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
  const [draft, setDraft] = useState(track.title);
  const startRename = () => { setDraft(track.title); setEditing(true); };
  const saveRename = () => {
    const t = draft.trim();
    if (t && t !== track.title) onRename(track.id, t);
    setEditing(false);
  };

  // 🔒 PARTICIPANT: Désactive complètement le drag-and-drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id, disabled: !isHost || isEditMode || editing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg transition-all group min-w-0 w-full overflow-hidden
        ${isSelected
          ? 'bg-white/10 border border-[#8A2EFF]/50'
          : 'bg-[var(--bt-surface-alpha)] border border-white/10 hover:bg-white/5'
        }
        ${isDragging ? 'shadow-lg shadow-[#8A2EFF]/20 z-50' : ''}
        ${track.hidden && isHost ? 'opacity-50' : ''}
      `}
      data-testid={`track-item-${track.id}`}
    >
      {/* 🔒 Edit Mode: Checkbox - HOST ONLY */}
      {isEditMode && isHost && (
        <button
          onClick={() => onToggleCheck(track.id)}
          className={`
            w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all
            ${isChecked 
              ? 'bg-[#8A2EFF] border-[#8A2EFF]' 
              : 'border-white/30 hover:border-white/50'
            }
          `}
          data-testid={`checkbox-track-${track.id}`}
        >
          {isChecked && <Check size={12} strokeWidth={3} className="text-white" />}
        </button>
      )}

      {/* 🔒 Poignée de glisser-déposer — HOST ONLY, VISIBLE mobile ET desktop (drag tactile + souris).
          touch-none = le drag tactile fonctionne sans déclencher le scroll. Les flèches ↑/↓ et la
          corbeille coexistent (deux méthodes de réorganisation). */}
      {isHost && !isEditMode && (
        <button
          {...attributes}
          {...listeners}
          className="flex items-center p-0.5 sm:p-1 -ml-0.5 text-white/40 hover:text-white/70 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
          aria-label={`Déplacer ${track.title}`}
          data-testid={`drag-handle-${track.id}`}
        >
          <GripVertical size={16} strokeWidth={1.5} />
        </button>
      )}

      {/* Track Info - Cliquable pour l'hôte seulement. min-w-0 → le nom se tronque, jamais les boutons. */}
      <div
        onClick={() => { if (!editing && isHost && !isEditMode) onSelect(track); }}
        className={`flex-1 min-w-0 flex items-center gap-2 sm:gap-3 text-left ${isHost && !isEditMode && !editing ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {/* Cover Art */}
        <div
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #8A2EFF 0%, #FF2FB3 100%)' }}
        >
          {isSelected ? (
            <Play size={16} strokeWidth={1.5} className="text-white ml-0.5 sm:w-[18px] sm:h-[18px]" fill="currentColor" />
          ) : (
            <Music size={16} strokeWidth={1.5} className="text-white/80 sm:w-[18px] sm:h-[18px]" />
          )}
        </div>

        {/* Title & Artist (édition inline du nom) */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 120))}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); else if (e.key === 'Escape') setEditing(false); }}
              onBlur={saveRename}
              className="w-full bg-black/40 border border-[#8A2EFF]/60 rounded px-2 py-1 text-white text-sm focus:outline-none"
              data-testid={`rename-input-${track.id}`}
            />
          ) : (
            <p
              className="text-white font-medium truncate text-sm leading-tight flex items-center gap-1.5"
              onDoubleClick={(e) => { if (isHost && !isEditMode) { e.stopPropagation(); startRename(); } }}
              title={track.title}
            >
              {track.hidden && isHost && <EyeOff size={13} strokeWidth={2} className="text-white/40 flex-shrink-0" />}
              <span className="truncate">{track.title}</span>
              {track.hidden && isHost && <span className="text-[10px] uppercase tracking-wide text-white/40 flex-shrink-0">masqué</span>}
            </p>
          )}
          <p className="text-white/50 text-xs truncate">{track.artist}</p>
        </div>
      </div>

      {/* 🎛️ ACTIONS HÔTE — groupe unique aligné à DROITE, flex-shrink-0 → toujours visibles/cliquables
          même avec un nom long (le nom se tronque dans le conteneur min-w-0 ci-dessus). */}
      {isHost && !isEditMode && (
        editing ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* onMouseDown preventDefault → garde le focus sur l'input (évite que onBlur déclenche avant le clic). */}
            <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); saveRename(); }}
              className="p-1.5 rounded-lg text-green-400 bg-green-500/20 hover:bg-green-500/30 transition-colors"
              title="Valider" data-testid={`rename-save-${track.id}`}>
              <Check size={16} strokeWidth={2.5} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); setEditing(false); }}
              className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              title="Annuler">
              <XIcon size={16} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
            {/* ↕️ Position (alternative au drag) */}
            <div className="flex flex-col">
              <button onClick={(e) => { e.stopPropagation(); onMove(track.id, -1); }} disabled={isFirst}
                className="p-0.5 rounded text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
                title="Monter" data-testid={`move-up-${track.id}`} aria-label={`Monter ${track.title}`}>
                <ChevronUp size={15} strokeWidth={2} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onMove(track.id, 1); }} disabled={isLast}
                className="p-0.5 rounded text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
                title="Descendre" data-testid={`move-down-${track.id}`} aria-label={`Descendre ${track.title}`}>
                <ChevronDown size={15} strokeWidth={2} />
              </button>
            </div>
            {/* ⋮ MENU (Renommer / Supprimer) — remplace les boutons directs crayon + corbeille.
                Ouvert en PORTAL position:fixed → jamais rogné par l'overflow de la ligne ni du ScrollArea. */}
            <div className="flex-shrink-0">
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={openMenu}
                className="p-1.5 rounded-lg text-white/55 hover:text-white hover:bg-white/10 transition-colors"
                title="Options" data-testid={`track-menu-${track.id}`} aria-label={`Options ${track.title}`} aria-haspopup="menu" aria-expanded={menuOpen}>
                <MoreVertical size={16} strokeWidth={2} />
              </button>
              {menuOpen && menuPos && createPortal(
                <>
                  <div ref={menuRef} role="menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
                    className="z-[9999] min-w-[210px] rounded-xl border border-white/10 bg-[#15151b] shadow-2xl py-1 overflow-hidden"
                    onClick={(e) => e.stopPropagation()}>
                    <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); startRename(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-white/85 hover:bg-white/10 text-left transition-colors"
                      data-testid={`rename-track-${track.id}`}>
                      <Pencil size={15} strokeWidth={2} /> Renommer / Modifier l'étiquette
                    </button>
                    <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onSelect(track); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-white/85 hover:bg-white/10 text-left transition-colors"
                      data-testid={`share-track-${track.id}`}>
                      <Share2 size={15} strokeWidth={2} /> Partager la chanson
                    </button>
                    <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onToggleHidden(track.id); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-white/85 hover:bg-white/10 text-left transition-colors"
                      data-testid={`hide-track-${track.id}`}>
                      {track.hidden ? <><Eye size={15} strokeWidth={2} /> Afficher la chanson</> : <><EyeOff size={15} strokeWidth={2} /> Masquer la chanson</>}
                    </button>
                    <div className="my-1 h-px bg-white/10" />
                    <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDeleteSingle(track); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 text-left transition-colors"
                      data-testid={`delete-track-${track.id}`}>
                      <Trash2 size={15} strokeWidth={2} /> Supprimer la chanson
                    </button>
                  </div>
                </>,
                document.body
              )}
            </div>
          </div>
        )
      )}

      {/* Indicateur de sélection (desktop seulement, ne prend pas de place sur mobile) */}
      {isSelected && !isEditMode && !editing && (
        <div className="hidden sm:block w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#8A2EFF' }} />
      )}
    </div>
  );
};

interface PlaylistDnDProps {
  tracks: Track[];
  selectedTrack: Track | null;
  onTrackSelect: (track: Track) => void;
  onReorder: (tracks: Track[]) => void;
  onDeleteTracks: (tracks: Track[]) => void;
  onRenameTrack?: (trackId: number, title: string) => void; // ✏️ renommer un titre (persisté par le parent)
  onToggleHidden?: (trackId: number) => void;               // 🙈 masquer / ré-afficher (persisté par le parent)
  isHost: boolean;
  maxTracks?: number;
}

export const PlaylistDnD: React.FC<PlaylistDnDProps> = ({
  tracks,
  selectedTrack,
  onTrackSelect,
  onReorder,
  onDeleteTracks,
  onRenameTrack,
  onToggleHidden,
  isHost,
  maxTracks = 20,
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());

  // 🖱️📱 Capteurs explicites cross-device (recommandé dnd-kit) :
  //  - Souris (desktop) : drag dès 8px de déplacement.
  //  - Tactile (mobile) : appui long 180ms puis glissement (tolérance 8px) → le scroll reste possible,
  //    un simple tap = sélection. Restaure le glisser-déposer au doigt ET à la souris.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = tracks.findIndex((t) => t.id === active.id);
      const newIndex = tracks.findIndex((t) => t.id === over.id);
      const newTracks = arrayMove(tracks, oldIndex, newIndex);
      onReorder(newTracks);
    }
  };

  // ↕️ Déplacer une piste d'un cran (boutons position, alternative au drag sur mobile).
  const handleMove = useCallback((trackId: number, dir: -1 | 1) => {
    const idx = tracks.findIndex((t) => t.id === trackId);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= tracks.length) return;
    onReorder(arrayMove(tracks, idx, target));
  }, [tracks, onReorder]);

  const handleToggleCheck = useCallback((trackId: number) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  }, []);

  const handleDeleteSingle = useCallback((track: Track) => {
    if (window.confirm(`Supprimer "${track.title}" ?`)) {
      onDeleteTracks([track]);
    }
  }, [onDeleteTracks]);

  const handleDeleteSelected = useCallback(() => {
    const selectedTracks = tracks.filter(t => checkedIds.has(t.id));
    if (selectedTracks.length === 0) return;

    const message = selectedTracks.length === 1
      ? `Supprimer "${selectedTracks[0].title}" ?`
      : `Supprimer ${selectedTracks.length} titres ?`;

    if (window.confirm(message)) {
      onDeleteTracks(selectedTracks);
      setCheckedIds(new Set());
      setIsEditMode(false);
    }
  }, [tracks, checkedIds, onDeleteTracks]);

  const handleExitEditMode = useCallback(() => {
    setIsEditMode(false);
    setCheckedIds(new Set());
  }, []);

  // Limit tracks display. 🙈 Les titres MASQUÉS sont retirés pour les PARTICIPANTS (l'hôte les voit
  //   toujours, grisés, pour pouvoir les ré-afficher).
  const displayTracks = (isHost ? tracks : tracks.filter((t) => !t.hidden)).slice(0, maxTracks);
  const hasChecked = checkedIds.size > 0;

  return (
    <div className="space-y-3">
      {/* 🩹 FIX MOBILE — Radix ScrollArea enveloppe ses enfants dans un <div style="display:table">
          qui se dimensionne sur le contenu le plus large (le titre non tronqué). Résultat : la ligne
          devient plus large que la zone visible et les boutons d'action (poignée/flèches/renommer/
          corbeille) sont poussés hors écran puis rognés par l'overflow-hidden de la ScrollArea, et le
          `truncate` du titre ne se déclenche jamais. On force ce wrapper en `display:block` (largeur =
          viewport) : le titre se tronque enfin et les actions restent visibles. Portée limitée à cette
          playlist via la classe `.playlist-scroll`. N'affecte PAS le drag & drop (dnd-kit). */}
      <style>{`
        .playlist-scroll [data-radix-scroll-area-viewport] > div {
          display: block !important;
          min-width: 100% !important;
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap px-1">
        <p className="text-white/50 text-xs">
          {displayTracks.length} / {maxTracks} titres
          {/* 🔒 Indicateur pour les participants */}
          {!isHost && displayTracks.length > 0 && (
            <span className="ml-2 text-purple-400">(lecture seule)</span>
          )}
        </p>
        
        {/* ⋮ Le bouton « Modifier » a été retiré : toutes les actions (renommer/étiquette, masquer,
            partager, supprimer) sont désormais dans le menu 3 points de chaque ligne. */}
      </div>

      {/* Scrollable Playlist */}
      <ScrollArea className="h-[400px] pr-2 playlist-scroll">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={displayTracks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {displayTracks.map((track, idx) => (
                <SortableTrackItem
                  key={track.id}
                  track={track}
                  isSelected={selectedTrack?.id === track.id}
                  onSelect={onTrackSelect}
                  isHost={isHost}
                  isEditMode={isEditMode}
                  isChecked={checkedIds.has(track.id)}
                  onToggleCheck={handleToggleCheck}
                  onDeleteSingle={handleDeleteSingle}
                  isFirst={idx === 0}
                  isLast={idx === displayTracks.length - 1}
                  onMove={handleMove}
                  onRename={(id, title) => onRenameTrack?.(id, title)}
                  onToggleHidden={(id) => onToggleHidden?.(id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </ScrollArea>
    </div>
  );
};

export default PlaylistDnD;
